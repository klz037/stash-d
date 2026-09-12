import { ConfigService } from '@nestjs/config';

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Where to send the browser once the connect finishes. */
  webOrigin: string;
}

/**
 * Spotify credentials. Unlike Auth0, these are optional: the app is fully
 * usable without them — you just cannot stash a song. So this returns null
 * instead of throwing, and every Spotify route reports "unavailable" rather
 * than 500-ing. Registering the app is a dashboard step nobody should have to
 * do before the core loop runs.
 */
export function readSpotifyConfig(config: ConfigService): SpotifyConfig | null {
  const clientId = (config.get<string>('SPOTIFY_CLIENT_ID', '') ?? '').trim();
  const clientSecret = (config.get<string>('SPOTIFY_CLIENT_SECRET', '') ?? '').trim();
  const redirectUri = (
    config.get<string>(
      'SPOTIFY_REDIRECT_URI',
      // Spotify rejects the hostname "localhost" outright: a loopback redirect
      // must use the literal IP. This points at the API, not the SPA, so the
      // web app can stay on whatever origin it likes.
      'http://127.0.0.1:3000/api/spotify/callback',
    ) ?? ''
  ).trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  const webOrigin = (
    config.get<string>('WEB_ORIGIN', 'http://localhost:5173') ?? ''
  ).replace(/\/+$/, '');

  return { clientId, clientSecret, redirectUri, webOrigin };
}
