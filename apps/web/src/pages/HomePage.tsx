import {
  CONTEXT_LABELS,
  CONTEXTS,
  FriendDto,
  FriendNoteDto,
  LockContext,
  LockDto,
  MFA_ACR_VALUE,
  MFA_REQUIRED,
  PromptDto,
  SOCKET_EVENTS,
  UserDto,
} from '@stashd/shared';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '../components/Brand';
import { CaptureSheet } from '../components/CaptureSheet';
import { PairingCodeInput } from '../components/PairingCodeInput';
import { Polaroid } from '../components/Polaroid';
import { PromptCard } from '../components/PromptCard';
import { ToastStack } from '../components/ToastStack';
import { api, ApiError } from '../lib/api';
import { auth0, mfaStepUp } from '../lib/config';
import { buildPrompts, dismissPrompt, SCHOOL_OPTIONS, schoolLocation } from '../lib/prompts';
import { buildSkyPrompts, SkyMap, suggestConditions } from '../lib/sky';
import { connectRealtime, disconnectRealtime } from '../lib/socket';
import { describeSky, fetchSky, localClock, Sky } from '../lib/weather';

const NOTIFIED_KEY = 'stashd.skyNotified';

function upsertLock(list: LockDto[], next: LockDto) {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [next, ...list];
  }
  const copy = [...list];
  copy[index] = next;
  return copy;
}

function loadNotified(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function HomePage() {
  const { getAccessTokenSilently, loginWithRedirect, logout, user: authUser } = useAuth0();
  const [me, setMe] = useState<UserDto | null>(null);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [inbox, setInbox] = useState<LockDto[]>([]);
  const [sent, setSent] = useState<LockDto[]>([]);
  const [notes, setNotes] = useState<FriendNoteDto[]>([]);
  const [skies, setSkies] = useState<SkyMap>({});
  const [showSent, setShowSent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [replyTo, setReplyTo] = useState<string>();
  const [pairError, setPairError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteFriendId, setNoteFriendId] = useState('');
  const [hereBusy, setHereBusy] = useState<LockContext | null>(null);
  const [promptTick, setPromptTick] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const tokenRef = useRef('');
  const touchStart = useRef<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  // Mirrors `sent` so socket handlers can diff against the last known state
  // without becoming stale closures.
  const sentRef = useRef<LockDto[]>([]);
  sentRef.current = sent;

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }, []);

  const token = useCallback(async () => {
    const value = await getAccessTokenSilently();
    tokenRef.current = value;
    return value;
  }, [getAccessTokenSilently]);

  const refresh = useCallback(async () => {
    const access = await token();
    const [profile, friendList, incoming, outgoing] = await Promise.all([
      api.me(access),
      api.friends(access),
      api.inbox(access),
      api.sent(access),
    ]);
    setMe(profile);
    setFriends(friendList);
    setInbox(incoming);
    setSent(outgoing);
    try {
      setNotes(await api.notes(access));
    } catch {
      setNotes([]);
    }
  }, [token]);

  refreshRef.current = refresh;

  useEffect(() => {
    void refresh().catch((err) =>
      toast(err instanceof Error ? err.message : 'Could not load.'),
    );
  }, [refresh, toast]);

  useEffect(() => {
    let active = true;
    void token().then((access) => {
      if (!active) return;
      const socket = connectRealtime(access);

      const onConnect = () => {
        void refreshRef.current();
      };
      socket.on('connect', onConnect);
      if (socket.connected) {
        onConnect();
      }

      socket.on(SOCKET_EVENTS.lockCreated, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        toast(
          lock.recipients.length > 1
            ? `${lock.senderName} stashed something for ${lock.recipients.length} of you.`
            : `${lock.senderName} stashed something for you.`,
        );
      });
      socket.on(SOCKET_EVENTS.lockReady, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        const left = lock.participantIds.length - lock.confirmedIds.length;
        toast(
          lock.participantIds.length > 2
            ? `${lock.confirmedIds.length} holding. ${left} to go.`
            : "They're holding with you.",
        );
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUnlocked, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        toast(lock.contentHidden ? 'A lock just opened.' : 'Unlocked.');
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUpdated, (lock: LockDto) => {
        const before = sentRef.current.find((item) => item.id === lock.id);
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        // The sender's moment: a recipient just said "I'm here."
        if (lock.contextMetAt && !before?.contextMetAt && lock.context && lock.contextMetByName) {
          toast(
            `${lock.contextMetByName} is ${CONTEXT_LABELS[lock.context]}. Your lock is ready to open.`,
          );
        }
      });
      socket.on(SOCKET_EVENTS.friendPaired, () => {
        void refreshRef.current();
        toast('You are paired.');
      });
    });
    return () => {
      active = false;
      disconnectRealtime();
    };
  }, [toast, token]);

  useEffect(() => {
    const needsPoll = [...inbox, ...sent].some((lock) => lock.state === 'READY');
    if (!needsPoll) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void refreshRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [inbox, sent]);

  // Every school on the friend list (and mine) gets a sky: weather, local
  // time, sunrise, sunset. Refreshed every ten minutes; never the device.
  useEffect(() => {
    const ids = new Set<string>();
    if (me?.schoolId) ids.add(me.schoolId);
    for (const friend of friends) {
      if (friend.schoolId) ids.add(friend.schoolId);
    }
    if (ids.size === 0) {
      setSkies({});
      return undefined;
    }
    let active = true;
    async function load() {
      const entries = await Promise.all(
        [...ids].map(async (id) => {
          const school = schoolLocation(id);
          if (!school) return [id, undefined] as const;
          return [id, (await fetchSky(school)) ?? undefined] as const;
        }),
      );
      if (!active) return;
      const next: SkyMap = {};
      for (const [id, sky] of entries) next[id] = sky;
      setSkies(next);
    }
    void load();
    const id = window.setInterval(() => void load(), 10 * 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [me?.schoolId, friends]);

  // Sunrise and "it's 11 PM for Maya" depend on the clock, not on data.
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  async function confirm(id: string) {
    try {
      const lock = await api.confirm(tokenRef.current || (await token()), id);
      setInbox((current) => upsertLock(current, lock));
      setSent((current) => upsertLock(current, lock));
    } catch (err) {
      if (err instanceof ApiError && err.code === MFA_REQUIRED) {
        // The server refused without the MFA claim. Go get a token that has it.
        toast('This one needs your second key. One sec…');
        await loginWithRedirect({
          authorizationParams: { acr_values: MFA_ACR_VALUE, audience: auth0.audience },
          appState: { returnTo: '/' },
        });
        return;
      }
      toast(err instanceof Error ? err.message : 'Could not unlock.');
    }
  }

  async function setCondition(id: string, conditionLabel: string) {
    const lock = await api.setCondition(
      tokenRef.current || (await token()),
      id,
      conditionLabel,
    );
    setInbox((current) => upsertLock(current, lock));
  }

  async function saveName() {
    const name = nameDraft.trim();
    if (!name) {
      return;
    }
    try {
      const profile = await api.updateProfile(tokenRef.current || (await token()), {
        displayName: name,
      });
      setMe(profile);
      setNameDraft('');
      toast(`Friends will see you as ${profile.displayName}.`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your name.');
    }
  }

  async function saveSchool(schoolId: string) {
    const school = SCHOOL_OPTIONS.find((item) => item.id === schoolId);
    if (!school) {
      return;
    }
    const profile = await api.updateProfile(tokenRef.current || (await token()), {
      schoolId: school.id,
      schoolName: school.name,
      city: school.city,
    });
    setMe(profile);
    toast(`Campus set to ${school.name}.`);
    setPromptTick((value) => value + 1);
  }

  async function saveNote() {
    if (!noteFriendId || !noteDraft.trim()) {
      return;
    }
    await api.createNote(tokenRef.current || (await token()), {
      friendId: noteFriendId,
      text: noteDraft.trim(),
    });
    setNoteDraft('');
    toast('Saved to your notebook.');
    setPromptTick((value) => value + 1);
    await refresh();
  }

  async function here(context: LockContext) {
    setHereBusy(context);
    try {
      const result = await api.here(tokenRef.current || (await token()), context);
      for (const lock of result.matched) {
        setInbox((current) => upsertLock(current, lock));
      }
      if (result.matched.length === 0) {
        toast(`Nothing here is waiting for ${CONTEXT_LABELS[context]}.`);
      } else {
        const senders = [...new Set(result.matched.map((lock) => lock.senderName))];
        toast(
          `Told ${senders.join(' and ')}. Hold ${
            result.matched.length === 1 ? 'the card' : 'the cards'
          } when you're ready.`,
        );
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not check in.');
    } finally {
      setHereBusy(null);
    }
  }

  const viewerId = me?.id ?? authUser?.sub ?? '';
  // The API finishes the Spotify handshake and sends the browser back here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('spotify');
    if (!result) {
      return;
    }
    toast(
      result === 'connected'
        ? 'Spotify connected.'
        : result === 'declined'
          ? 'Spotify stays disconnected.'
          : 'Could not connect Spotify. Try again.',
    );
    if (result === 'connected') {
      void refresh();
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [refresh, toast]);

  const empty = inbox.length === 0;
  const sortedInbox = useMemo(
    () => [...inbox].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inbox],
  );
  // Only show the "I'm here" row when some sealed card is actually waiting on a moment.
  const waitingContexts = useMemo(
    () =>
      new Set(
        inbox
          .filter((lock) => lock.state !== 'UNLOCKED' && lock.context && !lock.contextMetAt)
          .map((lock) => lock.context as LockContext),
      ),
    [inbox],
  );
  const mySky: Sky | null = me?.schoolId ? (skies[me.schoolId] ?? null) : null;
  const skyPrompts = useMemo(() => {
    if (!me) {
      return [] as PromptDto[];
    }
    return buildSkyPrompts({ me, friends, skies });
    // clockTick re-runs this every minute so sunrise / late-night prompts appear on time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, friends, skies, promptTick, clockTick]);
  const prompts = useMemo(() => {
    if (!me) {
      return [] as PromptDto[];
    }
    const weather = mySky ? { tempF: mySky.tempF, label: mySky.label } : null;
    return [...skyPrompts, ...buildPrompts({ me, friends, inbox, sent, notes, weather })].slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, friends, inbox, sent, notes, mySky, skyPrompts, promptTick]);

  // A sky prompt is the closest thing this app has to a notification: the
  // first time one appears, it also lands as a toast. Once per trigger.
  useEffect(() => {
    if (skyPrompts.length === 0) return;
    const seen = loadNotified();
    const fresh = skyPrompts.filter((prompt) => !seen.includes(prompt.triggerKey));
    if (fresh.length === 0) return;
    for (const prompt of fresh) {
      toast(`${prompt.title}. ${prompt.body}`);
    }
    try {
      localStorage.setItem(
        NOTIFIED_KEY,
        JSON.stringify([...seen, ...fresh.map((p) => p.triggerKey)].slice(-200)),
      );
    } catch {
      // ignore
    }
  }, [skyPrompts, toast]);

  const suggestFor = useCallback(
    (recipientIds: string[]) => {
      const recipientSkies = friends
        .filter((friend) => recipientIds.includes(friend.id) && friend.schoolId)
        .map((friend) => skies[friend.schoolId as string])
        .filter((sky): sky is Sky => Boolean(sky));
      return suggestConditions(recipientSkies);
    },
    [friends, skies],
  );

  const school = schoolLocation(me?.schoolId);
  const needsName = Boolean(me && !me.displayNameSet);

  const nameForm = (
    <form
      className="field"
      onSubmit={(event) => {
        event.preventDefault();
        void saveName();
      }}
    >
      <label htmlFor="display-name">What should friends call you?</label>
      <input
        id="display-name"
        value={nameDraft}
        maxLength={40}
        onChange={(event) => setNameDraft(event.target.value)}
        placeholder={me?.displayName ?? 'Your name'}
        autoComplete="nickname"
      />
      <button className="btn" type="submit" disabled={!nameDraft.trim()}>
        Save name
      </button>
    </form>
  );

  return (
    <>
      <ToastStack toasts={toasts} />
      <Brand onClick={() => setMenuOpen((value) => !value)} />
      {menuOpen && me ? (
        <div className="account">
          <p>
            {me.displayName} · {me.pairingCodeDisplay}
            {mfaStepUp ? ` · Second key: ${me.mfa ? 'on' : 'off'}` : ''}
          </p>
          {nameForm}
          <label className="field">
            School
            <select
              value={me.schoolId ?? ''}
              onChange={(event) => void saveSchool(event.target.value)}
            >
              <option value="">Pick your school</option>
              {SCHOOL_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {school ? (
              <span className="hint">
                {school.city}
                {mySky ? ` · ${describeSky(mySky)} · ${localClock(mySky.timezone)}` : ''}
                {'. '}Your school stands in for your location. No GPS.
              </span>
            ) : (
              <span className="hint">
                Your school stands in for your location, so friends know your weather and your
                clock. No GPS.
              </span>
            )}
          </label>
          <label className="field">
            Notebook for a friend
            <select
              value={noteFriendId}
              onChange={(event) => setNoteFriendId(event.target.value)}
            >
              <option value="">Who is this about?</option>
              {friends
                .filter((friend) => !friend.isSelf)
                .map((friend) => (
                  <option key={friend.id} value={friend.id}>
                    {friend.displayName}
                  </option>
                ))}
            </select>
            <input
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="her exam, thursday"
            />
            <button className="btn" type="button" onClick={() => void saveNote()}>
              Remember for me
            </button>
          </label>
          <button
            className="btn-ghost"
            type="button"
            onClick={() =>
              void logout({ logoutParams: { returnTo: window.location.origin } })
            }
          >
            Sign out
          </button>
        </div>
      ) : null}

      <div
        className={`pane-track ${showSent ? 'sent' : ''}`}
        onTouchStart={(event) => {
          touchStart.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStart.current == null) {
            return;
          }
          const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStart.current;
          if (delta > 60) {
            setShowSent(true);
          }
          if (delta < -60) {
            setShowSent(false);
          }
          touchStart.current = null;
        }}
      >
        <section className="pane" aria-label="Sent">
          <p className="lede">
            <button type="button" className="btn-ghost" onClick={() => setShowSent(false)}>
              Sent. Swipe left to go back
            </button>
          </p>
          <div className="feed">
            {sent.length === 0 ? (
              <div className="empty">
                <h2>Nothing sent yet</h2>
                <p className="lede">The shutter at the bottom is waiting.</p>
              </div>
            ) : (
              sent.map((lock) => (
                <Polaroid
                  key={lock.id}
                  lock={lock}
                  viewerId={viewerId}
                  hasMfa={me?.mfa}
                  onConfirm={confirm}
                />
              ))
            )}
          </div>
        </section>

        <section className="pane" aria-label="The Stash">
          {needsName && !menuOpen ? (
            <div className="code-block name-card">
              <div>One thing first</div>
              {nameForm}
              <p className="hint">Right now you show up as “{me?.displayName}”.</p>
            </div>
          ) : null}

          {waitingContexts.size > 0 ? (
            <div className="here-row" aria-label="I'm here">
              <span>I'm here:</span>
              {CONTEXTS.filter((item) => waitingContexts.has(item)).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="chip"
                  disabled={hereBusy !== null}
                  onClick={() => void here(item)}
                >
                  {hereBusy === item ? '…' : CONTEXT_LABELS[item]}
                </button>
              ))}
            </div>
          ) : null}

          {prompts.length > 0 ? (
            <div className="prompt-rail">
              {prompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onStash={(friendId) => {
                    setReplyTo(friendId);
                    setCapturing(true);
                  }}
                  onDismiss={(triggerKey) => {
                    const result = dismissPrompt(triggerKey);
                    setPromptTick((value) => value + 1);
                    toast(
                      result.retired
                        ? 'Okay — not a thing anymore.'
                        : 'Skipped. Twice retires it.',
                    );
                  }}
                />
              ))}
            </div>
          ) : null}

          {empty ? (
            <div className="empty">
              <h2>Nothing's waiting for you yet.</h2>
              {me ? (
                <div className="code-block">
                  <div>Your code</div>
                  <strong>{me.pairingCodeDisplay}</strong>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        `${window.location.origin}/pair/${me.pairingCode}`,
                      )
                    }
                  >
                    Copy invite link
                  </button>
                </div>
              ) : null}
              <div className="rule">or</div>
              <p className="lede">Enter a friend's code</p>
              <PairingCodeInput
                error={pairError}
                onSubmit={async (code) => {
                  try {
                    setPairError('');
                    await api.pair(tokenRef.current || (await token()), code);
                    await refresh();
                    toast('Paired.');
                  } catch (err) {
                    setPairError(err instanceof Error ? err.message : 'Could not pair.');
                  }
                }}
              />
            </div>
          ) : (
            <>
              <p className="lede">
                <button type="button" className="btn-ghost" onClick={() => setShowSent(true)}>
                  Swipe right for what you sent
                </button>
              </p>
              <div className="feed">
                {sortedInbox.map((lock) => (
                  <Polaroid
                    key={lock.id}
                    lock={lock}
                    viewerId={viewerId}
                    hasMfa={me?.mfa}
                    onConfirm={confirm}
                    onSetCondition={setCondition}
                    onReply={(recipientId) => {
                      setReplyTo(recipientId);
                      setCapturing(true);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="capture">
        <button
          type="button"
          aria-label="Capture"
          onClick={() => {
            setReplyTo(undefined);
            setCapturing(true);
          }}
        />
      </div>

      {capturing ? (
        <CaptureSheet
          friends={friends}
          token={token}
          presetRecipientId={replyTo}
          suggestFor={suggestFor}
          mfaStepUp={mfaStepUp}
          onClose={() => setCapturing(false)}
          onSubmit={async (input) => {
            const lock = await api.createLock(tokenRef.current || (await token()), input);
            setSent((current) => upsertLock(current, lock));
            if (lock.recipientIds.includes(viewerId)) {
              setInbox((current) => upsertLock(current, lock));
            }
            setCapturing(false);
            toast(
              lock.recipients.length > 1
                ? `Stashed for ${lock.recipients.length} people.`
                : 'Stashed.',
            );
            setPromptTick((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}
