import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FriendDto, formatPairingCode, normalizePairingCode } from '@stashd/shared';
import { Model } from 'mongoose';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { Friendship, FriendshipDocument } from './schemas/friendship.schema';

@Injectable()
export class FriendshipsService {
  constructor(
    @InjectModel(Friendship.name)
    private readonly friendshipModel: Model<FriendshipDocument>,
    private readonly usersService: UsersService,
  ) {}

  async pair(actor: UserDocument, rawCode: string): Promise<FriendDto> {
    const code = normalizePairingCode(rawCode);
    if (code === actor.pairingCode) {
      throw new BadRequestException(
        "That's your code. Send it to a friend instead.",
      );
    }

    const other = await this.usersService.findByPairingCode(code);
    if (!other) {
      throw new NotFoundException(
        "We couldn't find that code. Check the letters?",
      );
    }

    const [userAId, userBId] = [actor._id, other._id].sort();
    await this.friendshipModel.updateOne(
      { userAId, userBId },
      { $setOnInsert: { userAId, userBId } },
      { upsert: true },
    );

    return this.toFriendDto(other, false);
  }

  async listFriends(actor: UserDocument): Promise<FriendDto[]> {
    const rows = await this.friendshipModel
      .find({
        $or: [{ userAId: actor._id }, { userBId: actor._id }],
      })
      .exec();

    const otherIds = rows.map((row) =>
      row.userAId === actor._id ? row.userBId : row.userAId,
    );
    const others = await Promise.all(
      otherIds.map((id) => this.usersService.findById(id)),
    );

    const me = this.toFriendDto(actor, true);
    const friends = others
      .filter((user): user is UserDocument => Boolean(user))
      .map((user) => this.toFriendDto(user, false));

    return [me, ...friends];
  }

  async arePaired(userId: string, otherId: string): Promise<boolean> {
    if (userId === otherId) {
      return true;
    }
    const [userAId, userBId] = [userId, otherId].sort();
    const row = await this.friendshipModel.exists({ userAId, userBId });
    return Boolean(row);
  }

  async friendIdsOf(userId: string): Promise<string[]> {
    const rows = await this.friendshipModel
      .find({ $or: [{ userAId: userId }, { userBId: userId }] })
      .exec();
    return rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));
  }

  private toFriendDto(user: UserDocument, isSelf: boolean): FriendDto {
    return {
      id: user._id,
      displayName: isSelf ? 'Me' : user.displayName,
      pairingCode: user.pairingCode,
      pairingCodeDisplay: formatPairingCode(user.pairingCode),
      picture: user.picture,
      isSelf,
    };
  }
}
