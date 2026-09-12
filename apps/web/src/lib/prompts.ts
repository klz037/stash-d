import type { FriendDto, FriendNoteDto, LockDto, PromptDto, UserDto } from '@stashd/shared';
import calendarData from '../data/academic-calendars.json';

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

const schools = calendarData.schools as School[];

type DismissMap = Record<string, number>;
const DISMISS_KEY = 'stashd.promptDismissals';

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

export function buildPrompts(input: {
  me: UserDto;
  friends: FriendDto[];
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

  const priority = (kind: PromptDto['kind']) =>
    kind === 'location' ? 0 : kind === 'weather' ? 1 : kind === 'tier0' ? 2 : kind === 'tier05' ? 3 : 4;
  return prompts.sort((a, b) => priority(a.kind) - priority(b.kind)).slice(0, 6);
}

export const SCHOOL_OPTIONS = schools.map((school) => ({
  id: school.id,
  name: school.name,
  city: school.city,
  lat: school.lat,
  lon: school.lon,
}));
