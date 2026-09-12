import { SongDto, SpotifyStatusDto } from '@stashd/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Pick a song to stash: what you're playing right now, what you played
 * recently, or a pasted link. Only the sender needs Spotify connected — album
 * art and previews are public URLs, so the recipient needs nothing.
 */
export function SongPicker({
  token,
  selected,
  onSelect,
  onBack,
}: {
  token: () => Promise<string>;
  selected?: SongDto;
  onSelect: (song: SongDto | undefined) => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<SpotifyStatusDto | null>(null);
  const [current, setCurrent] = useState<SongDto | null>(null);
  const [recent, setRecent] = useState<SongDto[]>([]);
  const [reason, setReason] = useState<string>();
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const access = await token();
      const state = await api.spotifyStatus(access);
      setStatus(state);
      if (state.connected) {
        const playing = await api.spotifyNowPlaying(access);
        setCurrent(playing.current);
        setRecent(playing.recent);
        setReason(playing.reason);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach Spotify.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    try {
      const access = await token();
      const { url } = await api.spotifyAuthorizeUrl(access);
      // Spotify redirects to the API, which finishes the exchange and sends the
      // browser back here with ?spotify=connected.
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Spotify.');
    }
  }

  async function resolveLink() {
    if (!link.trim()) return;
    setError('');
    try {
      const access = await token();
      const song = await api.spotifyResolve(access, link.trim());
      onSelect(song);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that link.');
    }
  }

  if (selected) {
    return (
      <>
        <h2>This song</h2>
        <div className="song-chosen">
          <img src={selected.albumArtUrl} alt="" className="song-art" />
          <div className="song-meta">
            <strong>{selected.title}</strong>
            <span>{selected.artist}</span>
          </div>
        </div>
        <p className="hint">
          They won't see the cover until they hold to unlock.
        </p>
        <div className="camera-actions">
          <button className="btn-ghost" type="button" onClick={() => onSelect(undefined)}>
            Pick another
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Share a song</h2>

      {loading ? <p className="lede">Checking Spotify…</p> : null}

      {!loading && status && !status.available ? (
        <p className="hint">
          Spotify isn't set up on this server yet. You can still paste a track
          link below.
        </p>
      ) : null}

      {!loading && status?.available && !status.connected ? (
        <>
          <p className="lede">
            Connect Spotify to stash whatever you're listening to right now.
          </p>
          <button className="btn" type="button" onClick={() => void connect()}>
            Connect Spotify
          </button>
        </>
      ) : null}

      {current ? (
        <>
          <p className="song-section">Playing now</p>
          <SongRow song={current} onSelect={onSelect} />
        </>
      ) : null}

      {status?.connected && !loading && reason ? (
        <p className="error">{reason}</p>
      ) : status?.connected && !current && !loading ? (
        <p className="hint">
          {recent.length > 0
            ? "Nothing playing right now. Here's what you just played."
            : 'Nothing playing and nothing recent on this account. Paste a link below.'}
        </p>
      ) : null}

      {recent.length > 0 ? (
        <>
          <p className="song-section">Recently played</p>
          <div className="song-list">
            {recent.map((song) => (
              <SongRow key={song.trackId} song={song} onSelect={onSelect} />
            ))}
          </div>
        </>
      ) : null}

      <label className="field">
        Or paste a Spotify link
        <input
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="open.spotify.com/track/…"
          inputMode="url"
        />
      </label>
      <button className="btn-ghost" type="button" onClick={() => void resolveLink()}>
        Use this link
      </button>

      {error ? <p className="error">{error}</p> : null}

      <div style={{ height: 10 }} />
      <button className="btn-ghost" type="button" onClick={onBack}>
        Back
      </button>
    </>
  );
}

function SongRow({
  song,
  onSelect,
}: {
  song: SongDto;
  onSelect: (song: SongDto) => void;
}) {
  return (
    <button type="button" className="song-row" onClick={() => onSelect(song)}>
      <img src={song.albumArtUrl} alt="" className="song-art-sm" />
      <span className="song-meta">
        <strong>{song.title}</strong>
        <span>{song.artist}</span>
      </span>
    </button>
  );
}
