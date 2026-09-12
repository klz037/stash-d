import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateGroupRequest,
  formatPairingCode,
  generatePairingCode,
  GroupDto,
  normalizePairingCode,
} from '@stashd/shared';
import { Model } from 'mongoose';
import { FriendshipsService } from '../friendships/friendships.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
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

  async create(actor: UserDocument, body: CreateGroupRequest): Promise<GroupDto> {
    const name = body.name.trim();
    if (!name) {
      throw new BadRequestException('Give the group a name.');
    }
    const memberIds = new Set<string>([actor._id]);
    for (const id of body.memberIds ?? []) {
      if (id === actor._id) continue;
      const paired = await this.friendshipsService.arePaired(actor._id, id);
      if (!paired) {
        throw new ForbiddenException('You can only add people you are paired with.');
      }
      memberIds.add(id);
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
      throw new NotFoundException("We couldn't find that group code.");
    }
    if (!group.memberIds.includes(actor._id)) {
      if (group.memberIds.length >= 12) {
        throw new BadRequestException('This group is full.');
      }
      group.memberIds = [...group.memberIds, actor._id];
      await group.save();
    }
    return this.toDto(group);
  }

  async getForMember(groupId: string, userId: string): Promise<GroupDocument> {
    const group = await this.groupModel.findById(groupId).exec();
    if (!group) {
      throw new NotFoundException('Group not found.');
    }
    if (!group.memberIds.includes(userId)) {
      throw new ForbiddenException('You are not in this group.');
    }
    return group;
  }

  private async toDto(group: GroupDocument): Promise<GroupDto> {
    const members = await Promise.all(
      group.memberIds.map(async (id) => {
        const user = await this.usersService.findById(id);
        return {
          id,
          displayName: user?.displayName ?? 'Friend',
        };
      }),
    );
    return {
      id: String(group._id),
      name: group.name,
      inviteCode: group.inviteCode,
      inviteCodeDisplay: formatPairingCode(group.inviteCode),
      createdBy: group.createdBy,
      memberIds: group.memberIds,
      members,
      createdAt: (group.createdAt ?? new Date()).toISOString(),
    };
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 12; i += 1) {
      const code = generatePairingCode();
      const exists = await this.groupModel.exists({ inviteCode: code });
      if (!exists) return code;
    }
    throw new Error('Could not allocate a group code');
  }
}
