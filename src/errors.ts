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

/** OAuth2 token expired, missing, or invalid */
export class AuthError extends GoEasyError {
  constructor(message: string, cause?: unknown) {
    super(message, 'AUTH_ERROR', cause);
    this.name = 'AuthError';
  }
}

/** Google API returned 404 */
export class NotFoundError extends GoEasyError {
  constructor(resource: string, id: string, cause?: unknown) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', cause);
    this.name = 'NotFoundError';
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
