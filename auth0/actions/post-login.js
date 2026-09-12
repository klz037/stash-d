/**
 * stash'd · Post-Login Action
 *
 * Paste this into Auth0 → Actions → Library → Build Custom → "Login / Post Login",
 * deploy it, then drag it into the Login flow (Actions → Flows → Login).
 *
 * What it does
 * ------------
 * 1. Step-up. When the SPA asks for a login with
 *      acr_values=http://schemas.openid.net/pape/policies/2007/06/multi-factor
 *    and the session has not already done MFA, it turns MFA on for this
 *    transaction. Tenant MFA policy stays "Never": this Action is the only
 *    thing that ever asks, so ordinary sign-ins stay one tap.
 *
 * 2. Claim. It stamps the access token with `https://stashd/mfa: true|false`.
 *    The API refuses to open a "second key" lock unless that claim is true.
 *    That check is in apps/api/src/stashes/stashes.service.ts (confirm), and it
 *    is enforced server-side: a plain token gets 403 MFA_REQUIRED no matter
 *    what the UI does.
 *
 * Why set the claim to true *before* the challenge runs
 * ----------------------------------------------------
 * Actions run before the MFA prompt. If we only wrote the claim after seeing
 * `mfa` in event.authentication.methods, a fresh step-up login would get
 * `false`. Setting it alongside multifactor.enable is safe: when MFA is
 * enabled for a transaction, Auth0 issues no token at all unless the
 * challenge succeeds. So "true" here always means "MFA happened".
 *
 * Verify
 * ------
 * Sign in normally → GET /api/me → `"mfa": false`.
 * Tap a "second key" lock → redirected → complete OTP → GET /api/me → `"mfa": true`.
 * (The account panel in the app shows the same thing as "Second key: on".)
 */
const MFA_ACR = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';
const CLAIM = 'https://stashd/mfa';

exports.onExecutePostLogin = async (event, api) => {
  const acrValues = event.transaction?.acr_values ?? [];
  const wantsMfa = acrValues.includes(MFA_ACR);
  const hasMfa = (event.authentication?.methods ?? []).some(
    (method) => method.name === 'mfa',
  );

  if (wantsMfa && !hasMfa) {
    // Any enrolled factor. allowRememberBrowser=false so the second key is
    // asked for every time a step-up is requested, which is the point.
    api.multifactor.enable('any', { allowRememberBrowser: false });
  }

  const mfa = wantsMfa || hasMfa;
  api.accessToken.setCustomClaim(CLAIM, mfa);
  api.idToken.setCustomClaim(CLAIM, mfa);
};
