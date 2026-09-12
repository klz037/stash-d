import { LockDto } from '@stashd/shared';
import { useEffect, useState } from 'react';
import { Polaroid } from '../components/Polaroid';
import { apiUrl, isAuth0Configured } from '../lib/config';

const previewLocked: LockDto = {
  id: 'preview-locked',
  senderId: 'maya',
  recipientIds: ['you'],
  recipients: [{ id: 'you', displayName: 'You' }],
  participantIds: ['maya', 'you'],
  confirmedIds: [],
  senderName: 'Maya',
  recipientName: 'You',
  conditionType: 'MANUAL',
  conditionLabel: 'Open when you land',
  context: null,
  contextMetAt: null,
  contextMetBy: null,
  contextMetByName: null,
  requiresMfa: false,
  state: 'LOCKED',
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  unlockedAt: null,
  mediaKind: 'TEXT',
  contentHidden: true,
};

const previewUnlocked: LockDto = {
  ...previewLocked,
  id: 'preview-open',
  state: 'UNLOCKED',
  confirmedIds: ['you'],
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
      <h1 className="brand-big">
        stash<span>'d</span>
      </h1>
      <p className="lede intro">
        For the friends you don't see enough. Leave them a note, a photo, or a
        song they can't open yet. You pick when it opens: when they land, when
        you're both holding, or whenever they decide. Until then it stays sealed.
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
      <p className="hint" style={{ textAlign: 'center' }}>{health}</p>
      {!isAuth0Configured ? (
        <div className="feed" style={{ marginTop: 22 }}>
          <p className="lede">Try it. Press and hold the card.</p>
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
