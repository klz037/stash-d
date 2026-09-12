#!/usr/bin/env node
/**
 * Demo seed. Pairs a set of real Auth0 users with each other, gives them
 * schools, and stashes a spread of locks between them so the Stash is full
 * on stage: a 1:1 MANUAL, a group TOGETHER, a coffee-context lock, a
 * "you decide", an unlocked one, and a sealed song sleeve.
 *
 * Users have to exist in Auth0 to log in, so pass real subs. Each teammate
 * signs in once, then reads their id from GET /api/me (or the account panel
 * shows "name · CODE" and the id is the Auth0 sub).
 *
 *   npm run seed -w @stashd/api -- \
 *     "auth0|abc123:Maya:cmu" \
 *     "google-oauth2|456:Jules:ucla" \
 *     "auth0|789:Sam:nyu"
 *
 * Each arg is  <sub>:<displayName>[:<schoolId>]  (schoolId from
 * apps/web/src/data/academic-calendars.json). Order matters: the first user
 * is the main sender in the demo. Add --reset to wipe every lock first.
 * MONGODB_URI is read from the environment or apps/api/.env.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const here = dirname(fileURLToPath(import.meta.url));
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function loadEnv() {
  if (process.env.MONGODB_URI) return;
  for (const file of [resolve(here, '../.env'), resolve(here, '../../../.env')]) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*MONGODB_URI\s*=\s*(.+?)\s*$/);
        if (m) {
          process.env.MONGODB_URI = m[1];
          return;
        }
      }
    } catch {
      // next
    }
  }
}

function code() {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function parseArgs(argv) {
  const reset = argv.includes('--reset');
  const users = argv
    .filter((a) => !a.startsWith('--'))
    .map((raw) => {
      const [sub, displayName, schoolId] = raw.split(':').map((s) => s.trim());
      if (!sub || !displayName) {
        throw new Error(`Bad user arg "${raw}". Expected <sub>:<name>[:<schoolId>]`);
      }
      return { sub, displayName, schoolId };
    });
  if (users.length < 2) {
    throw new Error('Pass at least two users. See the header of this script.');
  }
  return { reset, users };
}

function schools() {
  const file = resolve(here, '../../web/src/data/academic-calendars.json');
  return JSON.parse(readFileSync(file, 'utf8')).schools;
}

async function main() {
  loadEnv();
  const { reset, users } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/stashd';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const Users = db.collection('users');
  const Friendships = db.collection('friendships');
  const Locks = db.collection('locks');
  const bySchool = new Map(schools().map((s) => [s.id, s]));
  const now = new Date();
  const ago = (hours) => new Date(now.getTime() - hours * 3_600_000);

  if (reset) {
    const { deletedCount } = await Locks.deleteMany({});
    console.log(`reset: removed ${deletedCount} locks`);
  }

  // Users. Keep whatever pairing code / name they already have; only fill gaps.
  for (const u of users) {
    const school = u.schoolId ? bySchool.get(u.schoolId) : null;
    if (u.schoolId && !school) throw new Error(`Unknown schoolId "${u.schoolId}"`);
    const existing = await Users.findOne({ _id: u.sub });
    const set = {
      updatedAt: now,
      ...(school ? { schoolId: school.id, schoolName: school.name, city: school.city } : {}),
    };
    if (!existing) {
      await Users.insertOne({
        _id: u.sub,
        displayName: u.displayName,
        displayNameSet: true,
        pairingCode: code(),
        createdAt: now,
        ...set,
      });
      console.log(`user: created ${u.displayName} (${u.sub})`);
    } else {
      await Users.updateOne(
        { _id: u.sub },
        { $set: { ...set, displayName: u.displayName, displayNameSet: true } },
      );
      console.log(`user: updated ${u.displayName} (${u.sub})`);
    }
  }

  // Everyone paired with everyone.
  let pairs = 0;
  for (let i = 0; i < users.length; i += 1) {
    for (let j = i + 1; j < users.length; j += 1) {
      const [userAId, userBId] = [users[i].sub, users[j].sub].sort();
      const r = await Friendships.updateOne(
        { userAId, userBId },
        {
          $setOnInsert: { userAId, userBId, createdAt: now, updatedAt: now },
          // Seeded pairs are already accepted; nobody should have to tap through requests on stage.
          $set: { status: 'ACCEPTED', requestedBy: null },
        },
        { upsert: true },
      );
      if (r.upsertedCount) pairs += 1;
    }
  }
  console.log(`friendships: ${pairs} new`);

  const [a, b, c] = users;
  const all = users.map((u) => u.sub);
  const base = {
    imageUrl: undefined,
    song: null,
    mediaKind: 'TEXT',
    context: null,
    contextMetAt: null,
    contextMetBy: null,
    requiresMfa: false,
    state: 'LOCKED',
    confirmedIds: [],
    unlockedAt: null,
  };
  const locks = [
    {
      ...base,
      senderId: a.sub,
      recipientIds: [b.sub],
      text: 'I left the porch light on. Call me when you see it.',
      conditionType: 'MANUAL',
      conditionLabel: 'Open when you land',
      createdAt: ago(72),
    },
    {
      ...base,
      senderId: a.sub,
      recipientIds: all.filter((id) => id !== a.sub),
      text: `Same time next year. All of us. I'm booking it now.`,
      conditionType: 'TOGETHER',
      conditionLabel: 'Open together',
      createdAt: ago(30),
    },
    {
      ...base,
      senderId: b.sub,
      recipientIds: [a.sub],
      text: 'This one is for the first coffee after a bad night.',
      conditionType: 'MANUAL',
      conditionLabel: "Open when you're getting coffee",
      context: 'coffee',
      createdAt: ago(20),
    },
    {
      ...base,
      senderId: (c ?? b).sub,
      recipientIds: [a.sub],
      text: 'You pick the moment. I trust you.',
      conditionType: 'RECIPIENT_SET',
      conditionLabel: null,
      createdAt: ago(9),
    },
    {
      ...base,
      senderId: b.sub,
      recipientIds: [a.sub],
      text: 'Told you the exam would be fine.',
      conditionType: 'MANUAL',
      conditionLabel: 'Open after the exam',
      state: 'UNLOCKED',
      confirmedIds: [a.sub],
      unlockedAt: ago(4),
      createdAt: ago(50),
    },
    {
      ...base,
      senderId: a.sub,
      recipientIds: [b.sub],
      text: 'Walk home with this one on.',
      mediaKind: 'SONG',
      song: {
        trackId: 'seed',
        title: 'Seeded track',
        artist: 'Replace via Spotify on stage',
        albumArtUrl: 'https://placehold.co/600x600/2a211a/f3ead8?text=%E2%99%AA',
        spotifyUrl: 'https://open.spotify.com/',
      },
      conditionType: 'MANUAL',
      conditionLabel: "Open when you're walking home",
      context: 'walking-home',
      createdAt: ago(2),
    },
  ].map((l) => ({ ...l, updatedAt: l.createdAt }));

  const { insertedCount } = await Locks.insertMany(locks);
  console.log(`locks: ${insertedCount} stashed`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
