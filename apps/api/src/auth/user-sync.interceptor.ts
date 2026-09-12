import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { UsersService } from '../users/users.service';
import { AuthClaims } from './auth.types';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class UserSyncInterceptor implements NestInterceptor {
  constructor(private readonly usersService: UsersService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthClaims;
      dbUser?: UserDocument;
    }>();

    if (!request.user?.sub) {
      return next.handle();
    }

    return from(this.usersService.getOrCreate(request.user)).pipe(
      switchMap((user) => {
        request.dbUser = user;
        return next.handle();
      }),
    );
  }
}
