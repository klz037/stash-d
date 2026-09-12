import { LockDto } from '@stashd/shared';
import { useEffect, useState } from 'react';
import { Polaroid } from '../components/Polaroid';
import { apiUrl, isAuth0Configured } from '../lib/config';

const previewLocked: LockDto = {
  id: 'preview-locked',
  senderId: 'maya',
  recipientId: 'you',
  senderName: 'Maya',
  recipientName: 'You',
  conditionType: 'MANUAL',
  conditionLabel: 'Open when you land',
  state: 'LOCKED',
  senderConfirmed: false,
  recipientConfirmed: false,
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  unlockedAt: null,
  contentHidden: true,
};

const previewUnlocked: LockDto = {
  ...previewLocked,
  id: 'preview-open',
  state: 'UNLOCKED',
  contentHidden: false,
  text: 'I left the porch light on. Call me when you see it.',
  unlockedAt: new Date().toISOString(),
};

export function Landing({
  returnTo,
  onLogin,
  loading,
}: {
  returnTo?: string;
  onLogin?: (returnTo?: string) => void;
  loading?: boolean;
}) {
  const [health, setHealth] = useState('Checking API…');
  const [preview, setPreview] = useState<LockDto>(previewLocked);

  useEffect(() => {
    const bases = [apiUrl, 'http://127.0.0.1:3000'].filter(
      (value, index, all) => value !== undefined && all.indexOf(value) === index,
    );
    void (async () => {
      for (const base of bases) {
        try {
          const response = await fetch(`${base}/api/health`);
          if (!response.ok) continue;
          const body = (await response.json()) as { mongo?: string };
          setHealth(
            body.mongo === 'up'
              ? 'API connected · Mongo up'
              : 'API reachable · Mongo not connected',
          );
          return;
        } catch {
          // try next origin
        }
      }
      setHealth('API unreachable from this origin');
    })();
  }, []);

  return (
    <div className="pane" style={{ width: '100%' }}>
      <button className="wordmark" type="button">
        stash<span>'d</span>
      </button>
      <p className="lede">
        Long-distance, on purpose. You stash a lock — a note, a photo, a memory —
        and your friend holds to open it when the time is right.
      </p>
      {!isAuth0Configured || !onLogin ? (
        <div className="code-block">
          <div>Auth0 is not configured yet</div>
          <p className="hint">
            Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code> and
            set <code>VITE_AUTH0_DOMAIN</code>, <code>VITE_AUTH0_CLIENT_ID</code>, and{' '}
            <code>VITE_AUTH0_AUDIENCE</code>. The API validates the same tenant via JWKS
            — no client secret.
          </p>
        </div>
      ) : (
        <button
          className="btn"
          type="button"
          disabled={loading}
          onClick={() => onLogin(returnTo)}
        >
          Sign in
        </button>
      )}
      <p className="hint">{health}</p>
      {!isAuth0Configured ? (
        <div className="feed" style={{ marginTop: 22 }}>
          <p className="lede">Hold the sealed lock. This preview stays on-device.</p>
          <Polaroid
            lock={preview}
            viewerId="you"
            onConfirm={async () => setPreview(previewUnlocked)}
            onReply={() => setPreview(previewLocked)}
          />
        </div>
      ) : null}
    </div>
  );
}
