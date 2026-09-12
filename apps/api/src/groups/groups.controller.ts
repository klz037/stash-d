import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { GroupDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { GroupsService } from './groups.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  list(@CurrentUser() user: UserDocument): Promise<GroupDto[]> {
    return this.groupsService.list(user);
  }

  @Post()
  async create(
    @CurrentUser() user: UserDocument,
    @Body() body: CreateGroupDto,
  ): Promise<GroupDto> {
    const group = await this.groupsService.create(user, body);
    for (const memberId of group.memberIds) {
      if (memberId !== user._id) {
        this.realtime.notifyGroupUpdated(memberId, group);
      }
    }
    return group;
  }

  @Post('join')
  async join(
    @CurrentUser() user: UserDocument,
    @Body() body: JoinGroupDto,
  ): Promise<GroupDto> {
    const group = await this.groupsService.join(user, body.code);
    for (const memberId of group.memberIds) {
      if (memberId !== user._id) {
        this.realtime.notifyGroupUpdated(memberId, group);
      }
    }
    return group;
  }
}
