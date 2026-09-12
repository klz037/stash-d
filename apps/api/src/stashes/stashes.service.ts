import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  LockContext,
  LockDto,
  MAX_RECIPIENTS,
  MediaKind,
  MFA_REQUIRED,
} from '@stashd/shared';
import { Model } from 'mongoose';
import { AuthClaims } from '../auth/auth.types';
import { FriendshipsService } from '../friendships/friendships.service';
import { GroupsService } from '../groups/groups.service';
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
  isRecipient,
  participants,
} from './lock.engine';
import { Lock, LockDocument, LockSong } from './schemas/lock.schema';
import { SpotifyService } from '../spotify/spotify.service';

/** Display names for everyone on a lock, fetched once per request. */
export type NameMap = Map<string, string>;

@Injectable()
export class StashesService {
  constructor(
    @InjectModel(Lock.name) private readonly lockModel: Model<LockDocument>,
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
    private readonly groupsService: GroupsService,
    private readonly spotifyService: SpotifyService,
  ) {}

  async create(actor: UserDocument, dto: CreateLockDto): Promise<LockDocument> {
    const recipientIds = [
      ...new Set(
        dto.recipientIds.map((id) => (id === 'me' ? actor._id : id)),
      ),
    ];
    if (recipientIds.length === 0 || recipientIds.length > MAX_RECIPIENTS) {
      throw new BadRequestException('Pick between one and eight people.');
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

    if (dto.conditionType === 'RECIPIENT_SET' && recipientIds.length > 1) {
      throw new BadRequestException(
        '"You decide" locks go to one person. Pick a condition for a group.',
      );
    }
    if (dto.conditionType === 'MANUAL' && !dto.conditionLabel?.trim() && !dto.context) {
      throw new BadRequestException('Write the condition in your own words.');
    }
    if (dto.context && dto.conditionType === 'RECIPIENT_SET') {
      throw new BadRequestException('A "you decide" lock has no context.');
    }

    // Never trust client-supplied song metadata — re-resolve from the id so the
    // stored album art URL is always one Spotify actually gave us.
    let song: LockSong | null = null;
    if (dto.songTrackId) {
      song = await this.spotifyService.resolveTrack(actor, dto.songTrackId);
    }

    const mediaKind: MediaKind = song ? 'SONG' : dto.imageUrl ? 'PHOTO' : 'TEXT';

    return this.lockModel.create({
      senderId: actor._id,
      recipientIds,
      text: dto.text ?? '',
      imageUrl: dto.imageUrl,
      song,
      mediaKind,
      conditionType: dto.conditionType,
      conditionLabel: defaultConditionLabel(dto.conditionType, dto.conditionLabel),
      context: dto.context ?? null,
      contextMetAt: null,
      contextMetBy: null,
      requiresMfa: Boolean(dto.requiresMfa),
      state: 'LOCKED',
      confirmedIds: [],
      unlockedAt: null,
    });
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
   * open unless the post-login Action stamped it with the MFA claim. That is
   * enforced here, not in the UI — a plain token gets a 403 with a code the
   * client can act on.
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
    await lock.save();
    return lock;
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
   * "I'm here." Stamps every sealed lock addressed to the caller whose context
   * matches. Nothing changes state: the hold is still the unlock. Only the
   * senders of matching locks learn where the caller is.
   */
  async markHere(actor: UserDocument, context: LockContext): Promise<LockDocument[]> {
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
    const lock = await this.lockModel.findById(id).exec();
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
