/**
 * Auth module — OAuth2 client factory with multi-account support.
 *
 * Reads tokens from the unified store at ~/.go-easy/accounts.json.
 * Falls back to legacy CLI stores (~/.gmcli, ~/.gdcli, ~/.gccli) via migration.
 *
 * Token resolution per account:
 *   1. combined token (if it has the needed scope) → use it
 *   2. per-service token (legacy migration) → use it
 *   3. neither → AUTH_MISSING_SCOPE with fix command
 */

import { OAuth2Client } from 'google-auth-library';
import { AuthError } from './errors.js';
import {
  readAccountStore,
  readCredentials,
  findAccount,
  resolveToken,
} from './auth-store.js';
import type { GoogleService, AccountStore } from './auth-store.js';
export type { GoogleService } from './auth-store.js';

/** Cache: "service:email" → OAuth2Client */
const clientCache = new Map<string, OAuth2Client>();

/**
 * Get an OAuth2Client for a specific service and account.
 *
 * @param service - Which Google service (determines scope check)
 * @param account - Email address (defaults to first account in the store)
 * @returns Configured OAuth2Client with refresh token set
 * @throws AuthError with specific code and fix command
 *
 * @example
 * ```ts
 * import { getAuth } from '@marcfargas/go-easy/auth';
 * const auth = await getAuth('gmail', 'marc@blegal.eu');
 * ```
 */
export async function getAuth(
  service: GoogleService,
  account?: string
): Promise<OAuth2Client> {
  // Try to load the store
  let store = await readAccountStore();

  if (!store) {
    throw new AuthError('AUTH_NO_ACCOUNT', {
      message: account
        ? `Account "${account}" not configured`
        : 'No accounts configured',
      fix: account
        ? `npx go-easy auth add ${account}`
        : 'npx go-easy auth add <email>',
    });
  }

  // Find the account
  const entry = findAccount(store, account);
  if (!entry) {
    const available = store.accounts.map((a) => a.email).join(', ');
    throw new AuthError('AUTH_NO_ACCOUNT', {
      message: account
        ? `Account "${account}" not found. Available: ${available}`
        : 'No accounts configured',
      fix: account
        ? `npx go-easy auth add ${account}`
        : 'npx go-easy auth add <email>',
    });
  }

  // Check cache
  const cacheKey = `${service}:${entry.email}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  // Resolve token for the requested service
  const token = resolveToken(entry, service);
  if (!token) {
    throw new AuthError('AUTH_MISSING_SCOPE', {
      message: `No ${service} token for ${entry.email}`,
      fix: `npx go-easy auth add ${entry.email}`,
    });
  }

  // Load credentials
  const creds = await readCredentials();
  if (!creds) {
    throw new AuthError('AUTH_NO_CREDENTIALS', {
      message: 'OAuth client credentials not found at ~/.go-easy/credentials.json',
      fix: 'npx go-easy auth add <email>',
    });
  }

  // Build OAuth2Client
  const oauth2 = new OAuth2Client(creds.clientId, creds.clientSecret);
  oauth2.setCredentials({ refresh_token: token.refreshToken });

  clientCache.set(cacheKey, oauth2);
  return oauth2;
}

/**
 * List available accounts (emails) for a service.
 * Only returns accounts that have a token for the given service.
 */
export async function listAccounts(service: GoogleService): Promise<string[]> {
  const store = await readAccountStore();
  if (!store) return [];
  return store.accounts
    .filter((a) => resolveToken(a, service) !== null)
    .map((a) => a.email);
}

/**
 * List all accounts regardless of service.
 */
export async function listAllAccounts(): Promise<
  Array<{ email: string; scopes: string[]; source: string }>
> {
  const store = await readAccountStore();
  if (!store) return [];
  return store.accounts.map((a) => {
    if (a.tokens.combined) {
      return {
        email: a.email,
        scopes: a.tokens.combined.scopes,
        source: 'combined',
      };
    }
    // Collect scopes from per-service tokens
    const scopes: string[] = [];
    for (const svc of ['gmail', 'drive', 'calendar'] as const) {
      const t = a.tokens[svc];
      if (t) scopes.push(...t.scopes);
    }
    return {
      email: a.email,
      scopes,
      source: 'legacy',
    };
  });
}

/**
 * Clear the client cache. Useful for tests or token rotation.
 */
export function clearAuthCache(): void {
  clientCache.clear();
}


