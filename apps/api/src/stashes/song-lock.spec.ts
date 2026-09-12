import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SongDto } from '@stashd/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../app.module';
import { AuthClaims } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FriendshipsService } from '../friendships/friendships.service';
import { SpotifyService } from '../spotify/spotify.service';
import { UsersService } from '../users/users.service';
import { StashesService } from './stashes.service';

const maya: AuthClaims = { sub: 'auth0|maya', name: 'Maya' };
const jules: AuthClaims = { sub: 'auth0|jules', name: 'Jules' };

const ART = 'https://i.scdn.co/image/SECRET-ALBUM-ART';
const song: SongDto = {
  trackId: '4cOdK2wGLETKBW3PvgPWqT',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  albumArtUrl: ART,
  spotifyUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  previewUrl: 'https://p.scdn.co/mp3-preview/secret',
};

describe('song locks hide their album art until unlocked', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let users: UsersService;
  let friendships: FriendshipsService;
  let stashes: StashesService;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri('songlocks');
    process.env.AUTH0_DOMAIN = 'your-tenant.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://stashd-api';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      // Never call the real Spotify API from a test.
      .overrideProvider(SpotifyService)
      .useValue({ isAvailable: true, resolveTrack: async () => song })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    users = app.get(UsersService);
    friendships = app.get(FriendshipsService);
    stashes = app.get(StashesService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  it('strips the whole song object while LOCKED, then reveals it', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    await friendships.pair(recipient, sender.pairingCode);
    await friendships.accept(sender, recipient._id);

    const lock = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'this one is yours',
      conditionType: 'MANUAL',
      conditionLabel: 'Open when you land',
      songTrackId: '4cOdK2wGLETKBW3PvgPWqT',
    });

    const sealed = await stashes.toDto(lock, recipient._id);

    // The kind is visible — that is what draws the record sleeve.
    expect(sealed.mediaKind).toBe('SONG');
    expect(sealed.state).toBe('LOCKED');
    expect(sealed.contentHidden).toBe(true);

    // Everything identifying the track is absent from the payload.
    expect(sealed.song).toBeUndefined();
    expect(JSON.stringify(sealed)).not.toContain(ART);
    expect(JSON.stringify(sealed)).not.toContain('Rick Astley');
    expect(JSON.stringify(sealed)).not.toContain('Never Gonna Give You Up');
    expect(JSON.stringify(sealed)).not.toContain('mp3-preview');

    // The sender is no more privileged than the recipient here.
    const sealedForSender = await stashes.toDto(lock, sender._id);
    expect(sealedForSender.song).toBeUndefined();

    // Holding to unlock releases it.
    const opened = await stashes.confirm(recipient, String(lock._id));
    const revealed = await stashes.toDto(opened, recipient._id);

    expect(revealed.state).toBe('UNLOCKED');
    expect(revealed.mediaKind).toBe('SONG');
    expect(revealed.song?.albumArtUrl).toBe(ART);
    expect(revealed.song?.title).toBe('Never Gonna Give You Up');
    expect(revealed.song?.artist).toBe('Rick Astley');
  });

  it('marks photo and text locks with the right kind', async () => {
    const solo = await users.getOrCreate({ sub: 'auth0|solo', name: 'Solo' });

    const photo = await stashes.create(solo, {
      recipientIds: ['me'],
      text: 'a photo',
      imageUrl: 'data:image/png;base64,AAAA',
      conditionType: 'MANUAL',
      conditionLabel: 'later',
    });
    expect((await stashes.toDto(photo, solo._id)).mediaKind).toBe('PHOTO');

    const note = await stashes.create(solo, {
      recipientIds: ['me'],
      text: 'just words',
      conditionType: 'MANUAL',
      conditionLabel: 'later',
    });
    expect((await stashes.toDto(note, solo._id)).mediaKind).toBe('TEXT');
  });
});
