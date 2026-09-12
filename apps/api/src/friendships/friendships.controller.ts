import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FriendDto, FriendRequestDto } from '@stashd/shared';
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

  /**
   * Entering a code sends a request; the other person accepts. If they had
   * already asked you, this is the acceptance and you're paired right away.
   */
  @Post('pair')
  async pair(
    @CurrentUser() user: UserDocument,
    @Body() body: PairDto,
  ): Promise<FriendDto> {
    const { friend, pending } = await this.friendshipsService.pair(user, body.code);
    if (pending) {
      const [me] = await this.friendshipsService.listFriends(user);
      this.realtime.notifyFriendRequested(friend.id, {
        from: { ...me, displayName: user.displayName, isSelf: false },
        createdAt: new Date().toISOString(),
      });
    } else {
      this.realtime.notifyPaired(user._id, friend.id);
    }
    return { ...friend, pending, online: this.realtime.isOnline(friend.id) };
  }

  @Get('friends/requests')
  requests(@CurrentUser() user: UserDocument): Promise<FriendRequestDto[]> {
    return this.friendshipsService.listRequests(user);
  }

  @Post('friends/requests/:userId/accept')
  async accept(
    @CurrentUser() user: UserDocument,
    @Param('userId') requesterId: string,
  ): Promise<FriendDto> {
    const friend = await this.friendshipsService.accept(user, requesterId);
    this.realtime.notifyPaired(user._id, friend.id);
    return { ...friend, online: this.realtime.isOnline(friend.id) };
  }

  @Post('friends/requests/:userId/decline')
  async decline(
    @CurrentUser() user: UserDocument,
    @Param('userId') requesterId: string,
  ): Promise<{ ok: true }> {
    await this.friendshipsService.decline(user, requesterId);
    return { ok: true };
  }
}
