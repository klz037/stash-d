/**
 * The sky over a school: weather, local time, sunrise, sunset.
 *
 * We never read the device's location. Every place in this app is a school
 * someone picked in their profile, and this is everything we know about it.
 */
export type Sky = {
  schoolId: string;
  city: string;
  timezone: string;
  tempF: number;
  code: number;
  /** clear · partly cloudy · rainy · snowy · stormy */
  label: string;
  isDay: boolean;
  /** Minutes since local midnight. */
  sunriseMin: number;
  sunsetMin: number;
  fetchedAt: number;
};

const TTL_MS = 20 * 60_000;
const memory = new Map<string, Sky>();

function labelFor(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly cloudy';
  if (code <= 67) return 'rainy';
  if (code <= 77) return 'snowy';
  return 'stormy';
}

function minutesOf(isoLocal: string): number {
  const time = isoLocal.slice(11, 16);
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isWet(sky: Pick<Sky, 'label'>): boolean {
  return sky.label === 'rainy' || sky.label === 'snowy' || sky.label === 'stormy';
}

/** Minutes since midnight right now, at that place. */
export function localMinutes(timezone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** "7:12 AM" for a minutes-since-midnight value. */
export function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "7:12 AM" right now, at that place. */
export function localClock(timezone: string, now = new Date()): string {
  return clock(localMinutes(timezone, now));
}

export function describeSky(sky: Sky): string {
  return `${sky.tempF}° and ${sky.label}`;
}

function readCache(schoolId: string): Sky | null {
  const hit = memory.get(schoolId);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  try {
    const raw = localStorage.getItem(`stashd.sky.${schoolId}`);
    if (!raw) return null;
    const sky = JSON.parse(raw) as Sky;
    if (Date.now() - sky.fetchedAt < TTL_MS) {
      memory.set(schoolId, sky);
      return sky;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeCache(sky: Sky) {
  memory.set(sky.schoolId, sky);
  try {
    localStorage.setItem(`stashd.sky.${sky.schoolId}`, JSON.stringify(sky));
  } catch {
    // ignore
  }
}

export async function fetchSky(school: {
  id: string;
  city: string;
  lat: number;
  lon: number;
}): Promise<Sky | null> {
  const cached = readCache(school.id);
  if (cached) return cached;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${school.lat}&longitude=${school.lon}` +
      `&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset` +
      `&timezone=auto&forecast_days=1&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      timezone?: string;
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
      daily?: { sunrise?: string[]; sunset?: string[] };
    };
    const temp = data.current?.temperature_2m;
    const sunrise = data.daily?.sunrise?.[0];
    const sunset = data.daily?.sunset?.[0];
    if (temp == null || !data.timezone || !sunrise || !sunset) return null;
    const code = data.current?.weather_code ?? 0;
    const sky: Sky = {
      schoolId: school.id,
      city: school.city,
      timezone: data.timezone,
      tempF: Math.round(temp),
      code,
      label: labelFor(code),
      isDay: data.current?.is_day === 1,
      sunriseMin: minutesOf(sunrise),
      sunsetMin: minutesOf(sunset),
      fetchedAt: Date.now(),
    };
    writeCache(sky);
    return sky;
  } catch {
    return null;
  }
}

/** Kept for the account panel and older call sites. */
export type Weather = { tempF: number; label: string };

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const sky = await fetchSky({ id: `${lat},${lon}`, city: '', lat, lon });
  return sky ? { tempF: sky.tempF, label: sky.label } : null;
}
