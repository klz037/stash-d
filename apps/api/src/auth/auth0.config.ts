import { ConfigService } from '@nestjs/config';

export interface Auth0Config {
  domain: string;
  audience: string;
  issuer: string;
  jwksUri: string;
}

/**
 * Reads the Auth0 settings both token validators depend on — the HTTP JWT
 * strategy and the Socket.IO gateway — and refuses to start without them.
 *
 * Both used to fall back to empty strings, which failed in two different ways:
 * a missing domain pointed JWKS at example.invalid (rejecting every token,
 * confusingly), and a missing audience silently disabled the audience check,
 * so any token the tenant issued for any API would have been accepted. A
 * misconfigured deploy should not boot at all.
 *
 * Placeholder values (your-tenant.auth0.com) are deliberately allowed: the
 * README promises the API boots on a copied .env.example so you can hit
 * /api/health before you have a tenant. Placeholders fail closed at JWKS.
 */
export function readAuth0Config(config: ConfigService): Auth0Config {
  const domain = normalizeDomain(config.get<string>('AUTH0_DOMAIN', ''));
  const audience = (config.get<string>('AUTH0_AUDIENCE', '') ?? '').trim();

  const missing = [
    domain ? null : 'AUTH0_DOMAIN',
    audience ? null : 'AUTH0_AUDIENCE',
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new Error(
      `Auth0 is not configured: ${missing.join(' and ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. Every access token is validated against this tenant and this ` +
        `audience; without them the API would accept tokens it should reject. ` +
        `Copy apps/api/.env.example to apps/api/.env and set real values.`,
    );
  }

  return {
    domain,
    audience,
    issuer: `https://${domain}/`,
    jwksUri: `https://${domain}/.well-known/jwks.json`,
  };
}

/** Tolerate `https://tenant.auth0.com/` — otherwise the issuer doubles the scheme. */
function normalizeDomain(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}
