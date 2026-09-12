# Auth0 in stash'd

Auth0 does two jobs here. It says **who** (login, and our engine decides what they may do), and it **holds the user's Google credential** so the API can read their calendar on their behalf without ever storing a Google token itself. The second one is Token Vault.

## Why Token Vault, and why calendar

The product runs on knowing what's going on in a friend's life without anyone typing it in. Weather and local time come from the school in the profile. The one thing a school can't tell us is *your* week: the exam, the flight, the interview. That lives in the user's Google Calendar.

The obvious way is to build our own Google OAuth flow and store refresh tokens in Mongo, which is exactly what we did for Spotify. Token Vault removes that whole surface. The user signs in with Google once. Auth0 stores the Google refresh token. When the API wants a calendar, it exchanges the user's own Auth0 access token, the same one that proved who they are on this request, for a short-lived Google access token, and calls Google with it. The browser never sees a Google credential. The API never stores one. There's no second login and no consent screen inside our app.

Code: [`apps/api/src/calendar/calendar.service.ts`](../apps/api/src/calendar/calendar.service.ts). Prompts built from it: [`apps/web/src/lib/prompts.ts`](../apps/web/src/lib/prompts.ts), the "on your calendar" cards.

## Tenant setup (about 45 minutes)

### 1. Applications (already done if login works)

- **API**: identifier `https://stashd-api`, RS256. This is `AUTH0_AUDIENCE`.
- **Single Page Application**: callback, logout and web origin `http://localhost:5173` plus the deployed origin. Grant it access to the API.

### 2. Google connection with calendar scope

Authentication → Social → Google. Use your own Google Cloud OAuth client, not Auth0 dev keys (dev keys don't return refresh tokens, and Token Vault needs one).

- In Google Cloud, enable the **Google Calendar API** on the project and add `https://<your-tenant>.auth0.com/login/callback` as an authorized redirect.
- In the Auth0 connection, tick the **Calendar** permission (or add `https://www.googleapis.com/auth/calendar.readonly` under extended scopes) and enable **offline access**.
- Turn on **Token Vault** for this connection (the toggle is on the connection's settings, under Token Vault / federated connections).
- Enable the connection for the SPA.

### 3. A Custom API Client for the exchange

The exchange is a backend call and needs a client credential for the API. Applications → APIs → `stashd-api` → **Custom API Clients** (on some tenants this is under the API's Settings). Create one, enable the **Token Vault** grant on it, and copy its client id and secret into `apps/api/.env`:

```
AUTH0_TOKEN_VAULT_CLIENT_ID=...
AUTH0_TOKEN_VAULT_CLIENT_SECRET=...
AUTH0_CALENDAR_CONNECTION=google-oauth2
```

This is a real credential Auth0 issued for our API. It lives on the server only. Without it the calendar simply reports "unavailable" and nothing else changes.

### 4. Passkeys (optional, 5 minutes)

Authentication → Database → your connection → Authentication Methods → **Passkey**. Register one per demo phone tonight, not on stage.

## Verify (10 minutes)

1. Restart the API. Sign in **with Google** on a demo account.
2. Open the profile menu (avatar, top right). Under school it should say **Google Calendar connected**. `GET /api/calendar` returns `status.connected: true` and your next two weeks in `events`.
3. Put an event on that Google calendar for tomorrow. Reload. A card titled with the event appears in the prompt rail with the kicker "you wrote this down" and "Stash something Maya opens once it's done."
4. Sign in with email/password instead. The menu says **not connected** with the reason from Auth0. That's the expected answer, not a bug.

If step 2 says not connected after a Google sign-in, the usual causes in order: Token Vault not enabled on the connection, the connection using Auth0 dev keys, or the Custom API Client missing the Token Vault grant. The API logs the exchange error at debug level.

## What we deliberately did not do

- **Step-up MFA on a lock.** We built it, then took it out of the UI. Asking someone for a second factor to open a note from a friend is the wrong feeling for this product. The server-side gate still exists and is dormant.
- **Organizations** for groups. Membership is managed through the Management API and needs its own credential; our groups are an invite code and a member list, same as pairing.
- **Moving Spotify onto Token Vault.** Spotify isn't a built-in social connection. It would work as a custom social connection, and it's the next thing we'd fold in so the API stores no third-party tokens at all.
