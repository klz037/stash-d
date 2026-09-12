import { Auth0Provider } from '@auth0/auth0-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { auth0, isAuth0Configured } from './lib/config';
import './styles.css';

registerSW({ immediate: true });

const root = createRoot(document.getElementById('root')!);

function Root() {
  return (
    <BrowserRouter>
      {isAuth0Configured ? (
        <Auth0Provider
          domain={auth0.domain}
          clientId={auth0.clientId}
          authorizationParams={{
            redirect_uri: window.location.origin,
            audience: auth0.audience,
          }}
          onRedirectCallback={(appState) => {
            const target = appState?.returnTo || window.location.pathname;
            window.history.replaceState({}, document.title, target);
          }}
        >
          <App />
        </Auth0Provider>
      ) : (
        <App />
      )}
    </BrowserRouter>
  );
}

root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
