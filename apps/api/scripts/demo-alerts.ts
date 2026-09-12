/* eslint-disable no-console */
/**
 * Seed a demo social graph so stash alerts have something to say.
 *
 *   npm run demo:alerts -- --email you@example.com
 *   npm run demo:alerts -- --me "auth0|abc123"
 *   npm run demo:alerts -- --email you@example.com --reset
 *
 * Creates five demo friends across CMU / Pitt / NYU, pairs them with you, and
 * adds one group — friends + groups = 6, which puts you over the >4 threshold
 * so the daily alert budget is 3–4. Nothing here touches Auth0: demo users are
 * plain Mongo rows with ids prefixed `demo|`, and --reset removes only those.
 */
import mongoose from 'mongoose';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '..', '.env') });
loadEnv({ path: resolve(__dirname, '..', '..', '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stashd';

const DEMO_FRIENDS = [
  { id: 'demo|maya-pitt', displayName: 'Maya', schoolId: 'pitt', schoolName: 'University of Pittsburgh', city: 'Pittsburgh', code: 'DEMO01' },
  { id: 'demo|jordan-cmu', displayName: 'Jordan', schoolId: 'cmu', schoolName: 'Carnegie Mellon', city: 'Pittsburgh', code: 'DEMO02' },
  { id: 'demo|sam-nyu', displayName: 'Sam', schoolId: 'nyu', schoolName: 'New York University', city: 'New York', code: 'DEMO03' },
  { id: 'demo|priya-pitt', displayName: 'Priya', schoolId: 'pitt', schoolName: 'University of Pittsburgh', city: 'Pittsburgh', code: 'DEMO04' },
  { id: 'demo|leo-cmu', displayName: 'Leo', schoolId: 'cmu', schoolName: 'Carnegie Mellon', city: 'Pittsburgh', code: 'DEMO05' },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  const users = db.collection('users');
  const friendships = db.collection('friendships');
  const groups = db.collection('groups');
  const alerts = db.collection('stash_alerts');

  type UserRow = { _id: string; displayName: string; email?: string };
  const meId = arg('me');
  const email = arg('email');
  let me: UserRow | null = meId
    ? ((await users.findOne({ _id: meId as never })) as UserRow | null)
    : email
      ? ((await users.findOne({ email })) as UserRow | null)
      : null;

  if (!me) {
    const real = (await users
      .find({ _id: { $not: /^demo\|/ } as never })
      .project({ _id: 1, displayName: 1, email: 1 })
      .toArray()) as unknown as UserRow[];
    if (!meId && !email && real.length === 1) {
      me = real[0];
    } else {
      console.error(
        meId || email
          ? `No user found for ${meId ?? email}. Sign in to the web app once first so your account exists.`
          : 'Which account should get the demo friends? Pass --email or --me. Known users:',
      );
      for (const row of real) {
        console.error(`  --me "${row._id}"   (${row.displayName}${row.email ? `, ${row.email}` : ''})`);
      }
      process.exit(1);
    }
  }

  const myId = String(me!._id);

  if (has('reset')) {
    const demoIds = DEMO_FRIENDS.map((f) => f.id);
    await friendships.deleteMany({ $or: [{ userAId: { $in: demoIds } }, { userBId: { $in: demoIds } }] });
    await groups.deleteMany({ inviteCode: 'DEMO99' });
    await users.deleteMany({ _id: { $in: demoIds } as never });
    const wiped = await alerts.deleteMany({ userId: myId });
    console.log(`Removed demo friends, the demo group, and ${wiped.deletedCount} alert(s) for ${me!.displayName}.`);
    await mongoose.disconnect();
    return;
  }

  for (const friend of DEMO_FRIENDS) {
    await users.updateOne(
      { _id: friend.id as never },
      {
        $setOnInsert: {
          _id: friend.id,
          displayName: friend.displayName,
          displayNameCustomized: true,
          pairingCode: friend.code,
          locationSharing: false,
          stashAlertsEnabled: false,
          createdAt: new Date(),
        },
        $set: {
          schoolId: friend.schoolId,
          schoolName: friend.schoolName,
          city: friend.city,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    const [userAId, userBId] = [myId, friend.id].sort();
    await friendships.updateOne(
      { userAId, userBId },
      {
        $setOnInsert: { userAId, userBId, createdAt: new Date() },
        $set: { status: 'ACCEPTED', updatedAt: new Date() },
      },
      { upsert: true },
    );
  }

  await groups.updateOne(
    { inviteCode: 'DEMO99' },
    {
      $setOnInsert: {
        name: 'Demo squad',
        inviteCode: 'DEMO99',
        createdBy: myId,
        createdAt: new Date(),
      },
      $set: {
        memberIds: [myId, ...DEMO_FRIENDS.slice(0, 3).map((f) => f.id)],
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  if (has('fresh-day')) {
    const wiped = await alerts.deleteMany({ userId: myId });
    console.log(`Cleared ${wiped.deletedCount} alert(s) so today's budget starts at 0.`);
  }

  const friendCount = await friendships.countDocuments({
    $or: [{ userAId: myId }, { userBId: myId }],
    status: { $ne: 'PENDING' },
  });
  const groupCount = await groups.countDocuments({ memberIds: myId });

  console.log(`\nSeeded for ${me!.displayName} (${myId})`);
  console.log(`  friends: ${friendCount}   groups: ${groupCount}   → friends+groups = ${friendCount + groupCount} (${friendCount + groupCount > 4 ? 'over 4: budget is 3–4/day' : '4 or fewer: budget is 2/day'})`);
  console.log('\nDemo friends and their schools:');
  for (const f of DEMO_FRIENDS) console.log(`  ${f.displayName.padEnd(8)} ${f.schoolName}`);
  console.log(`
Next:
  1. npm run dev, open http://localhost:5173 and sign in as ${me!.email ?? me!.displayName}.
  2. Tap the wordmark → Stash alerts → On (allow notifications).
  3. Tap "preview today's alerts" to see the full day's set, or "send one now"
     to fire a real one. Each alert is about a friend's school, never yours.
  4. Re-run with --fresh-day to reset today's budget, or --reset to remove everything.
`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
