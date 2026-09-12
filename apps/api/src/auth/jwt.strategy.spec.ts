import { ConfigService } from '@nestjs/config';
import { MFA_CLAIM } from '@stashd/shared';
import { JwtStrategy } from './jwt.strategy';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback = '') => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy(
    configWith({
      AUTH0_DOMAIN: 'stashd.eu.auth0.com',
      AUTH0_AUDIENCE: 'https://stashd-api',
    }),
  );

  it('reads the namespaced MFA claim the post-login Action sets', () => {
    const claims = strategy.validate({ sub: 'auth0|maya', [MFA_CLAIM]: true });
    expect(claims.mfa).toBe(true);
  });

  it('treats a missing or non-boolean claim as no MFA', () => {
    // Only a literal `true` from the signed token counts. A string "true" or
    // a truthy object must not open a second-key lock.
    expect(strategy.validate({ sub: 'auth0|maya' }).mfa).toBe(false);
    expect(strategy.validate({ sub: 'auth0|maya', [MFA_CLAIM]: 'true' }).mfa).toBe(false);
    expect(strategy.validate({ sub: 'auth0|maya', [MFA_CLAIM]: 1 }).mfa).toBe(false);
  });

  it('keeps the identity fields and falls back to nickname', () => {
    const claims = strategy.validate({
      sub: 'auth0|maya',
      nickname: 'maya',
      email: 'maya@example.com',
    });
    expect(claims.name).toBe('maya');
    expect(claims.email).toBe('maya@example.com');
  });
});
