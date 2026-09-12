import { isAuth0Configured } from '../lib/config';

export function Landing({
  returnTo,
  onLogin,
  loading,
}: {
  returnTo?: string;
  onLogin?: (returnTo?: string) => void;
  loading?: boolean;
}) {
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
    </div>
  );
}
