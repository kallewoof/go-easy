/**
 * Auth module — OAuth2 client factory with multi-account support.
 *
 * Reads tokens from the unified store at ~/.config/go-easy/accounts.json.
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
  readAllCredentials,
  findAccount,
  resolveToken,
  filterAccountsByPass,
  getCalendarDenyList as storeGetCalendarDenyList,
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
 * import { getAuth } from 'go-easy/auth';
 * const auth = await getAuth('gmail', 'marc@blegal.eu');
 * ```
 */
export async function getAuth(
  service: GoogleService,
  account?: string,
  pass?: string
): Promise<OAuth2Client> {
  // Try to load the store
  const rawStore = await readAccountStore();

  if (!rawStore) {
    throw new AuthError('AUTH_NO_ACCOUNT', {
      message: account
        ? `Account "${account}" not configured`
        : 'No accounts configured',
      fix: account
        ? `npx go-easy auth add ${account}`
        : 'npx go-easy auth add <email>',
    });
  }

  // Filter to accounts visible with the supplied pass (or no pass for unprotected)
  const store = filterAccountsByPass(rawStore, pass ? [pass] : []);

  // Find the account
  const entry = findAccount(store, account);
  if (!entry) {
    // Account exists but was hidden by the pass filter — give a targeted error
    if (account && findAccount(rawStore, account)) {
      if (pass) {
        throw new AuthError('AUTH_PASS_WRONG', {
          message: `Passphrase for "${account}" is incorrect.`,
        });
      }
      throw new AuthError('AUTH_PROTECTED', {
        message: `Account "${account}" is passphrase-protected. Add --pass <phrase> to your command.`,
        fix: `go-easy auth list --pass <phrase>`,
      });
    }
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

  // Load credentials — match by clientId stored on the account, fall back to first entry
  const allCreds = await readAllCredentials();
  const creds = (entry.clientId && allCreds.find((c) => c.clientId === entry.clientId))
    || allCreds[0]
    || null;
  if (!creds) {
    throw new AuthError('AUTH_NO_CREDENTIALS', {
      message: 'OAuth client credentials not found at ~/.config/go-easy/credentials.json',
      fix: 'npx go-easy credentials set <path-to-credentials.json>',
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
export async function listAccounts(service: GoogleService, pass?: string): Promise<string[]> {
  const rawStore = await readAccountStore();
  if (!rawStore) return [];
  const store = filterAccountsByPass(rawStore, pass ? [pass] : []);
  return store.accounts
    .filter((a) => resolveToken(a, service) !== null)
    .map((a) => a.email);
}

/**
 * List all accounts regardless of service.
 */
export async function listAllAccounts(passes: string[] = []): Promise<
  Array<{ email: string; scopes: string[]; source: string; passProtected: boolean }>
> {
  const rawStore = await readAccountStore();
  if (!rawStore) return [];
  const store = filterAccountsByPass(rawStore, passes);
  return store.accounts.map((a) => {
    if (a.tokens.combined) {
      return {
        email: a.email,
        scopes: a.tokens.combined.scopes,
        source: 'combined',
        passProtected: !!a.passHash,
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
      passProtected: !!a.passHash,
    };
  });
}

/**
 * Clear the client cache. Useful for tests or token rotation.
 */
export function clearAuthCache(): void {
  clientCache.clear();
}

/**
 * Return the calendar deny list for the active passphrase on an account.
 *
 * Used by the calendar CLI after getAuth() to enforce per-pass calendar restrictions.
 * Returns [] when no pass is supplied, the account is not found, or the pass has no deny list.
 */
export async function getCalendarDenyList(
  accountEmail: string | undefined,
  pass: string | undefined
): Promise<string[]> {
  if (!pass) return [];
  const rawStore = await readAccountStore();
  if (!rawStore) return [];
  const account = findAccount(rawStore, accountEmail);
  if (!account) return [];
  return storeGetCalendarDenyList(account, pass);
}


