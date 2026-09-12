import { ConfigService } from '@nestjs/config';
import { readAuth0Config } from '../auth/auth0.config';

export interface CalendarConfig {
  /** Tenant domain, from the same Auth0 settings the JWT guard uses. */
  domain: string;
  /** The Custom API Client Auth0 issues for Token Vault exchanges. */
  clientId: string;
  clientSecret: string;
  /** The connection whose token we ask for. Google by default. */
  connection: string;
}

/**
 * Token Vault credentials. Optional, like Spotify: without them the calendar
 * simply reports "unavailable" and nothing else in the app changes. This is a
 * real Auth0-issued client credential for the API, never a fake placeholder,
 * and it never reaches the browser.
 */
export function readCalendarConfig(config: ConfigService): CalendarConfig | null {
  const clientId = (config.get<string>('AUTH0_TOKEN_VAULT_CLIENT_ID', '') ?? '').trim();
  const clientSecret = (
    config.get<string>('AUTH0_TOKEN_VAULT_CLIENT_SECRET', '') ?? ''
  ).trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  const connection = (
    config.get<string>('AUTH0_CALENDAR_CONNECTION', 'google-oauth2') ?? 'google-oauth2'
  ).trim();
  return { domain: readAuth0Config(config).domain, clientId, clientSecret, connection };
}
