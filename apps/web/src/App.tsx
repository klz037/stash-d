import { useAuth0 } from '@auth0/auth0-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { isAuth0Configured } from './lib/config';
import { HomePage } from './pages/HomePage';
import { Landing } from './pages/Landing';
import { PairPage } from './pages/PairPage';

function Guarded({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  if (isLoading) {
    return (
      <div className="pane" style={{ width: '100%' }}>
        <p className="lede">Opening your stash…</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <Landing
        loading={isLoading}
        onLogin={(returnTo) => {
          void loginWithRedirect({ appState: { returnTo: returnTo || '/' } });
        }}
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  if (!isAuth0Configured) {
    return (
      <div className="stage">
        <div className="phone">
          <Landing />
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="phone">
        <Routes>
          <Route
            path="/"
            element={
              <Guarded>
                <HomePage />
              </Guarded>
            }
          />
          <Route path="/pair/:code" element={<PairPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
