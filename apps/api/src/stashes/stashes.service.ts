import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  LockContext,
  LockDto,
  MAX_RECIPIENTS,
  MediaKind,
  MFA_REQUIRED,
  normalizeMoment,
  TOGETHER_WAIT_MS,
} from '@stashd/shared';
import { Model } from 'mongoose';
import { AuthClaims } from '../auth/auth.types';
import { FriendshipsService } from '../friendships/friendships.service';
import { GroupsService } from '../groups/groups.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateLockDto } from './dto/create-lock.dto';
import {
  applyConfirm,
  canConfirm,
  canSeeContent,
  canSetCondition,
  defaultConditionLabel,
  isParticipant,
  isPairTogether,
  isRecipient,
  participants,
} from './lock.engine';
import { Lock, LockDocument, LockSong } from './schemas/lock.schema';
import { SpotifyService } from '../spotify/spotify.service';

/** Display names for everyone on a lock, fetched once per request. */
export type NameMap = Map<string, string>;

@Injectable()
export class StashesService {
  private readonly logger = new Logger(StashesService.name);
  /** Pending one-minute waits for pair openings, by original lock id. In memory: a restart forgets them. */
  private readonly waits = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(Lock.name) private readonly lockModel: Model<LockDocument>,
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
    private readonly groupsService: GroupsService,
    private readonly spotifyService: SpotifyService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(actor: UserDocument, dto: CreateLockDto): Promise<LockDocument> {
    // A stash-back answers one TOGETHER lock: the type and recipient are fixed.
    const original = dto.replyToId ? await this.requireLock(dto.replyToId) : null;
    if (original) {
      if (!isRecipient(original, actor._id) || !isPairTogether(original)) {
        throw new ForbiddenException('You can only stash back on an "open together" sent to you.');
      }
      if (original.replyId) {
        throw new BadRequestException('You already stashed something back for this one.');
      }
      if (original.state !== 'LOCKED') {
        throw new BadRequestException('This one is already opening.');
      }
    }

    const recipientIds = original
      ? [original.senderId]
      : [...new Set(dto.recipientIds.map((id) => (id === 'me' ? actor._id : id)))];
    if (recipientIds.length === 0 || recipientIds.length > MAX_RECIPIENTS) {
      throw new BadRequestException('Pick between one and twelve people.');
    }

    // Paired, or in a group together. Either is permission to stash to them.
    for (const recipientId of recipientIds) {
      const allowed =
        (await this.friendshipsService.arePaired(actor._id, recipientId)) ||
        (await this.groupsService.shareGroup(actor._id, recipientId));
      if (!allowed) {
        throw new ForbiddenException(
          'You can only stash to yourself, people you are paired with, or people in your groups.',
        );
      }
    }

    const conditionType = original ? 'TOGETHER' : dto.conditionType;
    if (conditionType === 'RECIPIENT_SET' && recipientIds.length > 1) {
      throw new BadRequestException(
        '"You decide" locks go to one person. Pick a condition for a group.',
      );
    }
    if (conditionType === 'MANUAL' && !dto.conditionLabel?.trim() && !dto.context) {
      throw new BadRequestException('Write the condition in your own words.');
    }
    if (dto.context && conditionType === 'RECIPIENT_SET') {
      throw new BadRequestException('A "you decide" lock has no moment.');
    }

    // Never trust client-supplied song metadata — re-resolve from the id so the
    // stored album art URL is always one Spotify actually gave us.
    let song: LockSong | null = null;
    if (dto.songTrackId) {
      song = await this.spotifyService.resolveTrack(actor, dto.songTrackId);
    }

    const mediaKind: MediaKind = song ? 'SONG' : dto.imageUrl ? 'PHOTO' : 'TEXT';

    const lock = await this.lockModel.create({
      senderId: actor._id,
      recipientIds,
      text: dto.text ?? '',
      imageUrl: dto.imageUrl,
      song,
      mediaKind,
      conditionType,
      conditionLabel: original
        ? 'Opens with theirs'
        : defaultConditionLabel(conditionType, dto.conditionLabel),
      context: original ? (original.context ?? null) : normalizeMoment(dto.context),
      contextMetAt: null,
      contextMetBy: null,
      requiresMfa: Boolean(dto.requiresMfa),
      replyToId: original ? String(original._id) : null,
      replyId: null,
      openingStartedAt: null,
      openedAlone: false,
      state: 'LOCKED',
      confirmedIds: [],
      unlockedAt: null,
    });

    if (original) {
      original.replyId = String(lock._id);
      await original.save();
      // The sender learns they can now start opening.
      this.realtime.notifyLockUpdated(original, await this.toDtoForEveryone(original));
    }
    return lock;
  }

  async listInbox(actor: UserDocument): Promise<LockDocument[]> {
    return this.lockModel
      .find({ recipientIds: actor._id })
      .sort({ createdAt: -1 })
      .exec();
  }

  async listSent(actor: UserDocument): Promise<LockDocument[]> {
    return this.lockModel
      .find({ senderId: actor._id })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * One hold. `claims` is the verified token: a double-sealed lock refuses to
   * open unless the post-login Action stamped it with the MFA claim.
   *
   * For a pair "open together": the sender's hold starts the opening and a
   * one-minute wait; the recipient's hold finishes it and opens both locks at
   * once. Emits for the linked stash-back happen here; the controller emits
   * for the lock that was held.
   */
  async confirm(
    actor: UserDocument,
    id: string,
    claims?: Pick<AuthClaims, 'mfa'>,
  ): Promise<LockDocument> {
    const lock = await this.requireLock(id);
    if (!canConfirm(lock, actor._id)) {
      throw new ForbiddenException('You cannot unlock this lock.');
    }
    if (lock.requiresMfa && !claims?.mfa) {
      throw new ForbiddenException({
        statusCode: 403,
        code: MFA_REQUIRED,
        message: 'This lock needs your second key.',
      });
    }
    const next = applyConfirm(lock, actor._id);
    lock.state = next.state;
    lock.confirmedIds = next.confirmedIds;
    lock.unlockedAt = next.unlockedAt;
    if (next.startedOpening) {
      lock.openingStartedAt = new Date();
    }
    await lock.save();

    if (next.startedOpening) {
      this.scheduleOpenAlone(String(lock._id));
    } else if (lock.state === 'UNLOCKED' && lock.replyId) {
      // Opened together: the stash-back opens in the same moment.
      this.cancelWait(String(lock._id));
      await this.unlockReply(lock);
    }
    return lock;
  }

  /** The recipient never showed. Open the sender's side (the stash-back) and tell the recipient. */
  private scheduleOpenAlone(lockId: string) {
    this.cancelWait(lockId);
    const timer = setTimeout(() => {
      this.waits.delete(lockId);
      void this.openAlone(lockId).catch((error) =>
        this.logger.warn(`open-alone failed for ${lockId}: ${(error as Error).message}`),
      );
    }, TOGETHER_WAIT_MS);
    this.waits.set(lockId, timer);
  }

  private cancelWait(lockId: string) {
    const timer = this.waits.get(lockId);
    if (timer) {
      clearTimeout(timer);
      this.waits.delete(lockId);
    }
  }

  async openAlone(lockId: string): Promise<void> {
    const lock = await this.lockModel.findById(lockId).exec();
    if (!lock || lock.state !== 'READY' || lock.openedAlone || !lock.replyId) {
      return;
    }
    lock.openedAlone = true;
    await lock.save();
    await this.unlockReply(lock);
    // The original stays READY: the recipient still holds to see it, and the
    // card tells them the sender went ahead.
    this.realtime.notifyLockUpdated(lock, await this.toDtoForEveryone(lock));
  }

  private async unlockReply(original: LockDocument): Promise<void> {
    if (!original.replyId) return;
    const reply = await this.lockModel.findById(original.replyId).exec();
    if (!reply || reply.state === 'UNLOCKED') return;
    reply.state = 'UNLOCKED';
    reply.confirmedIds = participants(reply);
    reply.unlockedAt = new Date();
    await reply.save();
    this.realtime.notifyLockChange(reply, await this.toDtoForEveryone(reply));
  }

  async setCondition(
    actor: UserDocument,
    id: string,
    conditionLabel: string,
  ): Promise<LockDocument> {
    const lock = await this.requireLock(id);
    if (!canSetCondition(lock, actor._id)) {
      throw new ForbiddenException('You cannot set a condition on this lock.');
    }
    lock.conditionLabel = conditionLabel.trim();
    await lock.save();
    return lock;
  }

  /**
   * "I'm here." Stamps every sealed lock addressed to the caller whose moment
   * matches. Nothing changes state: the hold is still the unlock.
   */
  async markHere(actor: UserDocument, rawContext: LockContext): Promise<LockDocument[]> {
    const context = normalizeMoment(rawContext);
    if (!context) {
      return [];
    }
    const locks = await this.lockModel
      .find({
        recipientIds: actor._id,
        context,
        state: { $ne: 'UNLOCKED' },
        contextMetAt: null,
      })
      .exec();
    const now = new Date();
    for (const lock of locks) {
      lock.contextMetAt = now;
      lock.contextMetBy = actor._id;
      await lock.save();
    }
    return locks;
  }

  /** Fetch display names for everyone on a lock once, so toDto is cheap per viewer. */
  async namesFor(lock: LockDocument): Promise<NameMap> {
    const ids = [...new Set([...participants(lock), lock.contextMetBy].filter(Boolean))] as string[];
    const users = await this.usersService.findMany(ids);
    const names: NameMap = new Map();
    for (const user of users) {
      names.set(user._id, user.displayName);
    }
    return names;
  }

  async toDto(lock: LockDocument, viewerId: string, names?: NameMap): Promise<LockDto> {
    if (!isParticipant(lock, viewerId)) {
      throw new ForbiddenException();
    }
    const nameMap = names ?? (await this.namesFor(lock));
    const name = (id: string) => nameMap.get(id) ?? 'Friend';
    const revealed = canSeeContent(lock);
    const recipients = lock.recipientIds.map((id) => ({ id, displayName: name(id) }));
    const others = recipients.filter((r) => r.id !== viewerId).map((r) => r.displayName);
    const recipientName = isRecipient(lock, viewerId)
      ? others.length === 0
        ? 'You'
        : `You, ${listNames(others)}`
      : listNames(others);

    return {
      id: String(lock._id),
      senderId: lock.senderId,
      recipientIds: lock.recipientIds,
      recipients,
      participantIds: participants(lock),
      confirmedIds: lock.confirmedIds,
      senderName: lock.senderId === viewerId ? 'You' : name(lock.senderId),
      recipientName,
      conditionType: lock.conditionType,
      conditionLabel: lock.conditionLabel,
      context: lock.context ?? null,
      contextMetAt: lock.contextMetAt ? lock.contextMetAt.toISOString() : null,
      contextMetBy: lock.contextMetBy ?? null,
      contextMetByName: lock.contextMetBy
        ? lock.contextMetBy === viewerId
          ? 'You'
          : name(lock.contextMetBy)
        : null,
      requiresMfa: Boolean(lock.requiresMfa),
      replyToId: lock.replyToId ?? null,
      replyId: lock.replyId ?? null,
      openingStartedAt: lock.openingStartedAt ? lock.openingStartedAt.toISOString() : null,
      openedAlone: Boolean(lock.openedAlone),
      state: lock.state,
      createdAt: (lock.createdAt ?? new Date()).toISOString(),
      unlockedAt: lock.unlockedAt ? lock.unlockedAt.toISOString() : null,
      // mediaKind is metadata and stays visible while sealed; everything below
      // it is content and is absent from the JSON until state === 'UNLOCKED'.
      mediaKind: lock.mediaKind ?? 'TEXT',
      text: revealed ? lock.text : undefined,
      imageUrl: revealed ? lock.imageUrl : undefined,
      song: revealed ? (lock.song ?? undefined) : undefined,
      contentHidden: !revealed,
    };
  }

  /** One DTO per participant, each shaped for that viewer. */
  async toDtoForEveryone(lock: LockDocument): Promise<Map<string, LockDto>> {
    const names = await this.namesFor(lock);
    const out = new Map<string, LockDto>();
    for (const id of participants(lock)) {
      out.set(id, await this.toDto(lock, id, names));
    }
    return out;
  }

  private async requireLock(id: string): Promise<LockDocument> {
    const lock = await this.lockModel.findById(id).exec().catch(() => null);
    if (!lock) {
      throw new NotFoundException('Lock not found.');
    }
    return lock;
  }
}

/** "Maya" · "Maya and Jules" · "Maya, Jules +1" */
function listNames(names: string[]): string {
  if (names.length === 0) return 'Friend';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}
