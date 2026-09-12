# Auth0 setup for stash'd

Everything the tenant needs, in the order to do it. Budget about an hour. The code side is already in the repo and off by default.

## What Auth0 does here, in one breath

Auth0 says **who**. Our engine says **what they may do**. Every domain route and the Socket.IO handshake validate an RS256 access token against the tenant JWKS. No client secret anywhere. On top of login, two things:

- **Step-up MFA on a lock.** A sender can seal a lock with a "second key". The API refuses to open it unless the access token carries `https://stashd/mfa: true`, which only the post-login Action can set, and only after the user passed a factor. The UI cannot bypass this: a plain token gets `403 { code: "MFA_REQUIRED" }` and the app sends the recipient through step-up and back to the card.
- **Passkeys** for one-tap sign-in on stage.

## 1. Applications (already done if login works)

- **API**: identifier `https://stashd-api` (this is `AUTH0_AUDIENCE` / `VITE_AUTH0_AUDIENCE`). Signing algorithm RS256.
- **Single Page Application**: callback, logout and web origin `http://localhost:5173` (plus the deployed origin). Grant the SPA access to the API.

## 2. MFA factor

Security → Multi-factor Auth.

- Enable **One-time Password** (authenticator app). Email works too but is slower on stage.
- Set the policy to **Never**. The Action below is the only thing that asks for MFA, so normal sign-in stays one tap.
- Leave "Remember browser" off. The Action disables it per-transaction anyway.

## 3. The Action

Actions → Library → Build Custom. Name `stashd-post-login`, trigger **Login / Post Login**, Node 18+. Paste [`actions/post-login.js`](./actions/post-login.js). Deploy. Then Actions → Flows → Login, drag it onto the flow, Apply.

## 4. Passkeys (optional, 5 minutes)

Authentication → Database → your connection → Authentication Methods → enable **Passkey**. Next sign-in offers to create one. Do this on each demo phone tonight, not on stage.

## 5. Turn it on in the app

`apps/web/.env`:

```
VITE_MFA_STEPUP=true
```

With this off, the "Needs a second key" toggle never renders, so nobody can create a lock that can't be opened. Turn it on only after step 3 is live.

## 6. Verify (10 minutes, do it now not at 3 AM)

1. Sign in normally. Open the account panel (tap the logo). It should say **Second key: off**. Same as `GET /api/me` → `"mfa": false`.
2. Enroll every demo account: stash any lock to yourself with "Needs a second key", hold it. You get bounced to Auth0, asked to enroll OTP, then returned. Hold again. It opens.
3. Account panel now says **Second key: on**. Sign out and back in normally: **off** again. That's the claim being per-session, which is what you want.
4. Sanity check the enforcement: with a normal session, `curl -H "Authorization: Bearer <token>" -X POST /api/locks/<id>/confirm` on a second-key lock → `403 {"code":"MFA_REQUIRED"}`.

If step 2 returns you to the app but the panel still says off, the Action isn't in the flow or wasn't deployed. Check Actions → Flows → Login.

## What we deliberately did not do

- **Organizations** for groups. Membership is managed through the Management API, which needs an M2M credential, and our groups are just recipient ids on a lock.
- **Forms** for the display name at signup. The name is editable in-app; a form would only run on login.
- **Token Vault** for Spotify. Our own token storage already works; this is the next thing to move.
