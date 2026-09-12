# stash'd

A lock you send across a distance. You *stash* something — a note, a photo, a memory — and what exists afterward is a **stash**. Your friend holds to open it when the condition is met.

This repo is a hackathon vertical slice: Auth0 login, pairing by code, create a lock, hold-to-unlock, and live Socket.IO feedback when it opens.

The product language and rules live in [`SPEC.md`](./SPEC.md) and [`PAIRING.md`](./PAIRING.md). This README is how to run the Nest + React PWA stack against them.

## Unlock rules (v1)

Three condition types. No more.

| Type | What the sender writes | How it opens |
|---|---|---|
| `MANUAL` | A plain-language condition ("Open when you land") | Recipient holds ~1.5s. Nothing enforces the words — the ritual *is* the product. |
| `TOGETHER` | Defaults to "Open together" | Both people hold. First hold moves the lock to `READY`. Second hold unlocks both screens at once via Socket.IO. |
| `RECIPIENT_SET` | Nothing. Recipient writes the condition after it arrives. | Recipient sets the label, then holds to unlock. |

States: `LOCKED` → (`READY` only for together-locks) → `UNLOCKED`. Once unlocked, it stays unlocked.

**The rule that matters:** the API strips `text` and `imageUrl` from any lock that is not `UNLOCKED`. Hidden in JSON, not just CSS.

You can only stash to **yourself** or someone you are **paired** with. Pairing is a 6-character code (`KRF-2M9` on screen, `KRF2M9` in the database). An invite link is the same code: `/pair/KRF2M9`.

The spec's three open questions are resolved — friendship is required, you cannot stash to someone who hasn't signed up, and the sender is told live when their lock opens. The answers and their reasoning live in [`SPEC.md`](./SPEC.md#resolved), not here, so there is one place to read them.

## Stack

npm workspaces. Node 20 or 22 LTS.

```
apps/api          NestJS 11 + Mongoose 8 + Auth0 JWKS JWT + Socket.IO
apps/web          React 18 SPA / PWA (Vite 6, Auth0 React SDK)
packages/shared   Shared lock / pairing types and helpers
```

| Package | Pinned |
|---|---|
| Node | `>=20 <23` (`engines.node` in the root `package.json`) |
| NestJS | `11.0.12` |
| React | `18.3.1` |
| Vite | `6.2.3` |
| Mongoose | `8.13.0` |
| `@nestjs/mongoose` | `11.0.3` |
| Auth0 SPA | `@auth0/auth0-react@2.3.0` |
| `jwks-rsa` / `passport-jwt` | `3.2.0` / `4.0.1` |
| Socket.IO | `4.8.1` |

These versions install together without peer-dependency conflicts on Node 22 (verified with `npm install` at the repo root).

## Prerequisites

- **Node.js 20 or 22** (LTS)
- **MongoDB 7** — `docker compose up -d` in this directory, or any local `MONGODB_URI`
- An **Auth0** tenant with:
  - A **Single Page Application** (React callback `http://localhost:5173`)
  - An **API** whose identifier is your audience (example: `https://stashd-api`)
  - The SPA authorized to call that API; RS256 access tokens

No Auth0 client secret is used. The SPA logs in. The Nest API validates JWTs against the tenant JWKS.

## Environment

Copy the examples. Placeholder values are fine for install and for booting the API — do not invent fake Auth0 secrets.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### `apps/api/.env`

| Variable | Purpose |
|---|---|
| `AUTH0_DOMAIN` | Tenant host, `your-tenant.auth0.com` |
| `AUTH0_AUDIENCE` | API identifier |
| `MONGODB_URI` | default `mongodb://127.0.0.1:27017/stashd` |
| `PORT` | default `3000` |
| `WEB_ORIGIN` | CORS origin, default `http://localhost:5173` |

### `apps/web/.env`

| Variable | Purpose |
|---|---|
| `VITE_AUTH0_DOMAIN` | Same tenant |
| `VITE_AUTH0_CLIENT_ID` | SPA client id |
| `VITE_AUTH0_AUDIENCE` | Same API identifier |
| `VITE_API_URL` | Leave blank in local dev (Vite proxies `/api` and `/socket.io`). Set to the API origin in production. |

Until the Vite Auth0 values are real (not the `your-tenant` placeholders), the PWA shows a configure screen instead of bouncing to Auth0.

## Local run

```bash
npm install
docker compose up -d
npm run dev
```

- API: [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)
- Web / PWA: [http://localhost:5173](http://localhost:5173)

Useful splits:

```bash
npm run dev:api
npm run dev:web
npm run build          # shared + api + web (PWA manifest + service worker)
npm test               # lock-engine unit tests
```

The JWT guard is on every domain route. `GET /api/me` without a bearer token returns **401**. `GET /api/health` is public so you can confirm Mongo is up.

## "Failed to fetch" on a deployed (Vercel) frontend

The web app is static. It has to reach the API over the internet, and the API has to let it. "Failed to fetch" right after sign-in means the browser could not complete the `/api/me` call: either it went to the wrong place or CORS blocked it. Four things, all required:

1. **The API is reachable from the internet.** A Vercel page cannot talk to `localhost:3000` on your laptop. Deploy the API (Render, Railway, Fly all work with `npm run build` then `npm run start:prod`), or expose the laptop with a tunnel for the demo. Note its public URL.
2. **`VITE_API_URL`** in the Vercel project's environment variables is that URL, no trailing slash. Redeploy after setting it; Vite bakes env vars in at build time.
3. **`WEB_ORIGIN`** on the API includes the Vercel origin, comma-separated: `http://localhost:5173,https://stash-d.vercel.app`. Every preview URL is its own origin.
4. **Auth0 SPA settings**: the Vercel URL is in Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins. Without this Auth0 refuses the redirect back, which looks like a login that never finishes.

Quick check from the deployed page's devtools console: `fetch('<API URL>/api/health').then(r => r.json())`. If that fails, it's 1 or 3. If it works but sign-in still fails, it's 2 or 4.

## After every `git pull`

```bash
npm install
npm run dev
```

`npm run dev` builds `packages/shared` first and keeps rebuilding it while you work. The API compiles against that build, not the source, so a teammate's new shared type only exists for you once it's rebuilt. If the api pane says `Module '"@stashd/shared"' has no exported member`, that's this. `npm install` covers the other one: a dependency someone added to a package.json.

## When something says "Internal Server Error"

Check these in order. They account for every 500 we've hit.

1. **Is the API running?** `curl http://127.0.0.1:3000/api/health`. If nothing answers, the Vite proxy returns a bare 500 for every `/api` call and the app shows "Internal Server Error" right after login. `npm run dev` starts both; `nest start --watch` dies silently on a compile error, so look at the api pane.
2. **Old lock documents.** Locks from before groups have `recipientId` instead of `recipientIds` and are invisible to their recipients. The migration is below. It has been run once on the shared cluster.
3. **Spotify in development mode.** Spotify answers 403 for any listener whose email isn't under **User Management** on the app in the developer dashboard. The picker now says so instead of showing an empty "recently played". Connecting with a non-listed account is refused with the same message. Add each teammate's Spotify email before the demo.

## Seeding a demo

Each teammate signs in once so their Auth0 user exists, then reads their id from `GET /api/me`. Then:

```bash
npm run seed -w @stashd/api -- --reset \
  "auth0|abc123:Maya:cmu" \
  "google-oauth2|456:Jules:pitt" \
  "auth0|789:Sam:nyu"
```

Pairs everyone with everyone, sets their schools (ids from `apps/web/src/data/academic-calendars.json`), and stashes six locks between them: a 1:1, a group TOGETHER to everyone, a coffee-context lock, a "you decide", an already-open one, and a sealed song. The first user is the main sender. `--reset` wipes every lock first.

## Demo loop

1. Two browsers, two Auth0 users.
2. Empty Stash shows your pairing code. Friend types it (or opens `/pair/XXXXXX`).
3. Capture (bottom shutter) → skip or take a photo → write a note → pick them → pick a condition → stash.
4. Friend sees a sealed polaroid. Hold ~1.5 seconds.
5. Content is revealed. Sender gets a live "unlocked" toast. Friend can stash something back.

Self-stash works with no friends: write "open when the demo starts," hold, unlock. That is the fallback if a second login fails on stage.

## API

All of these resolve the Auth0 `sub`, upsert the user (and pairing code) on first request, then authorize in-app — not with Auth0 scopes.

```
GET    /api/health
GET    /api/me
GET    /api/friends          # "Me" first
POST   /api/pair             # { code }
GET    /api/locks            # inbox (recipient)
GET    /api/locks/sent
PATCH  /api/me               # { displayName?, schoolId?, ... }
POST   /api/locks            # { recipientIds: [...], context?, requiresMfa?, ... }
POST   /api/locks/:id/confirm
POST   /api/locks/:id/condition
POST   /api/locks/here       # { context } — "I'm here"
```

A lock can go to up to eight paired people. `TOGETHER` then means everyone holds and the last hold opens every screen. `MANUAL` means any one recipient's hold opens it for all. `RECIPIENT_SET` is one person only.

A `context` (`coffee`, `walking-home`, `studying`, `home`) on a lock is a condition the app can recognise. When a recipient taps "I'm here" with the matching context, the lock's `contextMetAt` is stamped and everyone on it hears `lock:updated`. It does not change state. The hold is still the unlock.

```
GET    /api/groups
POST   /api/groups           # { name, memberIds? } → invite code
POST   /api/groups/join      # { code }
GET    /api/calendar         # your next two weeks, via Auth0 Token Vault → Google
```

Groups are pairing, N-way: a name, an invite code, a member list. Being in a group with someone lets you stash to them. Picking a group in capture fills in the lock's recipients; locks never reference the group itself.

The calendar route is the Auth0 story: the API exchanges the user's own access token for their Google token through Token Vault and reads the primary calendar. No Google credential is stored here or shown to the browser. Setup lives in [`auth0/README.md`](./auth0/README.md); without it the route reports `available: false` and nothing else changes.

Existing local data from before groups: `db.locks.drop()` is fine, it's demo data. To keep it instead:

```js
db.locks.updateMany({ recipientId: { $exists: true } }, [
  { $set: {
      recipientIds: ['$recipientId'],
      confirmedIds: { $concatArrays: [
        { $cond: ['$senderConfirmed', ['$senderId'], []] },
        { $cond: ['$recipientConfirmed', ['$recipientId'], []] } ] } } },
  { $unset: ['recipientId', 'senderConfirmed', 'recipientConfirmed'] }
])
```

Socket.IO (same origin / proxied) authenticates the access token on connect:

`lock:created` · `lock:ready` · `lock:unlocked` · `lock:updated` · `friend:paired`

Presence is tracked in memory but deliberately not broadcast — it is returned only by `GET /api/friends`, scoped to people you are paired with.

## UI notes

Phone-width (~420px), no nav bar, one accent on the polaroid, handwriting font only on the condition. Pairing lives on the empty Stash and as "Add someone" in capture — see `PAIRING.md`.

## Out of scope (on purpose)

Video, voice, push notifications, username search, editing after send. The app does not buzz you. Anticipation is the feature.
