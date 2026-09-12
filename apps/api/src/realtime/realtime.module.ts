import { Module, forwardRef } from '@nestjs/common';
import { FriendshipsModule } from '../friendships/friendships.module';
import { UsersModule } from '../users/users.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [UsersModule, forwardRef(() => FriendshipsModule)],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
