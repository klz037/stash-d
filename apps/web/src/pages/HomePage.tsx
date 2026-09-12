import {
  FriendDto,
  FriendNoteDto,
  GroupDto,
  LockDto,
  PromptDto,
  SOCKET_EVENTS,
  UserDto,
} from '@stashd/shared';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureSheet } from '../components/CaptureSheet';
import { PairingCodeInput } from '../components/PairingCodeInput';
import { Polaroid } from '../components/Polaroid';
import { PromptCard } from '../components/PromptCard';
import { ToastStack } from '../components/ToastStack';
import { api } from '../lib/api';
import { fetchSchoolWeather, watchCoarseLocation } from '../lib/location';
import {
  buildPrompts,
  dismissPrompt,
  polishPromptsWithIfm,
  schoolById,
  SCHOOL_OPTIONS,
} from '../lib/prompts';
import { connectRealtime, disconnectRealtime, getRealtime } from '../lib/socket';

function upsertLock(list: LockDto[], next: LockDto) {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) return [next, ...list];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function HomePage() {
  const { getAccessTokenSilently, logout, user: authUser } = useAuth0();
  const [me, setMe] = useState<UserDto | null>(null);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [inbox, setInbox] = useState<LockDto[]>([]);
  const [sent, setSent] = useState<LockDto[]>([]);
  const [notes, setNotes] = useState<FriendNoteDto[]>([]);
  const [showSent, setShowSent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [replyTo, setReplyTo] = useState<string>();
  const [presetCondition, setPresetCondition] = useState<string>();
  const [pairError, setPairError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteFriendId, setNoteFriendId] = useState('');
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupCodeDraft, setGroupCodeDraft] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [weatherBySchool, setWeatherBySchool] = useState<
    Record<string, { tempF: number; label: string }>
  >({});
  const [promptTick, setPromptTick] = useState(0);
  const [prompts, setPrompts] = useState<PromptDto[]>([]);
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
    setDisplayNameDraft(profile.displayName);
    setFriends(friendList);
    setInbox(incoming);
    setSent(outgoing);
    try {
      setNotes(await api.notes(access));
    } catch {
      setNotes([]);
    }
    try {
      setGroups(await api.groups(access));
    } catch {
      setGroups([]);
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
      if (socket.connected) onConnect();

      socket.on(SOCKET_EVENTS.lockCreated, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        toast(
          lock.groupName
            ? `${lock.senderName} stashed something for ${lock.groupName}.`
            : `${lock.senderName} stashed something for you.`,
        );
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
      socket.on(
        SOCKET_EVENTS.location,
        (payload: { userId: string; placeLabel?: string; locationUpdatedAt?: string }) => {
          setFriends((current) =>
            current.map((friend) =>
              friend.id === payload.userId
                ? {
                    ...friend,
                    placeLabel: payload.placeLabel,
                    locationUpdatedAt: payload.locationUpdatedAt,
                  }
                : friend,
            ),
          );
          setPromptTick((value) => value + 1);
        },
      );
      socket.on(SOCKET_EVENTS.groupUpdated, () => {
        void refreshRef.current();
      });
    });
    return () => {
      active = false;
      disconnectRealtime();
    };
  }, [toast, token]);

  useEffect(() => {
    const needsPoll = [...inbox, ...sent].some((lock) => lock.state === 'READY');
    if (!needsPoll) return undefined;
    const id = window.setInterval(() => {
      void refreshRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [inbox, sent]);

  useEffect(() => {
    if (!me?.locationSharing) return undefined;
    return watchCoarseLocation(
      (place) => {
        const access = tokenRef.current;
        if (!access) return;
        void api.updateLocation(access, place).catch(() => undefined);
        getRealtime()?.emit('location:report', place);
      },
      (message) => toast(message),
    );
  }, [me?.locationSharing, toast]);

  useEffect(() => {
    const schoolIds = new Set<string>();
    for (const friend of friends) {
      if (!friend.isSelf && friend.schoolId) schoolIds.add(friend.schoolId);
    }
    if (me?.schoolId) schoolIds.add(me.schoolId);
    let cancelled = false;
    void (async () => {
      const next: Record<string, { tempF: number; label: string }> = {};
      await Promise.all(
        [...schoolIds].map(async (id) => {
          const school = schoolById(id);
          if (!school) return;
          const weather = await fetchSchoolWeather(school.lat, school.lon);
          if (weather) next[id] = weather;
        }),
      );
      if (!cancelled) {
        setWeatherBySchool(next);
        setPromptTick((value) => value + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [friends, me?.schoolId]);

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
    if (!school) return;
    const profile = await api.updateProfile(tokenRef.current || (await token()), {
      schoolId: school.id,
      schoolName: school.name,
      city: school.city,
    });
    setMe(profile);
    toast(`Campus set to ${school.name}.`);
    setPromptTick((value) => value + 1);
  }

  async function saveDisplayName() {
    const name = displayNameDraft.trim();
    if (!name) return;
    const profile = await api.updateProfile(tokenRef.current || (await token()), {
      displayName: name,
    });
    setMe(profile);
    setDisplayNameDraft(profile.displayName);
    toast('Name updated — friends see this.');
  }

  async function toggleLocationSharing() {
    const next = !me?.locationSharing;
    const profile = await api.updateProfile(tokenRef.current || (await token()), {
      locationSharing: next,
    });
    setMe(profile);
    toast(next ? 'Friends can see coarse place vibes.' : 'Location sharing off.');
  }

  async function saveNote() {
    if (!noteFriendId || !noteDraft.trim()) return;
    await api.createNote(tokenRef.current || (await token()), {
      friendId: noteFriendId,
      text: noteDraft.trim(),
    });
    setNoteDraft('');
    toast('Saved to your notebook.');
    setPromptTick((value) => value + 1);
    await refresh();
  }

  async function createGroup() {
    const name = groupNameDraft.trim();
    if (!name) return;
    const group = await api.createGroup(tokenRef.current || (await token()), {
      name,
      memberIds: groupMemberIds,
    });
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
    setGroupNameDraft('');
    setGroupMemberIds([]);
    toast(`Group “${group.name}” ready · ${group.inviteCodeDisplay}`);
  }

  async function joinGroup() {
    const code = groupCodeDraft.trim();
    if (!code) return;
    const group = await api.joinGroup(tokenRef.current || (await token()), { code });
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
    setGroupCodeDraft('');
    toast(`Joined ${group.name}.`);
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

  useEffect(() => {
    if (!me) {
      setPrompts([]);
      return;
    }
    const base = buildPrompts({
      me,
      friends,
      groups,
      inbox,
      sent,
      notes,
      weatherBySchool,
    });
    setPrompts(base);

    let cancelled = false;
    void (async () => {
      try {
        const access = tokenRef.current || (await token());
        const polished = await polishPromptsWithIfm(base, access);
        if (!cancelled) setPrompts(polished);
      } catch {
        // Keep template shelf copy — IFM is optional.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, friends, groups, inbox, sent, notes, weatherBySchool, promptTick, token]);

  return (
    <>
      <ToastStack toasts={toasts} />
      <button className="wordmark" type="button" onClick={() => setMenuOpen((v) => !v)}>
        stash<span>'d</span>
      </button>
      {menuOpen && me ? (
        <div className="account">
          <p>
            {me.displayName} · {me.pairingCodeDisplay}
          </p>
          <label className="field">
            Display name
            <input
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              placeholder="What friends see"
              maxLength={40}
            />
            <button className="btn" type="button" onClick={() => void saveDisplayName()}>
              Save name
            </button>
          </label>
          <label className="field">
            School
            <select value={me.schoolId ?? ''} onChange={(e) => void saveSchool(e.target.value)}>
              <option value="">One field. Highest yield.</option>
              {SCHOOL_OPTIONS.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field toggle-row">
            <span>
              Share coarse place
              <small>Friends see “a cafe,” never a pin.</small>
            </span>
            <button className="btn-ghost" type="button" onClick={() => void toggleLocationSharing()}>
              {me.locationSharing ? 'On' : 'Off'}
            </button>
          </div>
          {me.locationSharing && me.placeLabel ? (
            <p className="hint">Right now: {me.placeLabel}</p>
          ) : null}

          <label className="field">
            Groups
            <input
              value={groupNameDraft}
              onChange={(e) => setGroupNameDraft(e.target.value)}
              placeholder="Squad name"
              maxLength={40}
            />
            <div className="chip-row">
              {friends
                .filter((friend) => !friend.isSelf)
                .map((friend) => {
                  const selected = groupMemberIds.includes(friend.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className={`chip ${selected ? 'active' : ''}`}
                      onClick={() =>
                        setGroupMemberIds((current) =>
                          selected
                            ? current.filter((id) => id !== friend.id)
                            : [...current, friend.id],
                        )
                      }
                    >
                      {friend.displayName}
                    </button>
                  );
                })}
            </div>
            <button className="btn" type="button" onClick={() => void createGroup()}>
              Create group
            </button>
            <input
              value={groupCodeDraft}
              onChange={(e) => setGroupCodeDraft(e.target.value)}
              placeholder="Join with code"
            />
            <button className="btn-ghost" type="button" onClick={() => void joinGroup()}>
              Join group
            </button>
            {groups.length > 0 ? (
              <ul className="group-list">
                {groups.map((group) => (
                  <li key={group.id}>
                    <strong>{group.name}</strong>
                    <span>
                      {group.inviteCodeDisplay} ·{' '}
                      {group.members.map((m) => m.displayName).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>

          <label className="field">
            Notebook for a friend
            <select value={noteFriendId} onChange={(e) => setNoteFriendId(e.target.value)}>
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
              onChange={(e) => setNoteDraft(e.target.value)}
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
        onTouchStart={(e) => {
          touchStart.current = e.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (touchStart.current == null) return;
          const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStart.current;
          if (delta > 60) setShowSent(true);
          if (delta < -60) setShowSent(false);
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
                <Polaroid key={lock.id} lock={lock} viewerId={viewerId} onConfirm={confirm} />
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
                  onStash={(friendId, suggestedCondition) => {
                    setReplyTo(friendId);
                    setPresetCondition(suggestedCondition);
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
                      setPresetCondition(undefined);
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
            setPresetCondition(undefined);
            setCapturing(true);
          }}
        />
      </div>

      {capturing ? (
        <CaptureSheet
          friends={friends}
          groups={groups}
          token={token}
          presetRecipientId={replyTo}
          presetConditionLabel={presetCondition}
          onClose={() => {
            setCapturing(false);
            setPresetCondition(undefined);
          }}
          onSubmit={async (input) => {
            const locks = await api.createLock(tokenRef.current || (await token()), {
              recipientId: input.recipientId,
              groupId: input.groupId,
              text: input.text,
              imageUrl: input.imageUrl,
              conditionType: input.conditionType,
              conditionLabel: input.conditionLabel,
            });
            for (const lock of locks) {
              setSent((current) => upsertLock(current, lock));
              if (lock.recipientId === viewerId) {
                setInbox((current) => upsertLock(current, lock));
              }
            }
            setCapturing(false);
            setPresetCondition(undefined);
            toast(locks.length > 1 ? `Stashed to ${locks.length} people.` : 'Stashed.');
            setPromptTick((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}
