const placeholder = /your-tenant|your-spa-client-id|example\.com/i;

export const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export const auth0 = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN ?? '',
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID ?? '',
  audience: import.meta.env.VITE_AUTH0_AUDIENCE ?? '',
};

export const isAuth0Configured =
  Boolean(auth0.domain && auth0.clientId && auth0.audience) &&
  !placeholder.test(auth0.domain) &&
  !placeholder.test(auth0.clientId);
