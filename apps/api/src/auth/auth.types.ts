export interface AuthClaims {
  sub: string;
  email?: string;
  name?: string;
  nickname?: string;
  picture?: string;
  /**
   * True when the post-login Action stamped the access token with the
   * namespaced MFA claim (see MFA_CLAIM in @stashd/shared). Read by the lock
   * engine to refuse a double-sealed unlock on a plain token.
   */
  mfa?: boolean;
}
