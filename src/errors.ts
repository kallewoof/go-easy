/**
 * go-easy error hierarchy.
 *
 * All errors extend GoEasyError so callers can catch broadly
 * or narrowly as needed.
 */

export class GoEasyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GoEasyError';
  }

  /** Structured JSON for gateway output */
  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.cause instanceof Error ? { cause: this.cause.message } : {}),
    };
  }
}

/**
 * Auth error codes:
 *   AUTH_NO_ACCOUNT    — Account not configured at all
 *   AUTH_MISSING_SCOPE — Account exists but token lacks required scope
 *   AUTH_TOKEN_REVOKED — Refresh token was revoked (Google returned invalid_grant)
 *   AUTH_REFRESH_FAILED — Transient network error refreshing token
 *   AUTH_STORE_CORRUPT — accounts.json unreadable
 *   AUTH_NO_CREDENTIALS — credentials.json missing
 *   AUTH_PROTECTED     — Account exists but requires a passphrase (--pass)
 *   AUTH_PASS_WRONG    — Passphrase supplied but incorrect
 *   AUTH_ERROR         — Generic (legacy fallback)
 */
export type AuthErrorCode =
  | 'AUTH_NO_ACCOUNT'
  | 'AUTH_MISSING_SCOPE'
  | 'AUTH_TOKEN_REVOKED'
  | 'AUTH_REFRESH_FAILED'
  | 'AUTH_STORE_CORRUPT'
  | 'AUTH_NO_CREDENTIALS'
  | 'AUTH_PROTECTED'
  | 'AUTH_PASS_WRONG'
  | 'AUTH_ERROR';

/** OAuth2 token expired, missing, or invalid */
export class AuthError extends GoEasyError {
  /** Exact CLI command that fixes this error */
  public readonly fix?: string;

  constructor(message: string, cause?: unknown);
  constructor(code: AuthErrorCode, opts: { message: string; fix?: string; cause?: unknown });
  constructor(
    messageOrCode: string,
    causeOrOpts?: unknown
  ) {
    // Disambiguate: the opts form is a plain object with a `fix` key or
    // is NOT an Error instance. An Error passed as second arg is always the legacy cause form.
    if (
      typeof causeOrOpts === 'object' &&
      causeOrOpts !== null &&
      !(causeOrOpts instanceof Error) &&
      'message' in causeOrOpts
    ) {
      const opts = causeOrOpts as { message: string; fix?: string; cause?: unknown };
      super(opts.message, messageOrCode, opts.cause);
      this.fix = opts.fix;
    } else {
      super(messageOrCode, 'AUTH_ERROR', causeOrOpts);
    }
    this.name = 'AuthError';
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.fix ? { fix: this.fix } : {}),
    };
  }
}

/** Google API returned 404 */
export class NotFoundError extends GoEasyError {
  public readonly hint?: string;

  constructor(resource: string, id: string, cause?: unknown, hint?: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', cause);
    this.name = 'NotFoundError';
    this.hint = hint;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

/** Google API quota exceeded (429) */
export class QuotaError extends GoEasyError {
  constructor(service: string, cause?: unknown) {
    super(`Quota exceeded for ${service}`, 'QUOTA_EXCEEDED', cause);
    this.name = 'QuotaError';
  }
}

/** Operation blocked by safety checks */
export class SafetyError extends GoEasyError {
  constructor(operation: string) {
    super(
      `Destructive operation "${operation}" blocked — no confirmation provided`,
      'SAFETY_BLOCKED'
    );
    this.name = 'SafetyError';
  }
}

/** Calendar access denied by the passphrase's deny list */
export class AccessDeniedError extends GoEasyError {
  constructor(calendarIds: string[]) {
    super(
      `Access denied: calendar(s) ${calendarIds.join(', ')} are restricted for this passphrase`,
      'ACCESS_DENIED'
    );
    this.name = 'AccessDeniedError';
  }
}
