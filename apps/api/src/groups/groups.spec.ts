import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../app.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FriendshipsService } from '../friendships/friendships.service';
import { StashesService } from '../stashes/stashes.service';
import { UsersService } from '../users/users.service';
import { GroupsService } from './groups.service';

describe('groups', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let users: UsersService;
  let friendships: FriendshipsService;
  let groups: GroupsService;
  let stashes: StashesService;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri('stashd-groups');
    process.env.AUTH0_DOMAIN = 'your-tenant.auth0.com';
    process.env.AUTH0_AUDIENCE = 'https://stashd-api';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    users = app.get(UsersService);
    friendships = app.get(FriendshipsService);
    groups = app.get(GroupsService);
    stashes = app.get(StashesService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  it('creates with paired starters, lets a stranger join by code, and unlocks stashing', async () => {
    const maya = await users.getOrCreate({ sub: 'auth0|maya', name: 'Maya' });
    const jules = await users.getOrCreate({ sub: 'auth0|jules', name: 'Jules' });
    const sam = await users.getOrCreate({ sub: 'auth0|sam', name: 'Sam' });
    await friendships.pair(jules, maya.pairingCode);

    // Sam is nobody's friend yet: cannot be a starting member.
    await expect(
      groups.create(maya, { name: 'the apartment', memberIds: [jules._id, sam._id] }),
    ).rejects.toThrow('paired');

    const group = await groups.create(maya, { name: 'the apartment', memberIds: [jules._id] });
    expect(group.memberIds).toEqual([maya._id, jules._id]);
    expect(group.inviteCode).toHaveLength(6);

    // Sam joins with the code, formatted the way it shows on screen.
    const joined = await groups.join(sam, group.inviteCodeDisplay);
    expect(joined.memberIds).toContain(sam._id);
    expect(joined.members.map((m) => m.displayName)).toEqual(['Maya', 'Jules', 'Sam']);

    // Joining again is a no-op, and everyone sees the group.
    expect((await groups.join(sam, group.inviteCode)).memberIds).toHaveLength(3);
    expect((await groups.list(jules)).map((g) => g.id)).toEqual([group.id]);

    // Sharing a group is as good as pairing: Maya can now stash to Sam.
    expect(await groups.shareGroup(maya._id, sam._id)).toBe(true);
    const lock = await stashes.create(maya, {
      recipientIds: [sam._id, jules._id],
      text: 'rent is due',
      conditionType: 'TOGETHER',
    });
    expect(lock.recipientIds).toEqual([sam._id, jules._id]);
  });

  it('refuses stashing to someone who is neither paired nor in a shared group', async () => {
    const maya = await users.getOrCreate({ sub: 'auth0|maya', name: 'Maya' });
    const ali = await users.getOrCreate({ sub: 'auth0|ali', name: 'Ali' });
    expect(await groups.shareGroup(maya._id, ali._id)).toBe(false);
    await expect(
      stashes.create(maya, {
        recipientIds: [ali._id],
        text: 'hi',
        conditionType: 'MANUAL',
        conditionLabel: 'now',
      }),
    ).rejects.toThrow('paired');
  });

  it('rejects an unknown code', async () => {
    const maya = await users.getOrCreate({ sub: 'auth0|maya', name: 'Maya' });
    await expect(groups.join(maya, 'ZZZ-ZZZ')).rejects.toThrow('group code');
  });
});
