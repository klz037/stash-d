# Stash'd — How It Works

A shared spec. If something here is wrong, change it here first, then build. Four people cannot build against four different mental models.

---

## The unit

A **lock**.

You *stash* something (verb), and what exists afterward is a *lock* (noun). Use these two words everywhere — in the UI, in the schema, in variable names, in the pitch. Not "moment," not "card," not "item."

A lock has:
- a sender
- a recipient (can be yourself)
- content (text, optionally one photo)
- a condition, written by hand in plain language
- a state

---

## States

| State | What it means | What the recipient sees |
|---|---|---|
| `LOCKED` | Condition not yet satisfied | Sender, age, condition text. **Never the content.** |
| `READY` | One party has confirmed on a TOGETHER lock; waiting on the other | Same as locked, plus "they're waiting on you" |
| `UNLOCKED` | Content released | Everything |

Solo locks go `LOCKED → UNLOCKED` in one step. `READY` exists only for together-locks.

Once unlocked, a lock stays unlocked. No re-sealing.

---

## Condition types

Three, no more.

**1. `MANUAL` — "Open when…"**
The sender writes a condition in their own words. The recipient decides when it's been met and holds to unlock.

Nothing enforces this. That's intentional. The lock isn't security, it's a ritual — the anticipation is the product. If someone opens it early, they've cheated themselves, not the system.

**2. `TOGETHER` — "Open together"**
Both people must hold to unlock. First one to hold moves the lock to `READY`. When the second holds, it opens on both screens at once.

**3. `RECIPIENT_SET` — "You decide"**
The sender stashes content without a condition. The recipient writes the condition themselves, then unlocks whenever they decide it's been met.

Note this means a lock can exist with a null condition, briefly. The engine has to handle that.

---

## Screens

There are four. There is no nav bar.

### The Shelf (home)
One vertical scroll of locks addressed to you, newest first. Each sealed card shows:
- who it's from
- how long it's been sitting ("3 days ago")
- the condition, in a handwriting font

Nothing else. No tabs, no inbox/outbox toggle, no counts.

**Empty state doubles as onboarding.** If your shelf is empty: "Nothing's waiting for you yet" plus your pairing code and an invite link, inline. This is the only place pairing lives.

### Sent
One horizontal swipe to the right from the Shelf. Locks you've sent, with their current state. You rarely need it, so it doesn't get a tap.

### Capture
Persistent button at the bottom. Tapping it opens the camera directly, not a menu.

Flow: capture or skip → write something → pick a recipient → pick a condition → stash.

### Unlock
Not a separate route. It happens on the card, in place.

---

## Hold to unlock

Press and hold the sealed card for ~1.5 seconds. A ring traces around the seal as you hold. Release early and it snaps back. Hold to completion and it opens.

For `TOGETHER` locks, completing your hold fills your ring and leaves the other person's empty. The card polls every second. When their hold lands, both rings complete and the content opens simultaneously on both screens.

This is the most important interaction in the app. Over-invest in it.

---

## Core flow

```
A captures something
   ↓
A picks recipient + condition
   ↓
Backend stores lock as LOCKED
   ↓
B logs in, sees a sealed card on their shelf
   ↓
B holds to unlock
   ↓
Backend checks: is B the recipient?
   ↓
LOCKED → UNLOCKED
   ↓
B sees content
   ↓
Card offers: "stash something back"
   ↓
loop
```

---

## Authorization

Auth0 tells us *who*. Our own engine decides *what they may do*. Don't try to express any of this in Auth0 scopes.

Every request resolves to a user identity (`sub` from the Auth0 session). Then:

| Action | Sender | Recipient | Anyone else |
|---|---|---|---|
| Create a lock | ✅ | — | — |
| See that a lock exists | ✅ | ✅ | ❌ |
| See the content while `LOCKED` | ❌ | ❌ | ❌ |
| Unlock (`MANUAL`) | ❌ | ✅ | ❌ |
| Unlock (`TOGETHER`) | ✅ | ✅ | ❌ |
| Set the condition (`RECIPIENT_SET`) | ❌ | ✅ | ❌ |
| Change the condition after creation | ❌ | ❌ | ❌ |
| Delete | ✅ | ❌ | ❌ |

**The rule that matters:** the server strips `content` from the response for any lock in `LOCKED` or `READY` state. Not hidden in the frontend — absent from the JSON. Everything else is a detail; this is the demo.

**Self-stash:** when sender and recipient are the same person, both columns apply. Handle this case explicitly or it will silently fall through to a 403.

---

## Pairing

Two presentations of one mechanism.

Every user gets a **6-character code** (uppercase, unique) generated at first login. Entering someone's code links you to them. An **invite link** is the same code in a URL.

Both resolve to: create a friendship row between two user IDs.

No username search in the MVP. It's a different feature with its own privacy questions.

---

## Data model

```
User
  id            (Auth0 sub)
  displayName
  pairingCode   (unique, 6 chars)

Friendship
  userAId
  userBId

Lock
  id
  senderId
  recipientId
  text
  imageUrl            (nullable)
  conditionType       MANUAL | TOGETHER | RECIPIENT_SET
  conditionLabel      (nullable — null until set on RECIPIENT_SET)
  state               LOCKED | READY | UNLOCKED
  senderConfirmed     bool
  recipientConfirmed  bool
  createdAt
  unlockedAt          (nullable)
```

---

## Endpoints

```
GET    /api/locks              shelf — locks where I'm recipient
GET    /api/locks/sent         locks where I'm sender
POST   /api/locks              create
POST   /api/locks/:id/confirm  hold-to-unlock completed
POST   /api/locks/:id/condition  set condition (RECIPIENT_SET only)
POST   /api/pair               redeem a pairing code
```

Every one of these starts by resolving the session and 401-ing if there isn't one.

---

## In scope

- Auth0 login
- Pairing by code and link
- Self-stash
- Text + one photo
- Three condition types
- Hold to unlock
- Together-unlock with 1s polling
- The Shelf, Sent, Capture

## Explicitly out of scope

Cut these now, add back only if you're ahead at hour 20.

- Video, voice notes, doodles
- Push notifications (the app deliberately doesn't buzz you — this is a design position, say so in the pitch)
- Username search
- The end-of-semester moments graph
- More than three condition types
- Editing or deleting after send

---

## Constraints everyone builds to

- **Max width ~420px, centered.** Build at phone width from the first commit. We present in a phone frame.
- **No emoji in UI chrome.** Personality lives in the condition text, not the frame.
- **One accent color**, used only on the seal.
- Handwriting font for condition text only. Everything else is the UI sans.

---

## Open questions

Resolve before hour two.

1. Is a friendship required before you can stash to someone, or is a pairing code enough on its own?
2. Can you stash to someone who hasn't signed up yet?
3. Does the sender get told when their lock is opened?
