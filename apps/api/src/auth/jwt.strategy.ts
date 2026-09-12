import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { MFA_CLAIM } from '@stashd/shared';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthClaims } from './auth.types';
import { readAuth0Config } from './auth0.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    // Throws at construction — a misconfigured API fails to boot rather than
    // silently skipping audience validation. See auth0.config.ts.
    const auth0 = readAuth0Config(config);

    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: auth0.jwksUri,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: auth0.audience,
      issuer: auth0.issuer,
      algorithms: ['RS256'],
    });
  }

  validate(payload: AuthClaims & Record<string, unknown>): AuthClaims {
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.nickname,
      picture: payload.picture,
      // Only the signed token can say this. The Action sets it after MFA ran.
      mfa: payload[MFA_CLAIM] === true,
    };
  }
}
