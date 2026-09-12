import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { GroupsModule } from '../groups/groups.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { SpotifyModule } from '../spotify/spotify.module';
import { Lock, LockSchema } from './schemas/lock.schema';
import { StashesController } from './stashes.controller';
import { StashesService } from './stashes.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Lock.name, schema: LockSchema }]),
    AuthModule,
    UsersModule,
    SpotifyModule,
    FriendshipsModule,
    GroupsModule,
    RealtimeModule,
  ],
  controllers: [StashesController],
  providers: [StashesService],
  exports: [StashesService],
})
export class StashesModule {}
