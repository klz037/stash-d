import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { CalendarDto } from '@stashd/shared';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from '../users/schemas/user.schema';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  /**
   * The caller's next two weeks, read from Google through Auth0 Token Vault.
   * The bearer token on this request is the subject token for the exchange,
   * so the same credential that proved who they are is what unlocks their
   * calendar. No second sign-in, no stored Google secret.
   */
  @Get()
  calendar(@CurrentUser() user: UserDocument, @Req() req: Request): Promise<CalendarDto> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    return this.calendarService.forUser(user._id, token);
  }
}
