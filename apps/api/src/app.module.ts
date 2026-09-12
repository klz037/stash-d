import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UserSyncInterceptor } from './auth/user-sync.interceptor';
import { FriendshipsModule } from './friendships/friendships.module';
import { GroupsModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StashesModule } from './stashes/stashes.module';
import { NotesModule } from './notes/notes.module';
import { SpotifyModule } from './spotify/spotify.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://127.0.0.1:27017/stashd'),
      }),
    }),
    AuthModule,
    UsersModule,
    NotesModule,
    FriendshipsModule,
    GroupsModule,
    SpotifyModule,
    StashesModule,
    RealtimeModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: UserSyncInterceptor,
    },
  ],
})
export class AppModule {}
