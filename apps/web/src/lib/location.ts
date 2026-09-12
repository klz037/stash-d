import { coarsenCoordinate } from '@stashd/shared';

const CAFE_WORDS = ['cafe', 'coffee', 'espresso', 'starbucks', 'dunkin'];
const LIBRARY_WORDS = ['library', 'lib'];
const CAMPUS_WORDS = ['university', 'college', 'campus', 'hall', 'quad'];

export type CoarsePlace = {
  coarseLat: number;
  coarseLon: number;
  placeLabel: string;
};

function labelFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (CAFE_WORDS.some((word) => lower.includes(word))) return 'a cafe';
  if (LIBRARY_WORDS.some((word) => lower.includes(word))) return 'the library';
  if (CAMPUS_WORDS.some((word) => lower.includes(word))) return 'campus';
  return undefined;
}

/** Prefer a coarse category over an address. Never returns street-level detail. */
export async function reversePlaceLabel(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'stashd-demo/0.1',
      },
    });
    if (!res.ok) return 'out';
    const data = (await res.json()) as {
      name?: string;
      display_name?: string;
      type?: string;
      category?: string;
    };
    const named = labelFromName(
      `${data.name ?? ''} ${data.display_name ?? ''} ${data.type ?? ''} ${data.category ?? ''}`,
    );
    if (named) return named;
    if (data.category === 'amenity' && data.type === 'cafe') return 'a cafe';
    if (data.category === 'amenity' && data.type === 'library') return 'the library';
    return 'out';
  } catch {
    return 'out';
  }
}

export function watchCoarseLocation(
  onPlace: (place: CoarsePlace) => void,
  onError?: (message: string) => void,
): () => void {
  if (!navigator.geolocation) {
    onError?.('Location is unavailable on this device.');
    return () => undefined;
  }
  let lastSent = 0;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      if (now - lastSent < 60_000) return;
      lastSent = now;
      const coarseLat = coarsenCoordinate(pos.coords.latitude);
      const coarseLon = coarsenCoordinate(pos.coords.longitude);
      void reversePlaceLabel(coarseLat, coarseLon).then((placeLabel) => {
        onPlace({ coarseLat, coarseLon, placeLabel });
      });
    },
    (err) => onError?.(err.message || 'Could not read location.'),
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export async function fetchSchoolWeather(
  lat: number,
  lon: number,
): Promise<{ tempF: number; label: string } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code ?? 0;
    if (temp == null) return null;
    const label =
      code === 0
        ? 'clear'
        : code <= 3
          ? 'partly cloudy'
          : code <= 67
            ? 'rainy'
            : code <= 77
              ? 'snowy'
              : 'stormy';
    return { tempF: Math.round(temp), label };
  } catch {
    return null;
  }
}
