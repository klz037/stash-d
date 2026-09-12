import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserDocument } from '../users/schemas/user.schema';
import { AuthClaims } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserDocument => {
    const request = ctx.switchToHttp().getRequest<{ dbUser: UserDocument }>();
    return request.dbUser;
  },
);

/** The verified token claims for this request, as JwtStrategy.validate shaped them. */
export const CurrentClaims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthClaims => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthClaims }>();
    return request.user;
  },
);
