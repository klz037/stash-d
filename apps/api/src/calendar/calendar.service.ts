import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarDto, CalendarEventDto } from '@stashd/shared';
import { CalendarConfig, readCalendarConfig } from './calendar.config';

const FEDERATED_GRANT =
  'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const FEDERATED_TOKEN_TYPE =
  'http://auth0.com/oauth/token-type/federated-connection-access-token';

const CACHE_MS = 10 * 60_000;
const LOOKAHEAD_DAYS = 14;

/**
 * Auth0 Token Vault → Google Calendar.
 *
 * Auth0 holds the user's Google refresh token from their Google sign-in. We
 * exchange the Auth0 access token this request came in on for a short-lived
 * Google access token, read the next two weeks of the primary calendar, and
 * return titles and times. Nothing about Google is stored here; the browser
 * never sees a Google credential. Same posture as Spotify, minus our own
 * token storage: Auth0 is the vault.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly config: CalendarConfig | null;
  private readonly cache = new Map<string, { at: number; value: CalendarDto }>();

  constructor(config: ConfigService) {
    this.config = readCalendarConfig(config);
  }

  get available(): boolean {
    return this.config !== null;
  }

  async forUser(userId: string, auth0AccessToken: string): Promise<CalendarDto> {
    if (!this.config) {
      return {
        status: { available: false, connected: false, reason: 'Token Vault is not configured.' },
        events: [],
      };
    }
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return hit.value;
    }
    const value = await this.load(this.config, auth0AccessToken);
    this.cache.set(userId, { at: Date.now(), value });
    return value;
  }

  private async load(config: CalendarConfig, subjectToken: string): Promise<CalendarDto> {
    const googleToken = await this.exchange(config, subjectToken);
    if (!googleToken.ok) {
      return {
        status: { available: true, connected: false, reason: googleToken.reason },
        events: [],
      };
    }
    try {
      const events = await this.fetchEvents(googleToken.token);
      return { status: { available: true, connected: true }, events };
    } catch (error) {
      this.logger.warn(`Google Calendar read failed: ${(error as Error).message}`);
      return {
        status: { available: true, connected: true, reason: 'Could not read the calendar.' },
        events: [],
      };
    }
  }

  /** The Token Vault access-token exchange. Backend only: it needs the API client's secret. */
  private async exchange(
    config: CalendarConfig,
    subjectToken: string,
  ): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    const body = new URLSearchParams({
      grant_type: FEDERATED_GRANT,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: FEDERATED_TOKEN_TYPE,
      connection: config.connection,
    });
    try {
      const res = await fetch(`https://${config.domain}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = (await res.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || !data.access_token) {
        const reason = data.error_description ?? data.error ?? `HTTP ${res.status}`;
        this.logger.debug(`Token Vault exchange refused: ${reason}`);
        return {
          ok: false,
          reason: /not found|no .*token|consent|scope/i.test(reason)
            ? 'Sign in with Google and allow calendar access to connect.'
            : reason,
        };
      }
      return { ok: true, token: data.access_token };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  private async fetchEvents(googleToken: string): Promise<CalendarEventDto[]> {
    const now = new Date();
    const max = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeMax', max.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '25');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${googleToken}` } });
    if (!res.ok) {
      throw new Error(`Google Calendar ${res.status}`);
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        status?: string;
        start?: { date?: string; dateTime?: string };
        end?: { date?: string; dateTime?: string };
      }>;
    };
    return (data.items ?? [])
      .filter((item) => item.status !== 'cancelled' && (item.start?.date || item.start?.dateTime))
      .map((item) => ({
        id: item.id ?? `${item.summary}-${item.start?.date ?? item.start?.dateTime}`,
        title: item.summary?.trim() || '(untitled)',
        start: (item.start?.dateTime ?? item.start?.date) as string,
        end: item.end?.dateTime ?? item.end?.date,
        allDay: Boolean(item.start?.date && !item.start?.dateTime),
      }));
  }
}
