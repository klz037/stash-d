import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FriendDto,
  FriendRequestDto,
  formatPairingCode,
  normalizePairingCode,
} from '@stashd/shared';
import { Model } from 'mongoose';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { Friendship, FriendshipDocument } from './schemas/friendship.schema';

export interface PairOutcome {
  friend: FriendDto;
  /** True when the other person still has to accept. */
  pending: boolean;
}

/** Rows from before requests existed carry no status and count as accepted. */
const ACCEPTED = { status: { $ne: 'PENDING' } };

@Injectable()
export class FriendshipsService {
  constructor(
    @InjectModel(Friendship.name)
    private readonly friendshipModel: Model<FriendshipDocument>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Entering someone's code. Three cases:
   * - nothing between you yet → a PENDING request they have to accept
   * - they already asked you → that's an acceptance, you're paired
   * - already paired → no-op
   */
  async pair(actor: UserDocument, rawCode: string): Promise<PairOutcome> {
    const code = normalizePairingCode(rawCode);
    if (code === actor.pairingCode) {
      throw new BadRequestException("That's your code. Send it to a friend instead.");
    }

    const other = await this.usersService.findByPairingCode(code);
    if (!other) {
      throw new NotFoundException("We couldn't find that code. Check the letters?");
    }

    const [userAId, userBId] = [actor._id, other._id].sort();
    const existing = await this.friendshipModel.findOne({ userAId, userBId }).exec();

    if (existing && existing.status !== 'PENDING') {
      return { friend: this.toFriendDto(other, false), pending: false };
    }
    if (existing && existing.requestedBy && existing.requestedBy !== actor._id) {
      // They asked first. Entering their code back is the acceptance.
      existing.status = 'ACCEPTED';
      await existing.save();
      return { friend: this.toFriendDto(other, false), pending: false };
    }
    if (!existing) {
      await this.friendshipModel.create({
        userAId,
        userBId,
        status: 'PENDING',
        requestedBy: actor._id,
      });
    }
    return { friend: { ...this.toFriendDto(other, false), pending: true }, pending: true };
  }

  /** Requests waiting on the actor's answer, newest first. */
  async listRequests(actor: UserDocument): Promise<FriendRequestDto[]> {
    const rows = await this.friendshipModel
      .find({
        status: 'PENDING',
        requestedBy: { $ne: actor._id },
        $or: [{ userAId: actor._id }, { userBId: actor._id }],
      })
      .sort({ createdAt: -1 })
      .exec();
    const out: FriendRequestDto[] = [];
    for (const row of rows) {
      const fromId = row.userAId === actor._id ? row.userBId : row.userAId;
      const from = await this.usersService.findById(fromId);
      if (!from) continue;
      out.push({
        from: this.toFriendDto(from, false),
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      });
    }
    return out;
  }

  async accept(actor: UserDocument, requesterId: string): Promise<FriendDto> {
    const row = await this.pendingFrom(actor, requesterId);
    row.status = 'ACCEPTED';
    await row.save();
    const requester = await this.usersService.findById(requesterId);
    if (!requester) {
      throw new NotFoundException('That person no longer exists.');
    }
    return this.toFriendDto(requester, false);
  }

  async decline(actor: UserDocument, requesterId: string): Promise<void> {
    const row = await this.pendingFrom(actor, requesterId);
    await row.deleteOne();
  }

  async listFriends(actor: UserDocument): Promise<FriendDto[]> {
    const rows = await this.friendshipModel
      .find({
        ...ACCEPTED,
        $or: [{ userAId: actor._id }, { userBId: actor._id }],
      })
      .exec();

    const otherIds = rows.map((row) =>
      row.userAId === actor._id ? row.userBId : row.userAId,
    );
    const others = await this.usersService.findMany(otherIds);

    const me = this.toFriendDto(actor, true);
    const friends = others.map((user) => this.toFriendDto(user, false));

    return [me, ...friends];
  }

  /** Accepted only. A pending request grants nothing. */
  async arePaired(userId: string, otherId: string): Promise<boolean> {
    if (userId === otherId) {
      return true;
    }
    const [userAId, userBId] = [userId, otherId].sort();
    const row = await this.friendshipModel.exists({ userAId, userBId, ...ACCEPTED });
    return Boolean(row);
  }

  async friendIdsOf(userId: string): Promise<string[]> {
    const rows = await this.friendshipModel
      .find({ ...ACCEPTED, $or: [{ userAId: userId }, { userBId: userId }] })
      .exec();
    return rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));
  }

  private async pendingFrom(actor: UserDocument, requesterId: string): Promise<FriendshipDocument> {
    const [userAId, userBId] = [actor._id, requesterId].sort();
    const row = await this.friendshipModel
      .findOne({ userAId, userBId, status: 'PENDING', requestedBy: requesterId })
      .exec();
    if (!row) {
      throw new NotFoundException('No request from that person is waiting.');
    }
    return row;
  }

  private toFriendDto(user: UserDocument, isSelf: boolean): FriendDto {
    return {
      id: user._id,
      displayName: isSelf ? 'Me' : user.displayName,
      pairingCode: user.pairingCode,
      pairingCodeDisplay: formatPairingCode(user.pairingCode),
      picture: user.picture,
      isSelf,
      schoolId: user.schoolId,
      schoolName: user.schoolName,
      city: user.city,
    };
  }
}
