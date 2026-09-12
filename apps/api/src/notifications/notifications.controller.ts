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
import type {
  AlertPreviewDto,
  NotificationsStatusDto,
  SendAlertNowResponse,
} from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from '../users/schemas/user.schema';
import { PreviewAlertsDto, SendAlertNowDto } from './dto/alert-request.dto';
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

  @Post('preview')
  preview(
    @CurrentUser() user: UserDocument,
    @Body() body?: PreviewAlertsDto,
  ): Promise<AlertPreviewDto> {
    return this.notifications.preview(user, body?.seed);
  }

  @Post('send-now')
  sendNow(
    @CurrentUser() user: UserDocument,
    @Body() body?: SendAlertNowDto,
  ): Promise<SendAlertNowResponse> {
    return this.notifications.sendNow(user, body?.draft);
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
