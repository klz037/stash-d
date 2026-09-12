/**
 * Weather at a fixed point. We never read the device's location: the point is
 * the school the user picked in their profile, which is as close to "where
 * they are" as this app wants to get.
 */
export type Weather = { tempF: number; label: string };

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
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
