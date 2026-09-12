import type {
  ComposePromptRequest,
  FriendDto,
  FriendNoteDto,
  GroupDto,
  LockDto,
  PromptDto,
  UserDto,
} from '@stashd/shared';
import calendarData from '../data/academic-calendars.json';
import campusLifeData from '../data/campus-life.json';
import { api } from './api';

type SchoolEvent = {
  date: string;
  label: string;
  kind: 'stress' | 'lull' | 'milestone';
};

type School = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  events: SchoolEvent[];
};

type CampusLife = {
  athletics: Array<{ label: string; month: number; day: number }>;
  traditions: string[];
  food: string[];
};

const schools = calendarData.schools as School[];
const campusLife = campusLifeData.schools as Record<string, CampusLife>;

type DismissMap = Record<string, number>;
const DISMISS_KEY = 'stashd.promptDismissals';
const DAILY_KEY = 'stashd.promptDailyShelf';

type DailyShelf = {
  date: string;
  triggerKeys: string[];
  budget: number;
};

export function loadDismissals(): DismissMap {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '{}') as DismissMap;
  } catch {
    return {};
  }
}

export function dismissPrompt(triggerKey: string): { retired: boolean; count: number } {
  const map = loadDismissals();
  const count = (map[triggerKey] ?? 0) + 1;
  map[triggerKey] = count;
  localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  return { retired: count >= 2, count };
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

function placeCondition(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('cafe') || lower.includes('coffee')) {
    return 'Open when you get your coffee';
  }
  if (lower.includes('library')) {
    return 'Open when you find a quiet table';
  }
  if (lower.includes('campus')) {
    return 'Open when you get to campus';
  }
  return `Open when you're ${label}`;
}

export function schoolById(id?: string): School | undefined {
  if (!id) return undefined;
  return schools.find((school) => school.id === id);
}

function loadDailyShelf(): DailyShelf | null {
  try {
    return JSON.parse(localStorage.getItem(DAILY_KEY) ?? 'null') as DailyShelf | null;
  } catch {
    return null;
  }
}

function saveDailyShelf(shelf: DailyShelf) {
  localStorage.setItem(DAILY_KEY, JSON.stringify(shelf));
}

/** When friends+groups > 4, cap shelf to 3–4 cards/day (stable for the day). */
export function dailyShelfBudget(friendCount: number, groupCount: number, now = new Date()): number {
  const social = friendCount + groupCount;
  if (social <= 4) return 6;
  return hashString(dayStamp(now)) % 2 === 0 ? 3 : 4;
}

function priority(prompt: PromptDto): number {
  if (prompt.kind === 'campus' && prompt.emotion === 'athletics') return 0;
  if (prompt.kind === 'tier0' && prompt.emotion === 'waiting') return 1;
  if (prompt.kind === 'campus' && prompt.emotion === 'tradition') return 2;
  if (prompt.kind === 'campus' && prompt.emotion === 'food') return 3;
  if (prompt.kind === 'location') return 4;
  if (prompt.kind === 'weather') return 5;
  if (prompt.kind === 'tier0') return 6;
  if (prompt.kind === 'tier05') return 7;
  return 8;
}

function applyDailyBudget(candidates: PromptDto[], budget: number, now: Date): PromptDto[] {
  const sorted = [...candidates].sort((a, b) => priority(a) - priority(b));
  const date = dayStamp(now);
  const existing = loadDailyShelf();

  if (
    existing &&
    existing.date === date &&
    existing.budget === budget &&
    existing.triggerKeys.length > 0
  ) {
    const byKey = new Map(sorted.map((p) => [p.triggerKey, p]));
    const restored = existing.triggerKeys
      .map((key) => byKey.get(key))
      .filter((p): p is PromptDto => Boolean(p));
    if (restored.length > 0) {
      // Fill gaps if some were dismissed, without exceeding budget.
      if (restored.length < budget) {
        const used = new Set(restored.map((p) => p.triggerKey));
        for (const next of sorted) {
          if (used.has(next.triggerKey)) continue;
          restored.push(next);
          used.add(next.triggerKey);
          if (restored.length >= budget) break;
        }
        saveDailyShelf({
          date,
          budget,
          triggerKeys: restored.map((p) => p.triggerKey),
        });
      }
      return restored.slice(0, budget);
    }
  }

  // Prefer diversity across friends / schools.
  const picked: PromptDto[] = [];
  const usedFriends = new Set<string>();
  const usedSchools = new Set<string>();

  for (const prompt of sorted) {
    if (picked.length >= budget) break;
    const friendBusy = prompt.friendId && usedFriends.has(prompt.friendId);
    const schoolBusy = prompt.schoolId && usedSchools.has(prompt.schoolId);
    if (friendBusy && schoolBusy && picked.length + 1 < budget) continue;
    picked.push(prompt);
    if (prompt.friendId) usedFriends.add(prompt.friendId);
    if (prompt.schoolId) usedSchools.add(prompt.schoolId);
  }

  for (const prompt of sorted) {
    if (picked.length >= budget) break;
    if (picked.some((p) => p.triggerKey === prompt.triggerKey)) continue;
    picked.push(prompt);
  }

  saveDailyShelf({
    date,
    budget,
    triggerKeys: picked.map((p) => p.triggerKey),
  });
  return picked;
}

function athleticsWithinWindow(
  event: { month: number; day: number },
  now: Date,
  windowDays = 10,
): number | null {
  const year = now.getFullYear();
  let when = new Date(year, event.month - 1, event.day, 12, 0, 0);
  const delta = daysBetween(now, when);
  if (delta >= -2 && delta <= windowDays) return delta;
  when = new Date(year + 1, event.month - 1, event.day, 12, 0, 0);
  const nextDelta = daysBetween(now, when);
  if (nextDelta >= -2 && nextDelta <= windowDays) return nextDelta;
  return null;
}

function pickRotated<T>(items: T[], seed: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[hashString(seed) % items.length];
}

function campusPromptsForFriend(friend: FriendDto, now: Date): PromptDto[] {
  const school = schoolById(friend.schoolId);
  if (!school) return [];
  const life = campusLife[school.id];
  if (!life) return [];

  const out: PromptDto[] = [];
  const stamp = dayStamp(now);

  for (const event of life.athletics) {
    const delta = athleticsWithinWindow(event, now);
    if (delta === null) continue;
    const whenLabel =
      delta === 0 ? 'today' : delta < 0 ? 'just wrapped' : `in ${delta} day${delta === 1 ? '' : 's'}`;
    out.push({
      id: `campus-ath-${friend.id}-${event.month}-${event.day}`,
      kind: 'campus',
      emotion: 'athletics',
      title: `${school.name} · ${event.label}`,
      body: `${event.label} is ${whenLabel} for ${friend.displayName}'s campus. Stash the game-day mood before it's gone.`,
      friendId: friend.id,
      friendName: friend.displayName,
      schoolId: school.id,
      suggestedCondition: 'Open after the game',
      triggerKey: `campus:ath:${friend.id}:${event.month}-${event.day}:${stamp}`,
    });
  }

  const tradition = pickRotated(life.traditions, `${school.id}:trad:${stamp}:${friend.id}`);
  if (tradition) {
    out.push({
      id: `campus-trad-${friend.id}-${stamp}`,
      kind: 'campus',
      emotion: 'tradition',
      title: `${school.name} tradition`,
      body: `${tradition} — stash something for ${friend.displayName} that only makes sense at ${school.name}.`,
      friendId: friend.id,
      friendName: friend.displayName,
      schoolId: school.id,
      suggestedCondition: 'Open when you remember this place',
      triggerKey: `campus:trad:${friend.id}:${stamp}`,
    });
  }

  const food = pickRotated(life.food, `${school.id}:food:${stamp}:${friend.id}`);
  if (food) {
    out.push({
      id: `campus-food-${friend.id}-${stamp}`,
      kind: 'campus',
      emotion: 'food',
      title: 'What did you eat today?',
      body: `Send ${friend.displayName} a food polaroid — ${food} energy from their world.`,
      friendId: friend.id,
      friendName: friend.displayName,
      schoolId: school.id,
      suggestedCondition: 'Open when you eat something good',
      triggerKey: `campus:food:${friend.id}:${stamp}`,
    });
  }

  return out;
}

function emotionForCompose(
  emotion: PromptDto['emotion'],
): ComposePromptRequest['emotion'] {
  if (emotion === 'athletics') return 'athletics';
  if (emotion === 'tradition') return 'tradition';
  if (emotion === 'food') return 'food';
  if (emotion === 'weather') return 'weather';
  if (emotion === 'place') return 'place';
  if (emotion === 'stress' || emotion === 'lull' || emotion === 'milestone') return 'calendar';
  return 'soft';
}

export function buildPrompts(input: {
  me: UserDto;
  friends: FriendDto[];
  groups?: GroupDto[];
  inbox: LockDto[];
  sent: LockDto[];
  notes?: FriendNoteDto[];
  weatherBySchool?: Record<string, { tempF: number; label: string }>;
  now?: Date;
}): PromptDto[] {
  const now = input.now ?? new Date();
  const dismissals = loadDismissals();
  const prompts: PromptDto[] = [];
  const friends = input.friends.filter((friend) => !friend.isSelf);
  const groups = input.groups ?? [];

  function push(prompt: PromptDto) {
    if ((dismissals[prompt.triggerKey] ?? 0) >= 2) return;
    prompts.push(prompt);
  }

  for (const lock of input.inbox) {
    if (lock.state === 'UNLOCKED') continue;
    const age = daysBetween(new Date(lock.createdAt), now);
    if (age >= 6) {
      push({
        id: `waiting-${lock.id}`,
        kind: 'tier0',
        emotion: 'waiting',
        title: `${lock.senderName} is still waiting`,
        body: `You've had this sealed for ${age} days.${lock.conditionLabel ? ` “${lock.conditionLabel}”` : ''}`,
        friendId: lock.senderId,
        friendName: lock.senderName,
        triggerKey: `waiting:${lock.id}:${dayStamp(now)}`,
      });
    }
  }

  for (const friend of friends) {
    const sentToThem = input.sent.filter((lock) => lock.recipientId === friend.id);
    const fromThem = input.inbox.filter((lock) => lock.senderId === friend.id);
    const recentSent = sentToThem.slice(0, 4);
    const recentFromThem = fromThem.filter(
      (lock) => daysBetween(new Date(lock.createdAt), now) < 30,
    );
    if (recentSent.length >= 3 && recentFromThem.length === 0) {
      push({
        id: `reciprocity-${friend.id}`,
        kind: 'tier0',
        emotion: 'reciprocity',
        title: `You've stashed the last ${recentSent.length}`,
        body: `${friend.displayName} hasn't sent one back lately. Leave room — or send something that asks nothing back.`,
        friendId: friend.id,
        friendName: friend.displayName,
        triggerKey: `reciprocity:${friend.id}:${dayStamp(now)}`,
      });
    }

    const oldestSealed = sentToThem
      .filter((lock) => lock.state !== 'UNLOCKED')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldestSealed) {
      const age = daysBetween(new Date(oldestSealed.createdAt), now);
      if (age >= 14) {
        push({
          id: `unfired-${oldestSealed.id}`,
          kind: 'tier0',
          emotion: 'waiting',
          title: `${friend.displayName} still hasn't opened one`,
          body: oldestSealed.conditionLabel
            ? `“${oldestSealed.conditionLabel}” has been waiting since ${new Date(oldestSealed.createdAt).toLocaleDateString()}.`
            : `A sealed card has been sitting with them for ${age} days.`,
          friendId: friend.id,
          friendName: friend.displayName,
          triggerKey: `unfired:${oldestSealed.id}`,
        });
      }
    }

    const opened = fromThem.filter((lock) => lock.state === 'UNLOCKED');
    const unanswered = opened.filter(
      (lock) =>
        !sentToThem.some(
          (sent) => new Date(sent.createdAt) > new Date(lock.unlockedAt ?? lock.createdAt),
        ),
    );
    if (unanswered[0]) {
      push({
        id: `reply-${unanswered[0].id}`,
        kind: 'tier0',
        emotion: 'reciprocity',
        title: `You opened ${friend.displayName}'s card`,
        body: 'Nothing went back yet. A small stash keeps the thread alive.',
        friendId: friend.id,
        friendName: friend.displayName,
        triggerKey: `reply:${unanswered[0].id}`,
      });
    }

    const first = [...sentToThem, ...fromThem].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )[0];
    if (first) {
      const created = new Date(first.createdAt);
      if (
        created.getMonth() === now.getMonth() &&
        created.getDate() === now.getDate() &&
        created.getFullYear() < now.getFullYear()
      ) {
        push({
          id: `memory-${friend.id}-${now.getFullYear()}`,
          kind: 'tier0',
          emotion: 'memory',
          title: 'A year ago today',
          body: `You and ${friend.displayName} exchanged your first stash.`,
          friendId: friend.id,
          friendName: friend.displayName,
          triggerKey: `memory:${friend.id}:${now.getFullYear()}`,
        });
      }
    }

    if (friend.placeLabel) {
      const condition = placeCondition(friend.placeLabel);
      push({
        id: `place-${friend.id}-${friend.placeLabel}`,
        kind: 'location',
        emotion: 'place',
        title: `${friend.displayName} is at ${friend.placeLabel}`,
        body: `Stash something they can open in the moment — “${condition}.”`,
        friendId: friend.id,
        friendName: friend.displayName,
        suggestedCondition: condition,
        triggerKey: `place:${friend.id}:${friend.placeLabel}:${dayStamp(now)}`,
      });
    }

    for (const campus of campusPromptsForFriend(friend, now)) {
      push(campus);
    }

    const friendSchool = schoolById(friend.schoolId);
    if (friendSchool) {
      for (const event of friendSchool.events) {
        const when = new Date(`${event.date}T12:00:00`);
        const delta = daysBetween(now, when);
        if (delta < 0 || delta > 14) continue;
        const whenLabel = delta === 0 ? 'today' : `in ${delta} day${delta === 1 ? '' : 's'}`;
        const body =
          event.kind === 'stress'
            ? `${friend.displayName}'s ${event.label} at ${friendSchool.name} is ${whenLabel}. Stash something they can open when it hits.`
            : event.kind === 'lull'
              ? `${event.label} at ${friendSchool.name}. Soft day for ${friend.displayName}.`
              : `${event.label} at ${friendSchool.name}. Mark it with a polaroid for ${friend.displayName}.`;
        push({
          id: `friend-school-${friend.id}-${event.date}`,
          kind: 'tier1',
          emotion: event.kind,
          title: `${friend.displayName} · ${event.label}`,
          body,
          friendId: friend.id,
          friendName: friend.displayName,
          schoolId: friendSchool.id,
          sourceUrl: friendSchool.sourceUrl,
          triggerKey: `friend-school:${friend.id}:${event.date}:${event.kind}`,
        });
      }

      const weather = input.weatherBySchool?.[friendSchool.id];
      if (
        weather &&
        (weather.label === 'rainy' ||
          weather.label === 'snowy' ||
          weather.label === 'stormy' ||
          weather.tempF >= 85 ||
          weather.tempF <= 32)
      ) {
        const vibe =
          weather.label === 'rainy' || weather.label === 'stormy'
            ? 'wet out'
            : weather.label === 'snowy'
              ? 'snowy'
              : weather.tempF >= 85
                ? 'sweltering'
                : 'freezing';
        push({
          id: `weather-${friend.id}-${dayStamp(now)}`,
          kind: 'weather',
          emotion: 'weather',
          title: `${friendSchool.city} is ${vibe}`,
          body: `${weather.tempF}°F and ${weather.label} near ${friend.displayName}'s campus. Stash something for when they get inside.`,
          friendId: friend.id,
          friendName: friend.displayName,
          schoolId: friendSchool.id,
          suggestedCondition: 'Open when you get inside',
          triggerKey: `weather:${friend.id}:${dayStamp(now)}:${weather.label}`,
        });
      }
    }
  }

  for (const note of input.notes ?? []) {
    if (!note.dueAt) continue;
    const due = new Date(note.dueAt);
    const delta = daysBetween(now, due);
    if (delta <= 0 && delta >= -1) {
      push({
        id: `note-${note.id}`,
        kind: 'tier05',
        emotion: 'milestone',
        title: `You wrote this down for ${note.friendName}`,
        body: note.text,
        friendId: note.friendId,
        friendName: note.friendName,
        triggerKey: `note:${note.id}:${note.dueAt}`,
      });
    }
  }

  // Only use *recipient* school cues for campus/calendar shelf — skip sender-school fanout
  // when the graph is large so we don't spam the rail.
  const budget = dailyShelfBudget(friends.length, groups.length, now);
  if (budget > 4) {
    const mySchool = schoolById(input.me.schoolId);
    if (mySchool) {
      for (const event of mySchool.events) {
        const when = new Date(`${event.date}T12:00:00`);
        const delta = daysBetween(now, when);
        if (delta < 0 || delta > 14) continue;
        const friend = friends[0];
        if (!friend) break;
        const whenLabel = delta === 0 ? 'today' : `in ${delta} day${delta === 1 ? '' : 's'}`;
        const body =
          event.kind === 'stress'
            ? `${mySchool.name}'s ${event.label} is ${whenLabel}. Stash something ${friend.displayName} can open when it hits.`
            : event.kind === 'lull'
              ? `${event.label} at ${mySchool.name}. Soft day — send ${friend.displayName} something quiet.`
              : `${event.label} at ${mySchool.name}. Mark it with a polaroid for ${friend.displayName}.`;
        push({
          id: `school-${mySchool.id}-${event.date}`,
          kind: 'tier1',
          emotion: event.kind,
          title: event.label,
          body,
          friendId: friend.id,
          friendName: friend.displayName,
          schoolId: mySchool.id,
          sourceUrl: mySchool.sourceUrl,
          triggerKey: `school:${mySchool.id}:${event.date}:${event.kind}`,
        });
      }
    }

    if (input.me.weeklyRitual) {
      const friend = friends[0];
      if (friend) {
        push({
          id: `ritual-${dayStamp(now)}`,
          kind: 'tier0',
          emotion: 'milestone',
          title: input.me.weeklyRitual,
          body: `After ${input.me.weeklyRitual}, stash something for ${friend.displayName}.`,
          friendId: friend.id,
          friendName: friend.displayName,
          triggerKey: `ritual:${input.me.weeklyRitual}:${dayStamp(now)}`,
        });
      }
    }
  }

  return applyDailyBudget(prompts, budget, now);
}

/** Polish campus shelf cards with IFM when configured; keep local copy on failure. */
export async function polishPromptsWithIfm(
  prompts: PromptDto[],
  token: string,
): Promise<PromptDto[]> {
  const campus = prompts.filter((p) => p.kind === 'campus');
  if (campus.length === 0) return prompts;

  const polished = await Promise.all(
    campus.map(async (prompt) => {
      const school = schoolById(prompt.schoolId);
      if (!school) return prompt;
      const cue =
        prompt.emotion === 'food'
          ? prompt.body
          : prompt.title.includes('·')
            ? prompt.title.split('·').slice(1).join('·').trim()
            : prompt.title;
      try {
        const composed = await api.composePrompt(token, {
          schoolId: school.id,
          schoolName: school.name,
          cue,
          emotion: emotionForCompose(prompt.emotion),
          recipientName: prompt.friendName,
        });
        return {
          ...prompt,
          title: composed.title || prompt.title,
          body: composed.body || prompt.body,
        };
      } catch {
        return prompt;
      }
    }),
  );

  const byId = new Map(polished.map((p) => [p.id, p]));
  return prompts.map((p) => byId.get(p.id) ?? p);
}

export const SCHOOL_OPTIONS = schools.map((school) => ({
  id: school.id,
  name: school.name,
  city: school.city,
  lat: school.lat,
  lon: school.lon,
}));
