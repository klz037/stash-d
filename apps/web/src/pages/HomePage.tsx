import { FriendDto, FriendNoteDto, LockDto, PromptDto, SOCKET_EVENTS, UserDto } from '@stashd/shared';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureSheet } from '../components/CaptureSheet';
import { PairingCodeInput } from '../components/PairingCodeInput';
import { Polaroid } from '../components/Polaroid';
import { PromptCard } from '../components/PromptCard';
import { ToastStack } from '../components/ToastStack';
import { api } from '../lib/api';
import { buildPrompts, dismissPrompt, SCHOOL_OPTIONS } from '../lib/prompts';
import { connectRealtime, disconnectRealtime } from '../lib/socket';

function upsertLock(list: LockDto[], next: LockDto) {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [next, ...list];
  }
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function HomePage() {
  const { getAccessTokenSilently, logout, user: authUser } = useAuth0();
  const [me, setMe] = useState<UserDto | null>(null);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [inbox, setInbox] = useState<LockDto[]>([]);
  const [sent, setSent] = useState<LockDto[]>([]);
  const [notes, setNotes] = useState<FriendNoteDto[]>([]);
  const [showSent, setShowSent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [replyTo, setReplyTo] = useState<string>();
  const [pairError, setPairError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteFriendId, setNoteFriendId] = useState('');
  const [promptTick, setPromptTick] = useState(0);
  const tokenRef = useRef('');
  const touchStart = useRef<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

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
        toast(`${lock.senderName} stashed something for you.`);
      });
      socket.on(SOCKET_EVENTS.lockReady, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        toast("They're holding with you.");
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUnlocked, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        toast(lock.contentHidden ? 'A lock just opened.' : 'Unlocked.');
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUpdated, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
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

  async function confirm(id: string) {
    const lock = await api.confirm(tokenRef.current || (await token()), id);
    setInbox((current) => upsertLock(current, lock));
    setSent((current) => upsertLock(current, lock));
  }

  async function setCondition(id: string, conditionLabel: string) {
    const lock = await api.setCondition(
      tokenRef.current || (await token()),
      id,
      conditionLabel,
    );
    setInbox((current) => upsertLock(current, lock));
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

  const viewerId = me?.id ?? authUser?.sub ?? '';
  const empty = inbox.length === 0;
  const sortedInbox = useMemo(
    () => [...inbox].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inbox],
  );
  const prompts = useMemo(() => {
    if (!me) {
      return [] as PromptDto[];
    }
    return buildPrompts({ me, friends, inbox, sent, notes });
  }, [me, friends, inbox, sent, notes, promptTick]);

  return (
    <>
      <ToastStack toasts={toasts} />
      <button className="wordmark" type="button" onClick={() => setMenuOpen((value) => !value)}>
        stash<span>'d</span>
      </button>
      {menuOpen && me ? (
        <div className="account">
          <p>
            {me.displayName} · {me.pairingCodeDisplay}
          </p>
          <label className="field">
            School
            <select
              value={me.schoolId ?? ''}
              onChange={(event) => void saveSchool(event.target.value)}
            >
              <option value="">One field. Highest yield.</option>
              {SCHOOL_OPTIONS.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
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
                  onConfirm={confirm}
                />
              ))
            )}
          </div>
        </section>

        <section className="pane" aria-label="The Stash">
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
          presetRecipientId={replyTo}
          onClose={() => setCapturing(false)}
          onSubmit={async (input) => {
            const lock = await api.createLock(tokenRef.current || (await token()), input);
            setSent((current) => upsertLock(current, lock));
            if (lock.recipientId === viewerId) {
              setInbox((current) => upsertLock(current, lock));
            }
            setCapturing(false);
            toast('Stashed.');
            setPromptTick((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}
