import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LockDto } from '@stashd/shared';
import { Model } from 'mongoose';
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
} from './lock.engine';
import { Lock, LockDocument } from './schemas/lock.schema';

@Injectable()
export class StashesService {
  constructor(
    @InjectModel(Lock.name) private readonly lockModel: Model<LockDocument>,
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
    private readonly groupsService: GroupsService,
  ) {}

  async create(actor: UserDocument, dto: CreateLockDto): Promise<LockDocument[]> {
    if (dto.conditionType === 'MANUAL' && !dto.conditionLabel?.trim()) {
      throw new BadRequestException('Write the condition in your own words.');
    }
    if (dto.conditionType === 'TOGETHER' && dto.groupId) {
      throw new BadRequestException('Open-together is still pairwise — stash the group as Open when…');
    }

    let recipientIds: string[] = [];
    let groupId: string | undefined;
    let groupName: string | undefined;

    if (dto.groupId) {
      const group = await this.groupsService.getForMember(dto.groupId, actor._id);
      recipientIds = group.memberIds.filter((id) => id !== actor._id);
      groupId = String(group._id);
      groupName = group.name;
      if (recipientIds.length === 0) {
        throw new BadRequestException('This group needs someone else in it.');
      }
    } else {
      const recipientId =
        dto.recipientId === 'me' || dto.recipientId === actor._id
          ? actor._id
          : dto.recipientId!;
      const paired = await this.friendshipsService.arePaired(actor._id, recipientId);
      if (!paired) {
        throw new ForbiddenException(
          'You can only stash to yourself or someone you are paired with.',
        );
      }
      recipientIds = [recipientId];
    }

    // Never trust client-supplied song metadata — re-resolve from the id so the
    // stored album art URL is always one Spotify actually gave us.
    let song: LockSong | null = null;
    if (dto.songTrackId) {
      const resolved = await this.spotifyService.resolveTrack(actor, dto.songTrackId);
      song = {
        trackId: resolved.trackId,
        title: resolved.title,
        artist: resolved.artist,
        albumArtUrl: resolved.albumArtUrl,
        spotifyUrl: resolved.spotifyUrl,
        previewUrl: resolved.previewUrl,
        durationMs: resolved.durationMs,
      };
    }

    const mediaKind: MediaKind = song ? 'SONG' : dto.imageUrl ? 'PHOTO' : 'TEXT';

    const docs = await this.lockModel.insertMany(
      recipientIds.map((recipientId) => ({
        senderId: actor._id,
        recipientId,
        text: dto.text ?? '',
        imageUrl: dto.imageUrl,
        song,
        mediaKind,
        conditionType: dto.conditionType,
        conditionLabel: defaultConditionLabel(dto.conditionType, dto.conditionLabel),
        state: 'LOCKED' as const,
        senderConfirmed: false,
        recipientConfirmed: false,
        unlockedAt: null,
        groupId,
        groupName,
      })),
    );
    return docs as unknown as LockDocument[];
  }

  async listInbox(actor: UserDocument): Promise<LockDocument[]> {
    return this.lockModel
      .find({ recipientId: actor._id })
      .sort({ createdAt: -1 })
      .exec();
  }

  async listSent(actor: UserDocument): Promise<LockDocument[]> {
    return this.lockModel
      .find({ senderId: actor._id })
      .sort({ createdAt: -1 })
      .exec();
  }

  async confirm(actor: UserDocument, id: string): Promise<LockDocument> {
    const lock = await this.requireLock(id);
    if (!canConfirm(lock, actor._id)) {
      throw new ForbiddenException('You cannot unlock this lock.');
    }
    const next = applyConfirm(lock, actor._id);
    lock.state = next.state;
    lock.senderConfirmed = next.senderConfirmed;
    lock.recipientConfirmed = next.recipientConfirmed;
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

  async toDto(lock: LockDocument, viewerId: string): Promise<LockDto> {
    if (!isParticipant(lock, viewerId)) {
      throw new ForbiddenException();
    }
    const [sender, recipient] = await Promise.all([
      this.usersService.findById(lock.senderId),
      this.usersService.findById(lock.recipientId),
    ]);
    const revealed = canSeeContent(lock);
    return {
      id: String(lock._id),
      senderId: lock.senderId,
      recipientId: lock.recipientId,
      senderName: sender?.displayName ?? 'Someone',
      recipientName:
        lock.recipientId === viewerId ? 'You' : (recipient?.displayName ?? 'Friend'),
      conditionType: lock.conditionType,
      conditionLabel: lock.conditionLabel,
      state: lock.state,
      senderConfirmed: lock.senderConfirmed,
      recipientConfirmed: lock.recipientConfirmed,
      createdAt: (lock.createdAt ?? new Date()).toISOString(),
      unlockedAt: lock.unlockedAt ? lock.unlockedAt.toISOString() : null,
      text: revealed ? lock.text : undefined,
      imageUrl: revealed ? lock.imageUrl : undefined,
      contentHidden: !revealed,
      groupId: lock.groupId,
      groupName: lock.groupName,
    };
  }

  private async requireLock(id: string): Promise<LockDocument> {
    const lock = await this.lockModel.findById(id).exec();
    if (!lock) {
      throw new NotFoundException('Lock not found.');
    }
    return lock;
  }
}
