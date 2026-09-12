import { useAuth0 } from '@auth0/auth0-react';
import { formatPairingCode } from '@stashd/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Landing } from './Landing';

export function PairPage() {
  const { code = '' } = useParams();
  const { isAuthenticated, isLoading, getAccessTokenSilently, loginWithRedirect } =
    useAuth0();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Getting you connected.');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated || isLoading) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessTokenSilently();
        await api.pair(token, code);
        if (!cancelled) {
          navigate('/', { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not pair.');
          setStatus('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, getAccessTokenSilently, isAuthenticated, isLoading, navigate]);

  if (!isAuthenticated && !isLoading) {
    return (
      <Landing
        returnTo={`/pair/${code}`}
        onLogin={(returnTo) => {
          void loginWithRedirect({ appState: { returnTo: returnTo || `/pair/${code}` } });
        }}
      />
    );
  }

  return (
    <div className="pane" style={{ width: '100%' }}>
      <h2>{status || 'Almost.'}</h2>
      <p className="lede">Connecting you with {formatPairingCode(code)}.</p>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
