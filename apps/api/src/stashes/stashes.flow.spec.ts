import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../app.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthClaims } from '../auth/auth.types';
import { FriendshipsService } from '../friendships/friendships.service';
import { UserDocument } from '../users/schemas/user.schema';
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

  /** Pairing is two-sided: one asks, the other accepts. */
  async function pairBoth(a: UserDocument, b: UserDocument) {
    const asked = await friendships.pair(a, b.pairingCode);
    expect(asked.pending).toBe(true);
    await friendships.accept(b, a._id);
  }

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

  it('a request grants nothing until accepted, then pairs both ways', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);

    const asked = await friendships.pair(recipient, sender.pairingCode);
    expect(asked.pending).toBe(true);
    expect(await friendships.arePaired(sender._id, recipient._id)).toBe(false);
    expect((await friendships.listRequests(sender)).map((r) => r.from.id)).toEqual([
      recipient._id,
    ]);
    expect(await friendships.listRequests(recipient)).toEqual([]);

    // Entering the code back is the acceptance.
    const accepted = await friendships.pair(sender, recipient.pairingCode);
    expect(accepted.pending).toBe(false);
    expect(await friendships.arePaired(sender._id, recipient._id)).toBe(true);
    expect(await friendships.listRequests(sender)).toEqual([]);
  });

  it('pairs friends, hides content, then unlocks and reveals', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);

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

  it('pair "open together": stash back, sender starts, recipient opens both', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);

    const original = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'mine',
      conditionType: 'TOGETHER',
    });
    const id = String(original._id);

    // Nobody can hold before the stash-back.
    await expect(stashes.confirm(sender, id)).rejects.toThrow('cannot unlock');
    await expect(stashes.confirm(recipient, id)).rejects.toThrow('cannot unlock');

    const reply = await stashes.create(recipient, {
      recipientIds: [],
      text: 'yours',
      conditionType: 'MANUAL',
      replyToId: id,
    });
    expect(reply.conditionType).toBe('TOGETHER');
    expect(reply.recipientIds).toEqual([sender._id]);
    expect(reply.replyToId).toBe(id);
    expect((await stashes.toDto(await stashes.confirm(sender, id), sender._id)).replyId).toBe(
      String(reply._id),
    );

    // Sender started: READY, one-minute wait running. Recipient can't start it themselves earlier.
    const started = await stashes.toDto((await stashes.listSent(sender))[0], sender._id);
    expect(started.state).toBe('READY');
    expect(started.openingStartedAt).not.toBeNull();
    await expect(stashes.confirm(sender, id)).rejects.toThrow('cannot unlock');
    await expect(stashes.confirm(recipient, String(reply._id))).rejects.toThrow('cannot unlock');

    // Recipient opens: both locks unlock in the same moment.
    const done = await stashes.confirm(recipient, id);
    expect(done.state).toBe('UNLOCKED');
    const replyNow = (await stashes.listInbox(sender)).find((l) => String(l._id) === String(reply._id));
    expect(replyNow?.state).toBe('UNLOCKED');
    expect((await stashes.toDto(replyNow!, sender._id)).text).toBe('yours');
    expect((await stashes.toDto(done, recipient._id)).text).toBe('mine');
  });

  it('pair "open together": the sender waits out the minute and opens alone', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);

    const original = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'mine again',
      conditionType: 'TOGETHER',
    });
    const id = String(original._id);
    const reply = await stashes.create(recipient, {
      recipientIds: [],
      text: 'yours again',
      conditionType: 'TOGETHER',
      replyToId: id,
    });
    await stashes.confirm(sender, id);

    // The timer is a minute; drive it directly.
    await stashes.openAlone(id);

    const mine = (await stashes.listInbox(sender)).find((l) => String(l._id) === String(reply._id));
    expect(mine?.state).toBe('UNLOCKED');
    const theirs = (await stashes.listInbox(recipient)).find((l) => String(l._id) === id);
    expect(theirs?.state).toBe('READY');
    expect(theirs?.openedAlone).toBe(true);
    expect((await stashes.toDto(theirs!, recipient._id)).text).toBeUndefined();

    // The recipient still holds to see it.
    const opened = await stashes.confirm(recipient, id);
    expect(opened.state).toBe('UNLOCKED');
    expect((await stashes.toDto(opened, recipient._id)).text).toBe('mine again');
  });

  it('opens a three-person TOGETHER lock only on the last hold', async () => {
    const sender = await users.getOrCreate(maya);
    const a = await users.getOrCreate(jules);
    const b = await users.getOrCreate(sam);
    await pairBoth(b, sender);

    const lock = await stashes.create(sender, {
      recipientIds: [a._id, b._id],
      text: 'group secret',
      conditionType: 'TOGETHER',
    });
    const id = String(lock._id);

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

  it('saves a stash with a photo and no note', async () => {
    // Mongoose treats '' as missing for a required string. This used to 500.
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    const lock = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: '',
      imageUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      conditionType: 'MANUAL',
      conditionLabel: 'Open when you get home',
    });
    expect(lock.mediaKind).toBe('PHOTO');
    expect(lock.text).toBe('');
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

  it('stamps a moment on "I\'m here" without changing state', async () => {
    const sender = await users.getOrCreate(maya);
    const recipient = await users.getOrCreate(jules);
    const lock = await stashes.create(sender, {
      recipientIds: [recipient._id],
      text: 'latte money',
      conditionType: 'MANUAL',
      context: 'Getting  Coffee',
    });
    expect(lock.context).toBe('getting coffee');
    expect(lock.conditionLabel).toBe('Open when it feels right');

    expect(await stashes.markHere(recipient, 'at home')).toHaveLength(0);
    const matched = await stashes.markHere(recipient, 'getting coffee');
    expect(matched.map((l) => String(l._id))).toEqual([String(lock._id)]);
    expect(matched[0].state).toBe('LOCKED');
    expect(matched[0].contextMetBy).toBe(recipient._id);
    const dto = await stashes.toDto(matched[0], sender._id);
    expect(dto.contextMetByName).toBe('Jules');
    expect(dto.text).toBeUndefined();

    expect(await stashes.markHere(recipient, 'getting coffee')).toHaveLength(0);
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
