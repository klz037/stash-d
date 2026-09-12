import type { FriendDto, PromptDto, UserDto } from '@stashd/shared';
import { loadDismissals } from './prompts';
import { clock, isWet, localMinutes, Sky } from './weather';

/**
 * Prompts that come from a friend's sky, not from the app's own bookkeeping.
 * Their school tells us their weather, their clock, their sunrise and sunset.
 * "It's raining on Maya" is a reason to send her yours.
 */

export type SkyMap = Record<string, Sky | undefined>;

function cap(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function dayStamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildSkyPrompts(input: {
  me: UserDto;
  friends: FriendDto[];
  skies: SkyMap;
  now?: Date;
}): PromptDto[] {
  const now = input.now ?? new Date();
  const day = dayStamp(now);
  const dismissals = loadDismissals();
  const out: PromptDto[] = [];
  const mine = input.me.schoolId ? input.skies[input.me.schoolId] : undefined;
  const myMinutes = mine ? localMinutes(mine.timezone, now) : now.getHours() * 60 + now.getMinutes();

  function push(prompt: PromptDto) {
    if ((dismissals[prompt.triggerKey] ?? 0) >= 2) return;
    out.push(prompt);
  }

  for (const friend of input.friends) {
    if (friend.isSelf || !friend.schoolId) continue;
    const sky = input.skies[friend.schoolId];
    if (!sky) continue;
    // Same campus: nothing to contrast.
    if (mine && mine.schoolId === sky.schoolId) continue;

    const name = friend.displayName;
    const theirMinutes = localMinutes(sky.timezone, now);
    const base = { friendId: friend.id, friendName: name, kind: 'tier1' as const, emotion: 'weather' as const };

    if (isWet(sky) && (!mine || !isWet(mine))) {
      push({
        ...base,
        id: `sky-wet-${friend.id}`,
        title: `${cap(sky.label)} in ${sky.city}`,
        body: mine
          ? `${sky.tempF}° and ${sky.label} on ${name}. It's ${mine.label} here. Take a picture of your sky and send it over.`
          : `${sky.tempF}° and ${sky.label} where ${name} is. Send them your sky.`,
        triggerKey: `sky:wet:${friend.id}:${day}`,
      });
    }

    if (mine && Math.abs(mine.tempF - sky.tempF) >= 20) {
      push({
        ...base,
        id: `sky-gap-${friend.id}`,
        title: `${sky.tempF}° in ${sky.city}, ${mine.tempF}° here`,
        body:
          mine.tempF > sky.tempF
            ? `Send ${name} some of your warm.`
            : `${name} has the better weather today. Ask for a picture of it.`,
        triggerKey: `sky:gap:${friend.id}:${day}`,
      });
    }

    const toSunrise = sky.sunriseMin - theirMinutes;
    if (toSunrise >= -30 && toSunrise <= 60) {
      push({
        ...base,
        id: `sky-sunrise-${friend.id}`,
        title: `Sunrise in ${sky.city}`,
        body: `The sun comes up for ${name} at ${clock(sky.sunriseMin)}. Stash something they open with their first coffee.`,
        triggerKey: `sky:sunrise:${friend.id}:${day}`,
      });
    }

    const toSunset = sky.sunsetMin - theirMinutes;
    if (toSunset >= -30 && toSunset <= 60) {
      push({
        ...base,
        id: `sky-sunset-${friend.id}`,
        title: `Golden hour in ${sky.city}`,
        body: `${name}'s sun sets at ${clock(sky.sunsetMin)}. Stash something they open once it's dark.`,
        triggerKey: `sky:sunset:${friend.id}:${day}`,
      });
    }

    const theirHour = Math.floor(theirMinutes / 60);
    const gapHours = Math.abs(theirMinutes - myMinutes) / 60;
    if (gapHours >= 2 && (theirHour >= 22 || theirHour < 5)) {
      push({
        ...base,
        id: `sky-night-${friend.id}`,
        title: `It's ${clock(theirMinutes)} for ${name}`,
        body: `They're probably asleep. Stash something for when they wake up.`,
        triggerKey: `sky:night:${friend.id}:${day}`,
      });
    } else if (gapHours >= 2 && theirHour >= 6 && theirHour < 9 && myMinutes > theirMinutes) {
      push({
        ...base,
        id: `sky-morning-${friend.id}`,
        title: `${name}'s morning`,
        body: `It's ${clock(theirMinutes)} in ${sky.city}. Send something for the walk to class.`,
        triggerKey: `sky:morning:${friend.id}:${day}`,
      });
    }
  }

  return out.slice(0, 3);
}

/**
 * Condition lines a sender can tap instead of typing, worked out from the
 * recipients' skies. "Open when it stops raining" only shows up if it's
 * actually raining on them.
 */
export function suggestConditions(recipientSkies: Sky[], now = new Date()): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  const seen = new Set<string>();
  for (const sky of recipientSkies) {
    if (seen.has(sky.schoolId)) continue;
    seen.add(sky.schoolId);
    const minutes = localMinutes(sky.timezone, now);
    const hour = Math.floor(minutes / 60);

    if (sky.label === 'rainy' || sky.label === 'stormy') add('Open when it stops raining');
    if (sky.label === 'snowy') add('Open when the snow stops');
    if (minutes < sky.sunriseMin || hour >= 21) add(`Open when the sun comes up (${clock(sky.sunriseMin)})`);
    if (sky.isDay && minutes < sky.sunsetMin) add(`Open at sunset (${clock(sky.sunsetMin)})`);
    if (hour >= 22 || hour < 5) add('Open when you wake up');
    if (hour >= 5 && hour < 10) add('Open with your coffee');
    if (sky.tempF < 40) add("Open when you're warm inside");
    if (sky.tempF > 85) add('Open somewhere with air conditioning');
    if (sky.label === 'clear' && sky.isDay) add("Open when you're outside in the sun");
  }
  return out.slice(0, 4);
}
