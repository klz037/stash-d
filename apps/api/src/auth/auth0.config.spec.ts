import { ConfigService } from '@nestjs/config';
import { readAuth0Config } from './auth0.config';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback = '') => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('readAuth0Config', () => {
  it('builds the issuer and JWKS URI from the tenant domain', () => {
    const auth0 = readAuth0Config(
      configWith({
        AUTH0_DOMAIN: 'stashd.eu.auth0.com',
        AUTH0_AUDIENCE: 'https://stashd-api',
      }),
    );

    expect(auth0.issuer).toBe('https://stashd.eu.auth0.com/');
    expect(auth0.jwksUri).toBe(
      'https://stashd.eu.auth0.com/.well-known/jwks.json',
    );
    expect(auth0.audience).toBe('https://stashd-api');
  });

  it('refuses to start when the audience is missing', () => {
    // The bug this guards: an empty audience used to disable the audience
    // check, so any token the tenant issued for any API would have passed.
    expect(() =>
      readAuth0Config(configWith({ AUTH0_DOMAIN: 'stashd.eu.auth0.com' })),
    ).toThrow(/AUTH0_AUDIENCE is missing/);
  });

  it('refuses to start when the domain is missing', () => {
    expect(() =>
      readAuth0Config(configWith({ AUTH0_AUDIENCE: 'https://stashd-api' })),
    ).toThrow(/AUTH0_DOMAIN is missing/);
  });

  it('names both variables when neither is set', () => {
    expect(() => readAuth0Config(configWith({}))).toThrow(
      /AUTH0_DOMAIN and AUTH0_AUDIENCE are missing/,
    );
  });

  it('treats whitespace as missing', () => {
    expect(() =>
      readAuth0Config(
        configWith({ AUTH0_DOMAIN: 'stashd.eu.auth0.com', AUTH0_AUDIENCE: '   ' }),
      ),
    ).toThrow(/AUTH0_AUDIENCE is missing/);
  });

  it('tolerates a domain pasted with its scheme or a trailing slash', () => {
    const auth0 = readAuth0Config(
      configWith({
        AUTH0_DOMAIN: 'https://stashd.eu.auth0.com/',
        AUTH0_AUDIENCE: 'https://stashd-api',
      }),
    );

    expect(auth0.issuer).toBe('https://stashd.eu.auth0.com/');
  });

  it('still boots on the .env.example placeholders', () => {
    // The README promises a copied .env.example boots far enough to serve
    // /api/health. Placeholders fail closed at JWKS, so they are allowed.
    expect(() =>
      readAuth0Config(
        configWith({
          AUTH0_DOMAIN: 'your-tenant.auth0.com',
          AUTH0_AUDIENCE: 'https://stashd-api',
        }),
      ),
    ).not.toThrow();
  });
});
