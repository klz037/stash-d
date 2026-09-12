import {
  AlertPreviewDto,
  CalendarDto,
  FriendDto,
  FriendRequestDto,
  GroupDto,
  LockDto,
  NotificationsStatusDto,
  PromptDto,
  SOCKET_EVENTS,
  StashAlertDto,
  UserDto,
} from '@stashd/shared';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertPreview } from '../components/AlertPreview';
import { CaptureSheet, Person } from '../components/CaptureSheet';
import { Icon } from '../components/Icon';
import { PairingCodeInput } from '../components/PairingCodeInput';
import { Polaroid } from '../components/Polaroid';
import { PromptCard } from '../components/PromptCard';
import { ToastStack } from '../components/ToastStack';
import { api } from '../lib/api';
import {
  disableStashAlerts,
  enableStashAlerts,
  LocalAlertResult,
  notificationsSupported,
  showLocalAlert,
} from '../lib/notifications';
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

type Menu = 'none' | 'more' | 'profile';
type MoreView = 'root' | 'friend' | 'requests' | 'create' | 'join' | 'created' | 'list';
type Scope =
  | { kind: 'all' }
  | { kind: 'group'; id: string }
  | { kind: 'pair'; id: string }
  | { kind: 'moment'; id: string };

/**
 * Something that needs a person's answer right now: a friend request, or a
 * friend opening an "open together". Shown one at a time as a sheet, and
 * counted on the red dot by the ☰ menu.
 */
type Alert =
  | { kind: 'request'; id: string; request: FriendRequestDto }
  | { kind: 'opening'; id: string; lock: LockDto }
  | { kind: 'openedAlone'; id: string; lock: LockDto };

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
  const [requests, setRequests] = useState<FriendRequestDto[]>([]);
  const [inbox, setInbox] = useState<LockDto[]>([]);
  const [sent, setSent] = useState<LockDto[]>([]);
  const [calendar, setCalendar] = useState<CalendarDto | null>(null);
  const [skies, setSkies] = useState<SkyMap>({});
  const [showSent, setShowSent] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [capturing, setCapturing] = useState(false);
  const [replyTo, setReplyTo] = useState<string>();
  const [replyToLockId, setReplyToLockId] = useState<string>();
  const [pairError, setPairError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [menu, setMenu] = useState<Menu>('none');
  const [moreView, setMoreView] = useState<MoreView>('root');
  const [nameDraft, setNameDraft] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<GroupDto | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [hereBusy, setHereBusy] = useState<string | null>(null);
  const [promptTick, setPromptTick] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [alertStatus, setAlertStatus] = useState<NotificationsStatusDto | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<AlertPreviewDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const tokenRef = useRef('');
  const touchStart = useRef<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const sentRef = useRef<LockDto[]>([]);
  const inboxRef = useRef<LockDto[]>([]);
  sentRef.current = sent;
  inboxRef.current = inbox;

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }, []);

  const pushAlert = useCallback((alert: Alert) => {
    setAlerts((current) => (current.some((a) => a.id === alert.id) ? current : [...current, alert]));
  }, []);
  const dropAlert = useCallback((id: string) => {
    setAlerts((current) => current.filter((a) => a.id !== id));
  }, []);

  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        toast('✓ Copied');
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
      } catch {
        toast('Could not copy. Long-press to select it instead.');
      }
    },
    [toast],
  );

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

  const loadRequests = useCallback(async () => {
    try {
      const list = await api.friendRequests(tokenRef.current || (await token()));
      setRequests(list);
      for (const request of list) {
        pushAlert({ kind: 'request', id: `request-${request.from.id}`, request });
      }
    } catch {
      setRequests([]);
    }
  }, [token, pushAlert]);

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
    await Promise.all([loadGroups(), loadRequests()]);
    try {
      setCalendar(await api.calendar(access));
    } catch {
      setCalendar(null);
    }
  }, [token, loadGroups, loadRequests]);

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

      const isPairTogether = (lock: LockDto) =>
        lock.conditionType === 'TOGETHER' && lock.participantIds.length === 2 && !lock.replyToId;

      socket.on(SOCKET_EVENTS.lockCreated, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        toast(
          lock.replyToId
            ? `${lock.senderName} stashed back. Hold theirs to start opening.`
            : lock.recipients.length > 1
              ? `${lock.senderName} stashed something for ${lock.recipients.length} of you.`
              : `${lock.senderName} stashed something for you.`,
        );
      });
      socket.on(SOCKET_EVENTS.lockReady, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        if (isPairTogether(lock)) {
          // The DTO is shaped for me: senderName is "You" when I started it.
          // Otherwise they just started, and this is the notification to open from.
          if (lock.senderName !== 'You') {
            pushAlert({ kind: 'opening', id: `opening-${lock.id}`, lock });
          }
        } else {
          const left = lock.participantIds.length - lock.confirmedIds.length;
          toast(
            lock.participantIds.length > 2
              ? `${lock.confirmedIds.length} holding. ${left} to go.`
              : "They're holding with you.",
          );
        }
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUnlocked, (lock: LockDto) => {
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        dropAlert(`opening-${lock.id}`);
        toast(lock.contentHidden ? 'A lock just opened.' : 'Unlocked.');
        void refreshRef.current();
      });
      socket.on(SOCKET_EVENTS.lockUpdated, (lock: LockDto) => {
        const before =
          sentRef.current.find((item) => item.id === lock.id) ??
          inboxRef.current.find((item) => item.id === lock.id);
        setInbox((current) => upsertLock(current, lock));
        setSent((current) => upsertLock(current, lock));
        if (lock.contextMetAt && !before?.contextMetAt && lock.context && lock.contextMetByName) {
          toast(`${lock.contextMetByName} is ${lock.context}. Your lock is ready to open.`);
        }
        if (lock.replyId && !before?.replyId && lock.senderName === 'You') {
          toast(`${lock.recipientName} stashed back. Hold to start opening.`);
        }
        if (lock.openedAlone && !before?.openedAlone && lock.senderName !== 'You') {
          dropAlert(`opening-${lock.id}`);
          pushAlert({ kind: 'openedAlone', id: `alone-${lock.id}`, lock });
        }
      });
      socket.on(SOCKET_EVENTS.friendRequested, (request: FriendRequestDto) => {
        setRequests((current) =>
          current.some((r) => r.from.id === request.from.id) ? current : [request, ...current],
        );
        pushAlert({ kind: 'request', id: `request-${request.from.id}`, request });
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
  }, [toast, token, pushAlert, dropAlert]);

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
      dropAlert(`opening-${id}`);
      dropAlert(`alone-${id}`);
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

  async function pair(code: string) {
    try {
      setPairError('');
      const friend = await api.pair(tokenRef.current || (await token()), code);
      if (friend.pending) {
        toast(`Request sent to ${friend.displayName}. They'll see it next time they open stash'd.`);
      } else {
        toast(`Paired with ${friend.displayName}.`);
        await refresh();
      }
      setMenu('none');
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Could not pair.');
    }
  }

  async function answerRequest(request: FriendRequestDto, accept: boolean) {
    try {
      const access = tokenRef.current || (await token());
      if (accept) {
        await api.acceptRequest(access, request.from.id);
        toast(`You and ${request.from.displayName} are paired.`);
      } else {
        await api.declineRequest(access, request.from.id);
      }
      setRequests((current) => current.filter((r) => r.from.id !== request.from.id));
      dropAlert(`request-${request.from.id}`);
      if (accept) await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not answer that.');
    }
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

  async function here(moment: string) {
    setHereBusy(moment);
    try {
      const result = await api.here(tokenRef.current || (await token()), moment);
      for (const lock of result.matched) {
        setInbox((current) => upsertLock(current, lock));
      }
      if (result.matched.length === 0) {
        toast(`Nothing here is waiting for ${moment}.`);
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

  function openCapture(recipientId?: string, lockId?: string) {
    setReplyTo(recipientId);
    setReplyToLockId(lockId);
    setCapturing(true);
  }

  // ---- Device stash alerts (OS pop-ups; the shelf above stays silent) ----

  const loadAlertStatus = useCallback(async () => {
    try {
      setAlertStatus(await api.notificationsStatus(tokenRef.current || (await token())));
    } catch {
      setAlertStatus(null);
    }
  }, [token]);

  useEffect(() => {
    if (!me) return;
    void loadAlertStatus();
  }, [me?.id, me?.stashAlertsEnabled, loadAlertStatus]);

  async function toggleStashAlerts() {
    if (alertBusy) return;
    setAlertBusy(true);
    try {
      const access = tokenRef.current || (await token());
      if (me?.stashAlertsEnabled) {
        await disableStashAlerts(access);
        setMe((current) => (current ? { ...current, stashAlertsEnabled: false } : current));
        toast('Stash alerts off.');
      } else {
        const status = await enableStashAlerts(access);
        setAlertStatus(status);
        setMe((current) => (current ? { ...current, stashAlertsEnabled: true } : current));
        toast(
          status.pushConfigured
            ? `Alerts on — at most ${status.dailyBudget} a day.`
            : 'Alerts on for this device while stash\u2019d is open.',
        );
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change alerts.');
    } finally {
      setAlertBusy(false);
    }
  }

  // First open shows today's real plan; every "Regenerate" reshuffles with a fresh seed.
  const loadPreview = useCallback(
    async (reshuffle = false) => {
      setPreviewLoading(true);
      try {
        const access = tokenRef.current || (await token());
        setPreview(
          await api.previewAlerts(access, reshuffle ? { seed: String(Date.now()) } : {}),
        );
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not build a preview.');
      } finally {
        setPreviewLoading(false);
      }
    },
    [token, toast],
  );

  function openPreview() {
    setPreviewOpen(true);
    setMenu('none');
    void loadPreview();
  }

  function describeLocalResult(result: LocalAlertResult, fallback: string) {
    switch (result) {
      case 'shown':
        return fallback;
      case 'denied':
        return 'Notifications are blocked for this site. Allow them in the address bar and try again.';
      default:
        return 'This browser cannot show notifications.';
    }
  }

  /**
   * Store one alert for real (it counts toward today's cap) and pop it on this
   * computer. If Web Push reached a subscribed device we skip the local pop so
   * the same alert doesn't show twice.
   */
  async function sendTestAlert(draft?: StashAlertDto) {
    if (alertBusy) return;
    setAlertBusy(true);
    try {
      const access = tokenRef.current || (await token());
      const { alert: sentAlert, reason } = await api.sendAlertNow(
        access,
        draft
          ? {
              draft: {
                title: draft.title,
                body: draft.body,
                kind: draft.kind,
                friendId: draft.friendId,
                friendName: draft.friendName,
                schoolId: draft.schoolId,
                schoolName: draft.schoolName,
                sourceLabel: draft.sourceLabel,
                sourceUrl: draft.sourceUrl,
                suggestedCondition: draft.suggestedCondition,
              },
            }
          : {},
      );
      if (!sentAlert) {
        toast(
          reason === 'no-friends'
            ? 'Add a friend with a school set first.'
            : 'Nothing fresh to say about their schools right now.',
        );
      } else if (sentAlert.deliveredPush) {
        toast(`Sent to your devices: ${sentAlert.title}`);
      } else {
        const result = await showLocalAlert(sentAlert);
        toast(describeLocalResult(result, `Sent: ${sentAlert.title}`));
      }
      await loadAlertStatus();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send an alert.');
    } finally {
      setAlertBusy(false);
    }
  }

  const viewerId = me?.id ?? authUser?.sub ?? '';

  // A tapped device alert lands here with ?stashFor=<friendId>; ?preview=alerts opens the demo sheet.
  useEffect(() => {
    if (!me) return;
    const params = new URLSearchParams(window.location.search);
    const stashFor = params.get('stashFor');
    const wantsPreview = params.get('preview') === 'alerts';
    if (!stashFor && !wantsPreview) return;
    if (stashFor) {
      openCapture(stashFor);
      const alertId = params.get('alert');
      if (alertId) {
        void (async () => {
          try {
            await api.ackAlert(tokenRef.current || (await token()), alertId);
          } catch {
            // Acking is best-effort.
          }
        })();
      }
    }
    if (wantsPreview) {
      setPreviewOpen(true);
      void loadPreview();
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);
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

  const knownMoments = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const lock of [...inbox, ...sent].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (lock.context && !seen.has(lock.context)) {
        seen.add(lock.context);
        out.push(lock.context);
      }
    }
    return out;
  }, [inbox, sent]);

  const inScope = useCallback(
    (lock: LockDto) => {
      if (scope.kind === 'all') return true;
      if (scope.kind === 'pair') return lock.participantIds.includes(scope.id);
      if (scope.kind === 'moment') return lock.context === scope.id;
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

  const { waitingMoments, metMoments } = useMemo(() => {
    const waiting = new Set<string>();
    const met = new Set<string>();
    for (const lock of inbox) {
      if (lock.state === 'UNLOCKED' || !lock.context) continue;
      (lock.contextMetAt ? met : waiting).add(lock.context);
    }
    for (const item of waiting) met.delete(item);
    return { waitingMoments: [...waiting], metMoments: [...met] };
  }, [inbox]);

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
    ].slice(0, 8);
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
  const scopeValue = scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`;
  const inviteLink = me ? `${window.location.origin}/pair/${me.pairingCode}` : '';
  const badge = requests.length + alerts.filter((a) => a.kind !== 'request').length;
  const alert = alerts[0] ?? null;

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

  const copyButton = (key: string, text: string, label: string, className = 'btn-ghost') => (
    <button className={className} type="button" onClick={() => void copy(key, text)}>
      {copied === key ? '✓ Copied' : label}
    </button>
  );

  const requestRows = (
    <>
      {requests.length === 0 ? (
        <p className="hint">No requests waiting.</p>
      ) : (
        requests.map((request) => (
          <div className="menu-row" key={request.from.id}>
            <span className="menu-link">
              {request.from.displayName}
              <small>{request.from.schoolName ?? request.from.city ?? 'wants to pair'}</small>
            </span>
            <span className="row-actions">
              <button className="chip active" type="button" onClick={() => void answerRequest(request, true)}>
                Accept
              </button>
              <button className="chip" type="button" onClick={() => void answerRequest(request, false)}>
                No
              </button>
            </span>
          </div>
        ))
      )}
    </>
  );

  return (
    <>
      <ToastStack toasts={toasts} />
      <div className="topbar">
        <Icon name="stashd-logo" width={110} title="stash'd" />
        <div className="topbar-actions">
          <button
            className={`icon-btn ${menu === 'more' ? 'active' : ''}`}
            type="button"
            aria-label={badge > 0 ? `Friends and groups, ${badge} waiting` : 'Friends and groups'}
            aria-expanded={menu === 'more'}
            onClick={() => openMenu('more')}
          >
            <span className="burger" aria-hidden="true" />
            {badge > 0 ? <span className="badge-dot" aria-hidden="true" /> : null}
          </button>
          <button
            className={`avatar ${menu === 'profile' ? 'active' : ''}`}
            type="button"
            aria-label="Profile"
            aria-expanded={menu === 'profile'}
            onClick={() => openMenu('profile')}
          >
            {me?.picture ? (
              <img src={me.picture} alt="" />
            ) : (
              <Icon name="profile-icon" width={32} />
            )}
          </button>
        </div>
      </div>

      {menu !== 'none' ? (
        <div className="scrim" onClick={() => setMenu('none')} aria-hidden="true" />
      ) : null}

      {menu === 'more' && me ? (
        <div className="menu" role="menu">
          {moreView === 'root' ? (
            <>
              {requests.length > 0 ? (
                <button className="menu-item" type="button" onClick={() => setMoreView('requests')}>
                  Friend requests
                  <span className="menu-count pill">{requests.length}</span>
                </button>
              ) : null}
              <button className="menu-item" type="button" onClick={() => setMoreView('friend')}>
                Add a friend <span aria-hidden="true">›</span>
              </button>
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

          {moreView === 'requests' ? (
            <>
              <h4>Friend requests</h4>
              {requestRows}
              <button className="btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => setMoreView('root')}>
                Back
              </button>
            </>
          ) : null}

          {moreView === 'friend' ? (
            <>
              <div className="code-block" style={{ margin: '0 0 12px' }}>
                <div>Your code</div>
                <strong>{me.pairingCodeDisplay}</strong>
                {copyButton('invite-menu', inviteLink, 'Copy invite link')}
              </div>
              <p className="lede" style={{ marginBottom: 8 }}>
                Or enter theirs. They'll get a request to accept.
              </p>
              <PairingCodeInput error={pairError} onSubmit={pair} />
              <button className="btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => setMoreView('root')}>
                Back
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
              {copyButton(`group-${createdGroup.id}`, createdGroup.inviteCode, 'Copy code', 'btn')}
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
                      onClick={() => void copy(`code-${group.id}`, group.inviteCode)}
                    >
                      {copied === `code-${group.id}` ? '✓ Copied' : group.inviteCodeDisplay}
                    </button>
                  </div>
                ))
              )}
              <h4>Pairs</h4>
              {paired.length === 0 ? (
                <p className="hint">Nobody yet. Use “Add a friend”.</p>
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
        <div className="menu" role="menu">
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
            {copyButton('invite-profile', inviteLink, 'Copy invite link')}
          </div>

          <div className="field alerts-row">
            <span>
              Stash alerts
              <span className="hint">
                {notificationsSupported()
                  ? 'Pop-ups about your friends\u2019 campuses. Max 3\u20134 a day, never overnight.'
                  : 'This browser cannot show notifications.'}
              </span>
            </span>
            <button
              className="btn-ghost"
              type="button"
              disabled={alertBusy}
              onClick={() => void toggleStashAlerts()}
            >
              {me.stashAlertsEnabled ? 'On' : 'Off'}
            </button>
          </div>
          {me.stashAlertsEnabled && alertStatus ? (
            <p className="hint">
              {alertStatus.sentToday}/{alertStatus.dailyBudget} today
              {alertStatus.pushConfigured ? '' : ' \u00b7 push not configured on server'}
              {' \u00b7 '}
              <button className="link" type="button" disabled={alertBusy} onClick={() => void sendTestAlert()}>
                send one now
              </button>
            </p>
          ) : null}
          <button className="btn-ghost" type="button" style={{ marginBottom: 10 }} onClick={openPreview}>
            Preview today's alerts
          </button>

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

      {/* One thing that needs an answer, over everything else. */}
      {alert && !capturing ? (
        <div className="alert-sheet" role="dialog" aria-modal="true">
          <div className="alert-card">
            <button
              className="alert-close"
              type="button"
              aria-label="Dismiss"
              onClick={() => dropAlert(alert.id)}
            >
              ×
            </button>
            {alert.kind === 'request' ? (
              <>
                <span className="avatar">
                  {alert.request.from.picture ? (
                    <img src={alert.request.from.picture} alt="" />
                  ) : (
                    initial(alert.request.from.displayName)
                  )}
                </span>
                <h3>{alert.request.from.displayName} wants to pair</h3>
                <p className="lede">
                  {alert.request.from.schoolName
                    ? `${alert.request.from.schoolName}. `
                    : ''}
                  Accept and you can stash to each other.
                </p>
                <button className="btn" type="button" onClick={() => void answerRequest(alert.request, true)}>
                  Accept
                </button>
              </>
            ) : alert.kind === 'opening' ? (
              <>
                <h3>{alert.lock.senderName} is opening it now</h3>
                <p className="lede">
                  Open together and you both see each other's at the same moment. They'll wait a minute.
                </p>
                <button className="btn" type="button" onClick={() => void confirm(alert.lock.id)}>
                  Open together
                </button>
              </>
            ) : (
              <>
                <h3>{alert.lock.senderName} opened it without you</h3>
                <p className="lede">Yours is still sealed. Take a look when you're ready.</p>
                <button className="btn" type="button" onClick={() => void confirm(alert.lock.id)}>
                  Take a look
                </button>
              </>
            )}
          </div>
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
                    const index = value.indexOf(':');
                    const kind = value.slice(0, index) as 'group' | 'pair' | 'moment';
                    setScope({ kind, id: value.slice(index + 1) });
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
                {knownMoments.length > 0 ? (
                  <optgroup label="Moments">
                    {knownMoments.map((moment) => (
                      <option key={moment} value={`moment:${moment}`}>
                        {moment}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          ) : null}

          {waitingMoments.length + metMoments.length > 0 ? (
            <div className="here-row" aria-label="I'm here">
              <span title="Some cards for you are tied to a moment. Tap it when you're there and the sender is told.">
                I'm here:
              </span>
              {[...waitingMoments, ...metMoments].map((moment) => {
                const done = metMoments.includes(moment);
                return (
                  <button
                    key={moment}
                    type="button"
                    className={`chip ${done ? 'active' : ''}`}
                    disabled={hereBusy !== null || done}
                    onClick={() => void here(moment)}
                  >
                    {hereBusy === moment ? '…' : `${done ? '✓ ' : ''}${moment}`}
                  </button>
                );
              })}
            </div>
          ) : null}

          {prompts.length > 0 ? (
            <div className="prompt-rail">
              {prompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onStash={(friendId) => openCapture(friendId)}
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
              <Icon
                name="empty-clothesline"
                width={260}
                className="empty-illustration"
              />
              <p className="empty-line">nothing on the line yet.</p>
              {me ? (
                <div className="code-block">
                  <div>Your code</div>
                  <strong>{me.pairingCodeDisplay}</strong>
                  {copyButton('invite-empty', inviteLink, 'Copy invite link', 'btn')}
                </div>
              ) : null}
              <div className="rule">or</div>
              <p className="lede">Enter a friend's code. They'll get a request to accept.</p>
              <PairingCodeInput error={pairError} onSubmit={pair} />
            </div>
          ) : (
            <div className="feed">
              {scopedInbox.length === 0 ? (
                <p className="hint" style={{ textAlign: 'center' }}>
                  Nothing here yet for this{' '}
                  {scope.kind === 'group' ? 'group' : scope.kind === 'moment' ? 'moment' : 'pair'}.
                </p>
              ) : null}
              {scopedInbox.map((lock) => (
                <Polaroid
                  key={lock.id}
                  lock={lock}
                  viewerId={viewerId}
                  onConfirm={confirm}
                  onSetCondition={setCondition}
                  onReply={(recipientId, lockId) => openCapture(recipientId, lockId)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {!capturing ? (
        <div className="capture">
          <button type="button" aria-label="Capture" onClick={() => openCapture()}>
            <Icon name="stash-button" width={28} />
          </button>
        </div>
      ) : null}

      {previewOpen ? (
        <AlertPreview
          preview={preview}
          loading={previewLoading}
          pushConfigured={Boolean(alertStatus?.pushConfigured)}
          onClose={() => setPreviewOpen(false)}
          busy={alertBusy}
          onRefresh={() => void loadPreview(true)}
          onPop={(item) => {
            void showLocalAlert(item).then((result) => {
              toast(describeLocalResult(result, 'Popped — check the corner of your screen.'));
            });
          }}
          onSendReal={(item) => void sendTestAlert(item)}
          onStash={(item) => {
            setPreviewOpen(false);
            openCapture(item.friendId);
          }}
        />
      ) : null}

      {capturing ? (
        <CaptureSheet
          friends={friends}
          groups={groups}
          people={people}
          skies={skies}
          knownMoments={knownMoments}
          eventsFor={(schoolId) => schoolEventsFor(schoolId, new Date(), 21).slice(0, 3)}
          campusFor={(schoolId) => campusFor(schoolId)}
          token={token}
          presetRecipientId={replyTo}
          replyToId={replyToLockId}
          onClose={() => setCapturing(false)}
          onSubmit={async (input) => {
            const lock = await api.createLock(tokenRef.current || (await token()), input);
            setSent((current) => upsertLock(current, lock));
            if (lock.recipientIds.includes(viewerId)) {
              setInbox((current) => upsertLock(current, lock));
            }
            setCapturing(false);
            toast(
              lock.replyToId
                ? `Stashed back. ${lock.recipientName} starts the opening.`
                : lock.recipients.length > 1
                  ? `Stashed for ${lock.recipients.length} people.`
                  : 'Stashed.',
            );
            setPromptTick((value) => value + 1);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}
