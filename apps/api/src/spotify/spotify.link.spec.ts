import { normalizeTrackId } from './spotify.service';

describe('normalizeTrackId', () => {
  const id = '4cOdK2wGLETKBW3PvgPWqT';

  it('accepts a bare track id', () => {
    expect(normalizeTrackId(id)).toBe(id);
  });

  it('accepts a spotify: URI', () => {
    expect(normalizeTrackId(`spotify:track:${id}`)).toBe(id);
  });

  it('accepts a share link, including the ?si= tracking suffix', () => {
    expect(normalizeTrackId(`https://open.spotify.com/track/${id}?si=abc123`)).toBe(id);
  });

  it('accepts the localised links the mobile app produces', () => {
    expect(normalizeTrackId(`https://open.spotify.com/intl-de/track/${id}`)).toBe(id);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(normalizeTrackId(`  https://open.spotify.com/track/${id}  `)).toBe(id);
  });

  it('rejects albums, playlists and junk', () => {
    expect(normalizeTrackId(`https://open.spotify.com/album/${id}`)).toBeNull();
    expect(normalizeTrackId(`https://open.spotify.com/playlist/${id}`)).toBeNull();
    expect(normalizeTrackId('https://example.com/not-spotify')).toBeNull();
    expect(normalizeTrackId('')).toBeNull();
    expect(normalizeTrackId('too-short')).toBeNull();
  });
});
