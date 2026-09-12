import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FriendDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { PairDto } from './dto/pair.dto';
import { FriendshipsService } from './friendships.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FriendshipsController {
  constructor(
    private readonly friendshipsService: FriendshipsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get('friends')
  async friends(@CurrentUser() user: UserDocument): Promise<FriendDto[]> {
    const friends = await this.friendshipsService.listFriends(user);
    return friends.map((friend) => ({
      ...friend,
      online: friend.isSelf ? true : this.realtime.isOnline(friend.id),
    }));
  }

  @Post('pair')
  async pair(
    @CurrentUser() user: UserDocument,
    @Body() body: PairDto,
  ): Promise<FriendDto> {
    const friend = await this.friendshipsService.pair(user, body.code);
    this.realtime.notifyPaired(user._id, friend.id);
    return { ...friend, online: this.realtime.isOnline(friend.id) };
  }
}
