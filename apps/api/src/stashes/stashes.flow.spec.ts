import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../app.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthClaims } from '../auth/auth.types';
import { FriendshipsService } from '../friendships/friendships.service';
import { UsersService } from '../users/users.service';
import { StashesService } from './stashes.service';

const maya: AuthClaims = { sub: 'auth0|maya', name: 'Maya' };
const jules: AuthClaims = { sub: 'auth0|jules', name: 'Jules' };

describe('stash → unlock vertical slice', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let users: UsersService;
  let friendships: FriendshipsService;
  let stashes: StashesService;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri('stashd');
    process.env.AUTH0_DOMAIN = 'your-tenant.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://stashd-api';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
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

  it('pairs friends, hides content, then unlocks and reveals', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    await friendships.pair(recipient, sender.pairingCode);

    const locked = await stashes.create(sender, {
      recipientId: recipient._id,
      text: 'Open when you land',
      conditionType: 'MANUAL',
      conditionLabel: 'Open when you land',
    });

    const hidden = await stashes.toDto(locked, recipient._id);
    expect(hidden.state).toBe('LOCKED');
    expect(hidden.contentHidden).toBe(true);
    expect(hidden.text).toBeUndefined();

    const opened = await stashes.confirm(recipient, String(locked._id));
    const revealed = await stashes.toDto(opened, recipient._id);
    expect(revealed.state).toBe('UNLOCKED');
    expect(revealed.contentHidden).toBe(false);
    expect(revealed.text).toBe('Open when you land');
  });
});
