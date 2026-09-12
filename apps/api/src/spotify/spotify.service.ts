import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SongDto,
  SPOTIFY_NOT_ALLOWED,
  SPOTIFY_SCOPES,
  SpotifyNowPlayingDto,
} from '@stashd/shared';

/**
 * fetch() throws a bare TypeError when the network is down or DNS fails.
 * Left alone that surfaces as a 500 "Internal server error" with no hint.
 * This turns it into a 502 with a sentence a person can act on.
 */
async function reach(url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    // globalThis.fetch on purpose: this is the one real network call in the
    // file, and a search-and-replace once turned it into a call to itself.
    return await globalThis.fetch(url, init);
  } catch (error) {
    throw new BadGatewayException(
      `Could not reach Spotify (${(error as Error).message}). Check the connection and try again.`,
    );
  }
}
import { randomBytes } from 'node:crypto';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { readSpotifyConfig, SpotifyConfig } from './spotify.config';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

/** Refresh a little early so a token cannot expire mid-request. */
const REFRESH_SKEW_MS = 60_000;

interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms?: number;
  preview_url?: string | null;
  artists?: Array<{ name: string }>;
  album?: { images?: Array<{ url: string; width?: number }> };
  external_urls?: { spotify?: string };
}

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);
  private readonly config: SpotifyConfig | null;

  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    this.config = readSpotifyConfig(configService);
    if (!this.config) {
      this.logger.warn(
        'Spotify is not configured (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET). Song stashing is disabled.',
      );
    }
  }

  get isAvailable(): boolean {
    return this.config !== null;
  }

  private requireConfig(): SpotifyConfig {
    if (!this.config) {
      throw new ServiceUnavailableException(
        'Spotify is not configured on this server. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.',
      );
    }
    return this.config;
  }

  // --- connect flow -------------------------------------------------------

  /**
   * Builds the Spotify consent URL and records a one-time `state` on the user.
   * State lives on the user document rather than in memory so it survives the
   * API restarting mid-flow, which `nest start --watch` does constantly.
   */
  async authorizeUrl(user: UserDocument): Promise<string> {
    const config = this.requireConfig();
    const state = randomBytes(24).toString('base64url');
    await this.usersService.setSpotifyState(user, state);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      state,
      scope: SPOTIFY_SCOPES.join(' '),
      show_dialog: 'false',
    });
    return `${ACCOUNTS}/authorize?${params.toString()}`;
  }

  /** Where to send the browser when the connect finishes. */
  get webOrigin(): string {
    return this.config?.webOrigin ?? 'http://localhost:5173';
  }

  /**
   * Completes a connect arriving as a browser redirect from Spotify. There is
   * no Auth0 bearer token on a top-level redirect, so the one-time `state` is
   * what identifies the listener: it was generated server-side, stored against
   * exactly one user, and is burned on first use.
   */
  async completeConnectByState(code: string, state: string): Promise<void> {
    const user = await this.usersService.findBySpotifyState(state);
    if (!user) {
      throw new BadRequestException(
        'That Spotify sign-in did not match. Start the connect again.',
      );
    }
    await this.completeConnect(user, code, state);
  }

  /** Exchanges the callback code for tokens and stores them server-side. */
  async completeConnect(
    user: UserDocument,
    code: string,
    state: string,
  ): Promise<void> {
    const config = this.requireConfig();

    if (!user.spotifyAuthState || user.spotifyAuthState !== state) {
      // Wrong or replayed state — refuse, and burn whatever is stored.
      await this.usersService.setSpotifyState(user, undefined);
      throw new BadRequestException(
        'That Spotify sign-in did not match. Start the connect again.',
      );
    }
    await this.usersService.setSpotifyState(user, undefined);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    });

    const token = await this.tokenRequest(body, config);
    if (!token.refresh_token) {
      throw new BadRequestException(
        'Spotify did not return a refresh token. Try connecting again.',
      );
    }

    // Spotify in development mode answers 403 for any listener not on the
    // app's allow list. Refuse the connect here with a real reason rather than
    // storing tokens that will fail on every later call.
    const profileRes = await reach(`${API}/me`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (profileRes.status === 403) {
      throw new ForbiddenException(SPOTIFY_NOT_ALLOWED);
    }
    const profile = profileRes.ok
      ? ((await profileRes.json()) as { id?: string; display_name?: string })
      : {};

    await this.usersService.setSpotifyTokens(user, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      spotifyUserId: profile.id,
      displayName: profile.display_name,
      connectedAt: new Date(),
    });
  }

  async disconnect(user: UserDocument): Promise<void> {
    await this.usersService.clearSpotify(user);
  }

  // --- reading what they're listening to ----------------------------------

  async nowPlaying(user: UserDocument): Promise<SpotifyNowPlayingDto> {
    const accessToken = await this.freshAccessToken(user);

    const [current, recent] = await Promise.all([
      this.currentlyPlaying(accessToken),
      this.recentlyPlayed(accessToken),
    ]);

    // Don't repeat the current track at the top of the recent list.
    const deduped = recent.songs.filter((song) => song.trackId !== current.song?.trackId);
    // A 403 on either endpoint means Spotify won't serve this listener at
    // all. Say so instead of showing an empty list that looks like "no music".
    const reason =
      current.status === 403 || recent.status === 403
        ? SPOTIFY_NOT_ALLOWED
        : recent.status && recent.status !== 200
          ? `Spotify answered ${recent.status} for recently played.`
          : undefined;
    return { current: current.song, recent: deduped.slice(0, 12), reason };
  }

  private async currentlyPlaying(
    accessToken: string,
  ): Promise<{ song: SongDto | null; status: number }> {
    const response = await reach(`${API}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 204 = nothing playing. Perfectly normal, not an error.
    if (response.status === 204 || response.status === 404) {
      return { song: null, status: 204 };
    }
    if (!response.ok) {
      this.logger.debug(`currently-playing returned ${response.status}`);
      return { song: null, status: response.status };
    }
    const body = (await response.json()) as { item?: SpotifyTrack | null };
    return { song: body.item ? this.toSong(body.item) : null, status: 200 };
  }

  private async recentlyPlayed(
    accessToken: string,
  ): Promise<{ songs: SongDto[]; status: number }> {
    const response = await reach(`${API}/me/player/recently-played?limit=20`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      this.logger.debug(`recently-played returned ${response.status}`);
      return { songs: [], status: response.status };
    }
    const body = (await response.json()) as {
      items?: Array<{ track?: SpotifyTrack }>;
    };
    const songs: SongDto[] = [];
    const seen = new Set<string>();
    for (const item of body.items ?? []) {
      if (!item.track?.id || seen.has(item.track.id)) {
        continue;
      }
      seen.add(item.track.id);
      songs.push(this.toSong(item.track));
    }
    return { songs, status: 200 };
  }

  // --- resolving a specific track -----------------------------------------

  /**
   * The single source of truth for what gets stored on a lock. The client sends
   * only a track id; everything shown to the recipient is fetched here, so a
   * caller cannot plant an arbitrary image URL in someone else's Stash.
   */
  async resolveTrack(user: UserDocument, trackId: string): Promise<SongDto> {
    const id = normalizeTrackId(trackId);
    if (!id) {
      throw new BadRequestException('That does not look like a Spotify track.');
    }

    // Prefer the user's own token; fall back to an app-only token so a
    // recipient-side or disconnected lookup still works.
    const accessToken = user.spotify?.refreshToken
      ? await this.freshAccessToken(user)
      : await this.appAccessToken();

    const track = await this.getJson<SpotifyTrack>(
      `${API}/tracks/${id}`,
      accessToken,
    );
    if (!track?.id) {
      throw new BadRequestException('Spotify could not find that track.');
    }
    return this.toSong(track);
  }

  // --- tokens --------------------------------------------------------------

  private async freshAccessToken(user: UserDocument): Promise<string> {
    const config = this.requireConfig();
    const spotify = user.spotify;
    if (!spotify?.refreshToken) {
      throw new BadRequestException('Connect Spotify first.');
    }

    const stillValid =
      spotify.accessToken &&
      spotify.expiresAt &&
      spotify.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
    if (stillValid) {
      return spotify.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotify.refreshToken,
    });
    const token = await this.tokenRequest(body, config);

    await this.usersService.setSpotifyTokens(user, {
      accessToken: token.access_token,
      // Spotify usually omits refresh_token on refresh; keep the existing one.
      refreshToken: token.refresh_token ?? spotify.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      spotifyUserId: spotify.spotifyUserId,
      displayName: spotify.displayName,
      connectedAt: spotify.connectedAt ?? new Date(),
    });
    return token.access_token;
  }

  /** Client-credentials token, for lookups not tied to a specific listener. */
  private async appAccessToken(): Promise<string> {
    const config = this.requireConfig();
    const token = await this.tokenRequest(
      new URLSearchParams({ grant_type: 'client_credentials' }),
      config,
    );
    return token.access_token;
  }

  private async tokenRequest(
    body: URLSearchParams,
    config: SpotifyConfig,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }> {
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString('base64');

    const response = await reach(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`Spotify token request failed: ${response.status} ${detail}`);
      throw new BadRequestException(
        'Spotify rejected that sign-in. Try connecting again.',
      );
    }
    return response.json() as Promise<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>;
  }

  private async getJson<T>(url: string, accessToken: string): Promise<T> {
    const response = await reach(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new BadRequestException(`Spotify request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }

  private toSong(track: SpotifyTrack): SongDto {
    // Spotify returns images widest-first; the middle one is plenty for a card.
    const images = track.album?.images ?? [];
    const art = images[1]?.url ?? images[0]?.url ?? '';
    return {
      trackId: track.id,
      title: track.name,
      artist: (track.artists ?? []).map((a) => a.name).join(', ') || 'Unknown artist',
      albumArtUrl: art,
      spotifyUrl:
        track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
      previewUrl: track.preview_url ?? undefined,
      durationMs: track.duration_ms,
    };
  }
}

/** Accepts a raw id, a spotify:track: URI, or any open.spotify.com track link. */
export function normalizeTrackId(input: string): string | null {
  const value = (input ?? '').trim();
  if (!value) {
    return null;
  }
  if (/^[A-Za-z0-9]{22}$/.test(value)) {
    return value;
  }
  const uri = value.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) {
    return uri[1];
  }
  const link = value.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/,
  );
  if (link) {
    return link[1];
  }
  return null;
}
