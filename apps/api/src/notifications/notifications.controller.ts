import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { NotificationsStatusDto, StashAlertDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from '../users/schemas/user.schema';
import { SavePushSubscriptionDto } from './dto/push-subscription.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('status')
  status(@CurrentUser() user: UserDocument): Promise<NotificationsStatusDto> {
    return this.notifications.status(user);
  }

  @Post('subscribe')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: UserDocument,
    @Body() body: SavePushSubscriptionDto,
  ): Promise<void> {
    await this.notifications.saveSubscription(user, body);
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: UserDocument,
    @Query('endpoint') endpoint?: string,
  ): Promise<void> {
    await this.notifications.removeSubscription(user, endpoint);
  }

  @Post('send-now')
  sendNow(@CurrentUser() user: UserDocument): Promise<StashAlertDto | null> {
    return this.notifications.sendNow(user);
  }

  @Post(':id/ack')
  @HttpCode(204)
  async ack(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.acknowledge(user, id);
  }
}
