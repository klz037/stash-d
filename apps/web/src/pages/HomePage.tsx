import {
  CalendarDto,
  CONTEXT_LABELS,
  CONTEXTS,
  FriendDto,
  GroupDto,
  LockContext,
  LockDto,
  PromptDto,
  SOCKET_EVENTS,
  UserDto,
} from '@stashd/shared';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureSheet, Person } from '../components/CaptureSheet';
import { PairingCodeInput } from '../components/PairingCodeInput';
import { Polaroid } from '../components/Polaroid';
import { PromptCard } from '../components/PromptCard';
import { ToastStack } from '../components/ToastStack';
import { api } from '../lib/api';
import {
  buildPrompts,
  campusFor,
  dismissPrompt,
  SCHOOL_OPTIONS,
  schoolEventsFor,
  schoolLocation,
} from '../lib/prompts';
import { buildSkyPrompts, SkyMap } from '../lib/sky';
import { connectRealtime, disconnectRealtime } from '../lib/socket';
import { describeSky, fetchSky, localClock, Sky } from '../lib/weather';

const NOTIFIED_KEY = 'stashd.skyNotified';

/** Which menu is open. Only one at a time. */
type Menu = 'none' | 'more' | 'profile';
/** Inside the ☰ menu: the root list, or one of its screens. */
type MoreView = 'root' | 'create' | 'join' | 'created' | 'list';
/** What the feed shows: everything, one group, or one pair. */
type Scope = { kind: 'all' } | { kind: 'group'; id: string } | { kind: 'pair'; id: string };

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

function initial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

export function HomePage() {
  const { getAccessTokenSilently, logout, user: authUser } = useAuth0();
  const [me, setMe] = useState<UserDto | null>(null);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [inbox, setInbox] = useState<LockDto[]>([]);
  const [sent, setSent] = useState<LockDto[]>([]);
  const [calendar, setCalendar] = useState<CalendarDto | null>(null);
  const [skies, setSkies] = useState<SkyMap>({});
  const [showSent, setShowSent] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [capturing, setCapturing] = useState(false);
  const [replyTo, setReplyTo] = useState<string>();
  const [pairError, setPairError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [menu, setMenu] = useState<Menu>('none');
  const [moreView, setMoreView] = useState<MoreView>('root');
  const [nameDraft, setNameDraft] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<GroupDto | null>(null);
  const [hereBusy, setHereBusy] = useState<LockContext | null>(null);
  const [promptTick, setPromptTick] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const tokenRef = useRef('');
  const touchStart = useRef<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
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

  const loadGroups = useCallback(async () => {
    try {
      setGroups(await api.groups(tokenRef.current || (await token())));
    } catch {
      setGroups([]);
    }
  }, [token]);

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
    await loadGroups();
    try {
      setCalendar(await api.calendar(access));
    } catch {
      setCalendar(null);
    }
  }, [token, loadGroups]);

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
      socket.on(SOCKET_EVENTS.groupUpdated, (group: GroupDto) => {
        setGroups((current) => {
          const index = current.findIndex((item) => item.id === group.id);
          if (index === -1) return [group, ...current];
          const copy = [...current];
          copy[index] = group;
          return copy;
        });
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

  const people = useMemo(() => {
    const map: Record<string, Person> = {};
    for (const friend of friends) {
      map[friend.id] = {
        id: friend.id,
        displayName: friend.isSelf ? (me?.displayName ?? 'Me') : friend.displayName,
        isSelf: friend.isSelf,
        schoolId: friend.schoolId,
        schoolName: friend.schoolName,
        city: friend.city,
        picture: friend.picture,
      };
    }
    for (const group of groups) {
      for (const member of group.members) {
        if (!map[member.id]) {
          map[member.id] = {
            id: member.id,
            displayName: member.displayName,
            isSelf: member.id === me?.id,
            schoolId: member.schoolId,
            schoolName: member.schoolName,
            city: member.city,
          };
        }
      }
    }
    return map;
  }, [friends, groups, me]);

  useEffect(() => {
    const ids = new Set<string>();
    if (me?.schoolId) ids.add(me.schoolId);
    for (const person of Object.values(people)) {
      if (person.schoolId) ids.add(person.schoolId);
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
  }, [me?.schoolId, people]);

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

  async function createGroup() {
    const name = groupName.trim();
    if (!name) return;
    setGroupBusy(true);
    try {
      const group = await api.createGroup(tokenRef.current || (await token()), {
        name,
        memberIds: friends.filter((friend) => !friend.isSelf).map((friend) => friend.id),
      });
      setGroupName('');
      setCreatedGroup(group);
      setMoreView('created');
      await loadGroups();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the group.');
    } finally {
      setGroupBusy(false);
    }
  }

  async function joinGroup() {
    const code = groupCode.trim();
    if (!code) return;
    setGroupBusy(true);
    try {
      const group = await api.joinGroup(tokenRef.current || (await token()), code);
      setGroupCode('');
      await loadGroups();
      toast(`You're in ${group.name}.`);
      setScope({ kind: 'group', id: group.id });
      setMenu('none');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not join.');
    } finally {
      setGroupBusy(false);
    }
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

  function openMenu(next: Menu) {
    setMenu((current) => (current === next ? 'none' : next));
    setMoreView('root');
  }

  const viewerId = me?.id ?? authUser?.sub ?? '';
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
          : result === 'notallowed'
            ? 'Spotify refused this account. Add your Spotify email to the app in the Spotify developer dashboard, then connect again.'
            : 'Could not connect Spotify. Try again.',
    );
    if (result === 'connected') {
      void refresh();
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [refresh, toast]);

  const paired = friends.filter((friend) => !friend.isSelf);

  // Scope: everything, one group (every participant is a member), or one pair.
  const inScope = useCallback(
    (lock: LockDto) => {
      if (scope.kind === 'all') return true;
      if (scope.kind === 'pair') return lock.participantIds.includes(scope.id);
      const group = groups.find((item) => item.id === scope.id);
      if (!group) return true;
      return lock.participantIds.every((id) => group.memberIds.includes(id));
    },
    [scope, groups],
  );
  const scopedInbox = useMemo(
    () =>
      inbox.filter(inScope).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inbox, inScope],
  );
  const scopedSent = useMemo(() => sent.filter(inScope), [sent, inScope]);
  const empty = inbox.length === 0;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, friends, skies, promptTick, clockTick]);
  const prompts = useMemo(() => {
    if (!me) {
      return [] as PromptDto[];
    }
    const weather = mySky ? { tempF: mySky.tempF, label: mySky.label } : null;
    return [
      ...skyPrompts,
      ...buildPrompts({ me, friends, inbox, sent, weather, calendar: calendar?.events }),
    ].slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, friends, inbox, sent, mySky, skyPrompts, calendar, promptTick]);

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

  const school = schoolLocation(me?.schoolId);
  const needsName = Boolean(me && !me.displayNameSet);
  const scopeValue =
    scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`;

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
      <div className="topbar">
        <span className="wordmark">
          stash<span>'d</span>
        </span>
        <div className="topbar-actions">
          <button
            className={`icon-btn ${menu === 'more' ? 'active' : ''}`}
            type="button"
            aria-label="Groups and pairs"
            onClick={() => openMenu('more')}
          >
            <span className="burger" aria-hidden="true" />
          </button>
          <button
            className={`avatar ${menu === 'profile' ? 'active' : ''}`}
            type="button"
            aria-label="Profile"
            onClick={() => openMenu('profile')}
          >
            {me?.picture ? <img src={me.picture} alt="" /> : initial(me?.displayName ?? '?')}
          </button>
        </div>
      </div>

      {menu === 'more' && me ? (
        <div className="menu">
          {moreView === 'root' ? (
            <>
              <button className="menu-item" type="button" onClick={() => setMoreView('create')}>
                Create a group <span aria-hidden="true">›</span>
              </button>
              <button className="menu-item" type="button" onClick={() => setMoreView('join')}>
                Join a group <span aria-hidden="true">›</span>
              </button>
              <button className="menu-item" type="button" onClick={() => setMoreView('list')}>
                Groups &amp; pairs
                <span className="menu-count">{groups.length + paired.length}</span>
              </button>
            </>
          ) : null}

          {moreView === 'create' ? (
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault();
                void createGroup();
              }}
            >
              <span>Name the group</span>
              <input
                value={groupName}
                maxLength={40}
                autoFocus
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="the apartment"
              />
              <span className="hint">
                {paired.length > 0
                  ? `Starts with you and the ${paired.length} ${paired.length === 1 ? 'person' : 'people'} you're paired with. Anyone else joins with the code.`
                  : 'You get a code. Anyone with it can join.'}
              </span>
              <button className="btn" type="submit" disabled={groupBusy || !groupName.trim()}>
                Create
              </button>
              <button className="btn-ghost" type="button" onClick={() => setMoreView('root')}>
                Back
              </button>
            </form>
          ) : null}

          {moreView === 'created' && createdGroup ? (
            <div className="code-block" style={{ margin: 0 }}>
              <div>{createdGroup.name}</div>
              <strong>{createdGroup.inviteCodeDisplay}</strong>
              <p className="hint">Anyone who types this joins the group.</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(createdGroup.inviteCode);
                  toast('Code copied.');
                }}
              >
                Copy code
              </button>
              <button
                className="btn-ghost"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setScope({ kind: 'group', id: createdGroup.id });
                  setMenu('none');
                }}
              >
                Done
              </button>
            </div>
          ) : null}

          {moreView === 'join' ? (
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault();
                void joinGroup();
              }}
            >
              <span>Enter a group code</span>
              <input
                value={groupCode}
                maxLength={7}
                autoFocus
                onChange={(event) => setGroupCode(event.target.value.toUpperCase())}
                placeholder="KRF-2M9"
                autoCapitalize="characters"
              />
              <button className="btn" type="submit" disabled={groupBusy || !groupCode.trim()}>
                Join
              </button>
              <button className="btn-ghost" type="button" onClick={() => setMoreView('root')}>
                Back
              </button>
            </form>
          ) : null}

          {moreView === 'list' ? (
            <>
              <h4>Groups</h4>
              {groups.length === 0 ? (
                <p className="hint">None yet.</p>
              ) : (
                groups.map((group) => (
                  <div className="menu-row" key={group.id}>
                    <button
                      type="button"
                      className="menu-link"
                      onClick={() => {
                        setScope({ kind: 'group', id: group.id });
                        setMenu('none');
                      }}
                    >
                      {group.name}
                      <small>{group.members.map((m) => m.displayName).join(', ')}</small>
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        void navigator.clipboard.writeText(group.inviteCode);
                        toast(`${group.name}: ${group.inviteCodeDisplay} copied.`);
                      }}
                    >
                      {group.inviteCodeDisplay}
                    </button>
                  </div>
                ))
              )}
              <h4>Pairs</h4>
              {paired.length === 0 ? (
                <p className="hint">Nobody yet. Your code is in your profile.</p>
              ) : (
                paired.map((friend) => (
                  <div className="menu-row" key={friend.id}>
                    <button
                      type="button"
                      className="menu-link"
                      onClick={() => {
                        setScope({ kind: 'pair', id: friend.id });
                        setMenu('none');
                      }}
                    >
                      {friend.displayName}
                      <small>{friend.schoolName ?? friend.city ?? 'No school yet'}</small>
                    </button>
                    <span className="avatar small">
                      {friend.picture ? <img src={friend.picture} alt="" /> : initial(friend.displayName)}
                    </span>
                  </div>
                ))
              )}
              <button className="btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => setMoreView('root')}>
                Back
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {menu === 'profile' && me ? (
        <div className="menu">
          <div className="menu-profile">
            <span className="avatar">
              {me.picture ? <img src={me.picture} alt="" /> : initial(me.displayName)}
            </span>
            <div>
              <strong>{me.displayName}</strong>
              <small>{school ? `${school.name} · ${school.city}` : 'No school yet'}</small>
              {mySky ? (
                <small>
                  {describeSky(mySky)} · {localClock(mySky.timezone)}
                </small>
              ) : null}
            </div>
          </div>
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
            <span className="hint">
              Your school stands in for your location: weather, clock, calendar. No GPS.
            </span>
          </label>
          {calendar?.status.available ? (
            <p className="hint">
              Google Calendar {calendar.status.connected ? 'connected' : 'not connected'}
              {calendar.status.reason && !calendar.status.connected
                ? ` · ${calendar.status.reason}`
                : ''}
            </p>
          ) : null}
          <div className="code-block" style={{ margin: '12px 0' }}>
            <div>Your code</div>
            <strong>{me.pairingCodeDisplay}</strong>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `${window.location.origin}/pair/${me.pairingCode}`,
                );
                toast('Invite link copied.');
              }}
            >
              Copy invite link
            </button>
          </div>
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
          <div className="pane-head">
            <span className="pane-title">Sent</span>
            <button
              type="button"
              className="arrow-btn"
              aria-label="Back to your Stash"
              onClick={() => setShowSent(false)}
            >
              ›
            </button>
          </div>
          <div className="feed">
            {scopedSent.length === 0 ? (
              <div className="empty">
                <h2>Nothing sent yet</h2>
                <p className="lede">The shutter at the bottom is waiting.</p>
              </div>
            ) : (
              scopedSent.map((lock) => (
                <Polaroid key={lock.id} lock={lock} viewerId={viewerId} onConfirm={confirm} />
              ))
            )}
          </div>
        </section>

        <section className="pane" aria-label="The Stash">
          {needsName && menu === 'none' ? (
            <div className="code-block name-card">
              <div>One thing first</div>
              {nameForm}
              <p className="hint">Right now you show up as “{me?.displayName}”.</p>
            </div>
          ) : null}

          {!empty ? (
            <div className="pane-head">
              <button
                type="button"
                className="arrow-btn"
                aria-label="See what you sent"
                onClick={() => setShowSent(true)}
              >
                ‹
              </button>
              <select
                className="scope"
                aria-label="Show"
                value={scopeValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'all') setScope({ kind: 'all' });
                  else {
                    const [kind, id] = value.split(':');
                    setScope({ kind: kind as 'group' | 'pair', id });
                  }
                }}
              >
                <option value="all">Everyone</option>
                {groups.length > 0 ? (
                  <optgroup label="Groups">
                    {groups.map((group) => (
                      <option key={group.id} value={`group:${group.id}`}>
                        {group.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {paired.length > 0 ? (
                  <optgroup label="Pairs">
                    {paired.map((friend) => (
                      <option key={friend.id} value={`pair:${friend.id}`}>
                        {friend.displayName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
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
            <div className="feed">
              {scopedInbox.length === 0 ? (
                <p className="hint" style={{ textAlign: 'center' }}>
                  Nothing here yet for this {scope.kind === 'group' ? 'group' : 'pair'}.
                </p>
              ) : null}
              {scopedInbox.map((lock) => (
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
          groups={groups}
          people={people}
          skies={skies}
          eventsFor={(schoolId) => schoolEventsFor(schoolId, new Date(), 14).slice(0, 2)}
          campusFor={(schoolId) => campusFor(schoolId)}
          token={token}
          presetRecipientId={replyTo}
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
