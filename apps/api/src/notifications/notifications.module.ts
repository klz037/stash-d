import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { GroupsModule } from '../groups/groups.module';
import { PromptsModule } from '../prompts/prompts.module';
import { UsersModule } from '../users/users.module';
import { HappeningsService } from './happenings.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  PushSubscription,
  PushSubscriptionSchema,
} from './schemas/push-subscription.schema';
import { StashAlert, StashAlertSchema } from './schemas/stash-alert.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
      { name: StashAlert.name, schema: StashAlertSchema },
    ]),
    AuthModule,
    UsersModule,
    FriendshipsModule,
    GroupsModule,
    PromptsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, HappeningsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
