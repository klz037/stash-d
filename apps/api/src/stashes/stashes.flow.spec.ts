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
const sam: AuthClaims = { sub: 'auth0|sam', name: 'Sam' };

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
      recipientIds: [recipient._id],
      text: 'Open when you land',
      conditionType: 'MANUAL',
      conditionLabel: 'Open when you land',
    });

    const hidden = await stashes.toDto(locked, recipient._id);
    expect(hidden.state).toBe('LOCKED');
    expect(hidden.contentHidden).toBe(true);
    expect(hidden.text).toBeUndefined();
    expect(hidden.recipientName).toBe('You');
    expect(hidden.senderName).toBe('Maya');

    const opened = await stashes.confirm(recipient, String(locked._id));
    const revealed = await stashes.toDto(opened, recipient._id);
    expect(revealed.state).toBe('UNLOCKED');
    expect(revealed.contentHidden).toBe(false);
    expect(revealed.text).toBe('Open when you land');
  });

  it('opens a three-person TOGETHER lock only on the last hold', async () => {
    const sender = await users.getOrCreate(maya);
    const a = await users.getOrCreate(jules);
    const b = await users.getOrCreate(sam);
    await friendships.pair(b, sender.pairingCode);

    const lock = await stashes.create(sender, {
      recipientIds: [a._id, b._id],
      text: 'group secret',
      conditionType: 'TOGETHER',
    });
    const id = String(lock._id);

    // Sam sees the lock but Sam's friend Jules does not need to be paired with Sam.
    expect((await stashes.listInbox(b)).map((l) => String(l._id))).toContain(id);

    const one = await stashes.confirm(b, id);
    expect(one.state).toBe('READY');
    const two = await stashes.confirm(sender, id);
    expect(two.state).toBe('READY');
    expect((await stashes.toDto(two, a._id)).text).toBeUndefined();

    await expect(stashes.confirm(b, id)).rejects.toThrow('You cannot unlock');

    const three = await stashes.confirm(a, id);
    expect(three.state).toBe('UNLOCKED');
    const views = await stashes.toDtoForEveryone(three);
    expect(views.size).toBe(3);
    for (const view of views.values()) {
      expect(view.text).toBe('group secret');
    }
    expect(views.get(sender._id)?.recipientName).toBe('Jules and Sam');
  });

  it('refuses a stash to someone you are not paired with', async () => {
    const sender = await users.getOrCreate(jules);
    const stranger = await users.getOrCreate({ sub: 'auth0|stranger', name: 'Stranger' });
    await expect(
      stashes.create(sender, {
        recipientIds: [stranger._id],
        text: 'hi',
        conditionType: 'MANUAL',
        conditionLabel: 'now',
      }),
    ).rejects.toThrow('paired');
  });

  it('stamps context on "I\'m here" without changing state', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    const lock = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'latte money',
      conditionType: 'MANUAL',
      context: 'coffee',
    });
    expect(lock.conditionLabel).toBe('Open when it feels right');

    expect(await stashes.markHere(recipient, 'home')).toHaveLength(0);
    const matched = await stashes.markHere(recipient, 'coffee');
    expect(matched.map((l) => String(l._id))).toEqual([String(lock._id)]);
    expect(matched[0].state).toBe('LOCKED');
    expect(matched[0].contextMetBy).toBe(recipient._id);
    const dto = await stashes.toDto(matched[0], sender._id);
    expect(dto.contextMetByName).toBe('Jules');
    expect(dto.text).toBeUndefined();

    // Second tap is a no-op: already stamped.
    expect(await stashes.markHere(recipient, 'coffee')).toHaveLength(0);
  });

  it('refuses a double-sealed unlock on a plain token', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    const lock = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'second key',
      conditionType: 'MANUAL',
      conditionLabel: 'now',
      requiresMfa: true,
    });
    const id = String(lock._id);
    await expect(stashes.confirm(recipient, id, { mfa: false })).rejects.toThrow(
      'second key',
    );
    const opened = await stashes.confirm(recipient, id, { mfa: true });
    expect(opened.state).toBe('UNLOCKED');
  });

  it('keeps a typed display name over the token name', async () => {
    const user = await users.getOrCreate({ sub: 'auth0|renamer', name: 'Token Name' });
    await users.updateProfile(user, { displayName: '  Em  ' });
    const again = await users.getOrCreate({ sub: 'auth0|renamer', name: 'Token Name' });
    expect(again.displayName).toBe('Em');
    expect(again.displayNameSet).toBe(true);
  });
});
