import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthClaims } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const domain = config.get<string>('AUTH0_DOMAIN', '');
    const audience = config.get<string>('AUTH0_AUDIENCE', '');
    const issuer = domain ? `https://${domain}/` : undefined;

    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: domain
          ? `https://${domain}/.well-known/jwks.json`
          : 'https://example.invalid/.well-known/jwks.json',
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: audience || undefined,
      issuer,
      algorithms: ['RS256'],
    });
  }

  validate(payload: AuthClaims): AuthClaims {
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.nickname,
      picture: payload.picture,
    };
  }
}
