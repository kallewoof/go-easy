/**
 * Canonical OAuth scope definitions for go-easy.
 *
 * When a new Google service is added (e.g., Tasks), add its scope here.
 * getAuth() checks the token's granted scopes against these.
 */

import type { GoogleService } from './auth-store.js';

/** Scope URL per service */
export const SCOPES: Record<GoogleService, string> = {
  gmail: 'https://mail.google.com/',
  drive: 'https://www.googleapis.com/auth/drive',
  calendar: 'https://www.googleapis.com/auth/calendar',
  tasks: 'https://www.googleapis.com/auth/tasks',
} as const;

/** All scopes — requested by default during auth */
export const ALL_SCOPES = Object.values(SCOPES);

/** Map a scope URL back to a service name (for display) */
export function scopeToService(scope: string): GoogleService | undefined {
  for (const [svc, url] of Object.entries(SCOPES)) {
    if (url === scope) return svc as GoogleService;
  }
  return undefined;
}

/** Map service names to scope URLs */
export function servicesToScopes(services: GoogleService[]): string[] {
  return services.map((s) => SCOPES[s]);
}
