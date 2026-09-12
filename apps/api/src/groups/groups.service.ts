import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  formatPairingCode,
  generatePairingCode,
  GroupDto,
  MAX_GROUP_MEMBERS,
  normalizePairingCode,
} from '@stashd/shared';
import { Model } from 'mongoose';
import { FriendshipsService } from '../friendships/friendships.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateGroupDto } from './dto/group.dto';
import { Group, GroupDocument } from './schemas/group.schema';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private readonly groupModel: Model<GroupDocument>,
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
  ) {}

  async list(actor: UserDocument): Promise<GroupDto[]> {
    const groups = await this.groupModel
      .find({ memberIds: actor._id })
      .sort({ updatedAt: -1 })
      .exec();
    return Promise.all(groups.map((group) => this.toDto(group)));
  }

  async create(actor: UserDocument, body: CreateGroupDto): Promise<GroupDto> {
    const name = body.name.trim();
    if (!name) {
      throw new BadRequestException('Give the group a name.');
    }
    const memberIds = new Set<string>([actor._id]);
    for (const id of body.memberIds ?? []) {
      if (id === actor._id || id === 'me') continue;
      // Starting members must already be people you can stash to.
      if (!(await this.friendshipsService.arePaired(actor._id, id))) {
        throw new ForbiddenException('You can only add people you are paired with.');
      }
      memberIds.add(id);
    }
    if (memberIds.size > MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`A group holds up to ${MAX_GROUP_MEMBERS} people.`);
    }
    const group = await this.groupModel.create({
      name,
      inviteCode: await this.uniqueCode(),
      createdBy: actor._id,
      memberIds: [...memberIds],
    });
    return this.toDto(group);
  }

  async join(actor: UserDocument, rawCode: string): Promise<GroupDto> {
    const code = normalizePairingCode(rawCode);
    const group = await this.groupModel.findOne({ inviteCode: code }).exec();
    if (!group) {
      throw new NotFoundException("We couldn't find that group code. Check the letters?");
    }
    if (!group.memberIds.includes(actor._id)) {
      if (group.memberIds.length >= MAX_GROUP_MEMBERS) {
        throw new BadRequestException('This group is full.');
      }
      group.memberIds = [...group.memberIds, actor._id];
      await group.save();
    }
    return this.toDto(group);
  }

  /** Sharing a group is as good as being paired, for stashing. */
  async shareGroup(userId: string, otherId: string): Promise<boolean> {
    if (userId === otherId) return true;
    const row = await this.groupModel.exists({ memberIds: { $all: [userId, otherId] } });
    return Boolean(row);
  }

  async toDto(group: GroupDocument): Promise<GroupDto> {
    const users = await this.usersService.findMany(group.memberIds);
    const byId = new Map(users.map((user) => [user._id, user]));
    return {
      id: String(group._id),
      name: group.name,
      inviteCode: group.inviteCode,
      inviteCodeDisplay: formatPairingCode(group.inviteCode),
      createdBy: group.createdBy,
      memberIds: group.memberIds,
      members: group.memberIds.map((id) => {
        const user = byId.get(id);
        return {
          id,
          displayName: user?.displayName ?? 'Friend',
          schoolId: user?.schoolId,
          schoolName: user?.schoolName,
          city: user?.city,
        };
      }),
      createdAt: (group.createdAt ?? new Date()).toISOString(),
    };
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 12; i += 1) {
      const code = generatePairingCode();
      if (!(await this.groupModel.exists({ inviteCode: code }))) return code;
    }
    throw new Error('Could not allocate a group code');
  }
}
