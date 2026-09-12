# Stash'd — Pairing

How two people become connected. One mechanism, two presentations.

---

## The principle

There is exactly **one** pairing primitive: a code that resolves to a user. An invite link is that same code wrapped in a URL. Building "two ways to pair" costs about twenty extra minutes, not a second feature.

No username search in the MVP. It's a genuinely different feature — it needs public handles, a search endpoint, and a decision about whether strangers can reach you — and this app is about two people who already know each other.

---

## The code

Every user gets a permanent 6-character code at first login.

**Alphabet:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789`

No `I`, `O`, `0`, `1`, or `L`. Someone is going to read this out loud across a room, and "is that an oh or a zero" is how the demo dies.

**Display format:** `KRF-2M9` — two groups of three, hyphen for readability only.

**Stored format:** `KRF2M9` — no hyphen, uppercase.

**Input handling:** strip everything non-alphanumeric, uppercase it, then look it up. Someone will type `krf 2m9` and it must work.

31 characters to the 6th is about 887 million combinations. Generate, check for collision, regenerate on the rare clash.

### Permanent, not rotating

Your code is stable — it's effectively your handle. Rotating codes would be more secure, but the threat model here is "a stranger guesses 1 in 887 million," which is not a threat model. Permanence means you can put your code in your Instagram bio, which is how this app would actually spread.

Worth saying out loud if a judge asks: we'd add regeneration in a real product, we didn't in 24 hours.

---

## Where the code comes from

Generate it **lazily, in your own database, on first authenticated request.** Not in an Auth0 Action.

```
getOrCreateUser(session):
  find user where id == session.user.sub
  if none:
    create user {
      id: session.user.sub,
      displayName: session.user.name,
      pairingCode: generateUniqueCode()
    }
  return user
```

Every API route calls this first. It means "sign up" doesn't exist as a concept — logging in for the first time *is* signing up.

You *could* do this in a post-login Action and stamp the code into the token as a custom claim. It's more elegant and it's a nicer thing to say to an Auth0 judge. It's also a slower feedback loop to debug at 3am. Do it lazily first; upgrade later if you have time.

---

## The two presentations

### 1. Code entry

You have a code. You type theirs. Done.

```
"Enter your friend's code"
[ K R F - 2 M 9 ]
```

Six boxes, auto-advance, paste-aware. This is the one you use in the live demo, because someone reading six characters aloud while their friend types is visible from the back of the room. A URL is not.

### 2. Invite link

```
https://stashd.app/pair/KRF2M9
```

Same code, different envelope. You text it, they tap it.

**The flow, including the Auth0 part:**

```
B taps the link
   ↓
/pair/KRF2M9  →  is there a session?
   ↓ no
redirect to /auth/login?returnTo=/pair/KRF2M9
   ↓
Auth0 Universal Login
   ↓
back to /pair/KRF2M9, now with a session
   ↓
getOrCreateUser  →  B now exists, with their own code
   ↓
redeem KRF2M9  →  friendship created
   ↓
land on the Stash
```

That `returnTo` parameter is the whole trick. Without it, a new user logs in and lands on an empty Stash with no idea why they clicked the link. With it, the pairing survives the round trip through Auth0.

**Copy while they wait:** "Getting you connected to Maya." Not a spinner with nothing on it.

---

## Redemption rules

Pairing is **instant and symmetric**. No accept/decline step.

Rationale: a confirmation step costs a tap and about ninety seconds of demo time to explain. The code is a secret you chose to share; sharing it *is* the consent. If a judge pushes, the honest answer is that a real product would add a confirm screen and we'd put it there first.

Symmetric means one friendship, not two follows. Store it once with a canonical ordering so the unique constraint actually does its job:

```
Friendship
  userAId   ← lexicographically smaller of the two ids
  userBId
  createdAt

  @@unique([userAId, userBId])
```

Always sort the pair before inserting. Otherwise you get two rows for the same friendship and every query needs an OR.

### Cases to handle

| Input | Behavior |
|---|---|
| Your own code | "That's your code. Send it to a friend instead." |
| Already paired | No error. Navigate to the Stash as if it worked. |
| Code doesn't exist | "We couldn't find that code. Check the letters?" |
| Lowercase / spaces / hyphens | Normalize silently. Always works. |
| Not logged in | `returnTo` through Auth0, then redeem. |

Nothing here should ever produce a stack trace or a raw 404 page. It's the first thing a new user touches.

---

## Where pairing lives in the UI

There is no nav bar, so pairing needs homes that aren't a settings screen.

**Primary: the empty Stash.** If nothing is waiting for you, the Stash *is* the pairing screen.

```
        Nothing's waiting for you yet.

        Your code
          KRF-2M9
        [ Copy invite link ]

        ─────── or ───────

        Enter a friend's code
        [ _ _ _ - _ _ _ ]
```

This is elegant: onboarding costs zero extra screens, and it disappears forever once you have one lock.

**Secondary: the recipient picker.** When you're stashing something, the list of friends ends with "Add someone." That's where a second friend gets added.

That's it. Two entry points, neither of them a menu.

---

## Self-stash solves cold start

You are always able to stash to yourself. No pairing required.

The recipient picker always shows **Me** at the top, above any friends.

This matters more than it sounds. A new user with no friends is not looking at a dead app — they can immediately write "open when finals are over" to themselves. It's also demo insurance: if your partner's login breaks on stage, you can still show capture, seal, hold, and unlock solo.

In the engine, `senderId === recipientId` is a real case. Handle it explicitly or the authorization branch will silently fall through to a 403.

---

## Data model additions

```
User
  id            (Auth0 sub)
  displayName
  pairingCode   (unique, 6 chars, uppercase)
  createdAt

Friendship
  userAId       (canonical: smaller id)
  userBId
  createdAt
  @@unique([userAId, userBId])
```

---

## Endpoints

```
GET   /api/me          → { id, displayName, pairingCode }
                         also lazily creates the user
GET   /api/friends     → friends list for the recipient picker,
                         with "me" always first
POST  /api/pair        → body: { code }
                         normalizes, validates, creates friendship
```

Plus the page route `/pair/[code]` that handles the invite-link flow above.

---

## Does pairing gate stashing?

**Yes.** You can only stash to yourself or to someone you're paired with. The recipient picker only shows those people, so this is enforced by the UI naturally — but check it server-side too, because the UI is not a security boundary.

---

## Stretch: the invite link that carries a lock

Only if you're ahead. This is the best possible first-run experience and it's a strong thing to show a judge.

Instead of "join my app," the invite is:

> **Maya stashed something for you.**
> Sign in to see what's waiting.

The sender picks "someone who isn't here yet," writes the lock, and gets a link. The recipient's very first screen after login is a sealed polaroid, not an empty Stash.

Implementation sketch: give `Lock` a nullable `pendingRecipientCode`. Create the lock with `recipientId = null` and a one-time invite token. On successful pair, claim any pending locks matching that token and set `recipientId`.

**Do not start this before the core loop works.** It touches the schema, and schema changes after four people have built against it are the expensive kind.

---

## Open questions

1. Do we cap friendships? (Probably not, but the product argues for a small number.)
2. Does the invite link expire? (Recommend: no, in the MVP.)
3. Can you unpair? (Recommend: out of scope. Nobody will try it in a demo.)
