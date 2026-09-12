import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SPOTIFY_NOT_ALLOWED } from '@stashd/shared';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { SpotifyService } from './spotify.service';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback = '') => values[key] ?? fallback,
  } as unknown as ConfigService;
}

const connectedUser = {
  _id: 'auth0|emily',
  spotify: {
    accessToken: 'still-good',
    refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3_600_000),
  },
} as unknown as UserDocument;

describe('SpotifyService network handling', () => {
  const realFetch = globalThis.fetch;
  let service: SpotifyService;

  beforeEach(() => {
    service = new SpotifyService(
      configWith({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' }),
      {} as UsersService,
    );
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('turns a network failure into one 502, not a recursive stack of them', async () => {
    // The bug: the fetch wrapper once called itself, so every failure was
    // wrapped thousands of times before surfacing as a RangeError.
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(service.nowPlaying(connectedUser)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(service.nowPlaying(connectedUser)).rejects.toThrow(
      /^Could not reach Spotify \(fetch failed\)/,
    );
    expect((globalThis.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('reports a 403 as the development-mode allow list, not an empty list', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('{"error":{"status":403}}', { status: 403 }),
    ) as unknown as typeof fetch;

    const result = await service.nowPlaying(connectedUser);
    expect(result.current).toBeNull();
    expect(result.recent).toEqual([]);
    expect(result.reason).toBe(SPOTIFY_NOT_ALLOWED);
  });

  it('gives no reason when Spotify simply has nothing to report', async () => {
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('currently-playing')
        ? new Response(null, { status: 204 })
        : new Response('{"items":[]}', { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await service.nowPlaying(connectedUser);
    expect(result.reason).toBeUndefined();
  });
});
