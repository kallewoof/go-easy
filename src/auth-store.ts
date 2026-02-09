/**
 * Auth store — manages the ~/.go-easy/ token store.
 *
 * Responsibilities:
 *   - Read/write accounts.json (v1 schema, atomic writes)
 *   - Migrate from legacy CLI stores (~/.gmcli, ~/.gdcli, ~/.gccli)
 *   - File permissions (0o700 dir, 0o600 files)
 *   - Provide typed account/token resolution
 *
 * Does NOT handle OAuth flows — that's auth-flow.ts (Phase 2).
 */

import { readFile, writeFile, rename, mkdir, chmod, access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SCOPES } from './scopes.js';

// ─── Types ─────────────────────────────────────────────────

export type GoogleService = 'gmail' | 'drive' | 'calendar';

export interface OAuthToken {
  refreshToken: string;
  scopes: string[];
  grantedAt: string;
}

export interface GoEasyAccount {
  email: string;
  tokens: {
    combined?: OAuthToken;
    gmail?: OAuthToken;
    drive?: OAuthToken;
    calendar?: OAuthToken;
  };
  addedAt: string;
  migratedFrom?: string[];
}

export interface AccountStore {
  version: 1;
  accounts: GoEasyAccount[];
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/** Shape of a legacy CLI account entry */
interface LegacyAccountEntry {
  email: string;
  oauth2: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

// ─── Paths ─────────────────────────────────────────────────

const GO_EASY_DIR = join(homedir(), '.go-easy');
const ACCOUNTS_FILE = join(GO_EASY_DIR, 'accounts.json');
const CREDENTIALS_FILE = join(GO_EASY_DIR, 'credentials.json');
const PENDING_DIR = join(GO_EASY_DIR, 'pending');

/** Legacy CLI config dirs */
const LEGACY_DIRS: Record<GoogleService, string> = {
  gmail: '.gmcli',
  drive: '.gdcli',
  calendar: '.gccli',
};

// ─── Public API ────────────────────────────────────────────

/** Get the go-easy config directory path */
export function getConfigDir(): string {
  return GO_EASY_DIR;
}

/** Get the pending auth directory path */
export function getPendingDir(): string {
  return PENDING_DIR;
}

/**
 * Read the account store. Returns null if it doesn't exist.
 */
export async function readAccountStore(): Promise<AccountStore | null> {
  try {
    const raw = await readFile(ACCOUNTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      return null;
    }
    return parsed as AccountStore;
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/**
 * Write the account store atomically.
 * Creates ~/.go-easy/ if needed with correct permissions.
 */
export async function writeAccountStore(store: AccountStore): Promise<void> {
  await ensureConfigDir();
  const tmpFile = ACCOUNTS_FILE + '.tmp';
  await writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
  await safeChmod(tmpFile, 0o600);
  await rename(tmpFile, ACCOUNTS_FILE);
}

/**
 * Read OAuth credentials (clientId + clientSecret).
 * Returns null if credentials.json doesn't exist.
 */
export async function readCredentials(): Promise<OAuthCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed?.clientId || !parsed?.clientSecret) return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/**
 * Write OAuth credentials.
 */
export async function writeCredentials(creds: OAuthCredentials): Promise<void> {
  await ensureConfigDir();
  const tmpFile = CREDENTIALS_FILE + '.tmp';
  await writeFile(tmpFile, JSON.stringify(creds, null, 2), 'utf-8');
  await safeChmod(tmpFile, 0o600);
  await rename(tmpFile, CREDENTIALS_FILE);
}

/**
 * Find an account in the store by email (case-insensitive).
 * If no email given, returns the first account.
 */
export function findAccount(
  store: AccountStore,
  email?: string
): GoEasyAccount | undefined {
  if (!email) return store.accounts[0];
  const normalized = email.trim().toLowerCase();
  return store.accounts.find(
    (a) => a.email.toLowerCase() === normalized
  );
}

/**
 * Resolve the token for a specific service from an account.
 * Returns the refreshToken + clientId/clientSecret ready to use.
 *
 * Priority: combined (if it has the scope) > per-service token.
 */
export function resolveToken(
  account: GoEasyAccount,
  service: GoogleService
): { refreshToken: string; scopes: string[] } | null {
  const neededScope = SCOPES[service];

  // 1. Try combined token
  if (account.tokens.combined) {
    if (account.tokens.combined.scopes.includes(neededScope)) {
      return {
        refreshToken: account.tokens.combined.refreshToken,
        scopes: account.tokens.combined.scopes,
      };
    }
    // Combined exists but lacks this scope — don't fall through to per-service
    // if per-service tokens were deleted after upgrade. Return null.
  }

  // 2. Try per-service token
  const serviceToken = account.tokens[service];
  if (serviceToken) {
    return {
      refreshToken: serviceToken.refreshToken,
      scopes: serviceToken.scopes,
    };
  }

  return null;
}

/**
 * Upsert an account in the store. Merges tokens if account exists.
 */
export function upsertAccount(
  store: AccountStore,
  account: GoEasyAccount
): AccountStore {
  const idx = store.accounts.findIndex(
    (a) => a.email.toLowerCase() === account.email.toLowerCase()
  );
  if (idx >= 0) {
    // Merge tokens
    const existing = store.accounts[idx];
    store.accounts[idx] = {
      ...existing,
      tokens: { ...existing.tokens, ...account.tokens },
    };
  } else {
    store.accounts.push(account);
  }
  return store;
}

/**
 * Remove an account from the store by email.
 * Returns true if found and removed.
 */
export function removeAccount(store: AccountStore, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const idx = store.accounts.findIndex(
    (a) => a.email.toLowerCase() === normalized
  );
  if (idx < 0) return false;
  store.accounts.splice(idx, 1);
  return true;
}

// ─── Migration ─────────────────────────────────────────────

export interface MigrationResult {
  migrated: boolean;
  accounts: Array<{ email: string; services: GoogleService[] }>;
  warnings: string[];
}

/**
 * Migrate from legacy CLI stores to the new unified store.
 *
 * Rules:
 *   - Reads ~/.gmcli/, ~/.gdcli/, ~/.gccli/ accounts.json files
 *   - Merges by email (normalized to lowercase)
 *   - Copies credentials.json if not already present
 *   - Never modifies legacy files
 *   - If one legacy store fails, imports what it can + warns
 *   - Returns what was migrated
 */
export async function migrateFromLegacy(): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: false, accounts: [], warnings: [] };

  // Read all legacy stores
  const legacyData = new Map<GoogleService, LegacyAccountEntry[]>();
  const legacyCreds: OAuthCredentials[] = [];

  for (const [service, dirName] of Object.entries(LEGACY_DIRS) as [GoogleService, string][]) {
    const dir = join(homedir(), dirName);
    try {
      const raw = await readFile(join(dir, 'accounts.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        result.warnings.push(`${dirName}/accounts.json: not an array, skipping`);
        continue;
      }
      // Validate entries
      const valid = parsed.filter(
        (e: unknown): e is LegacyAccountEntry =>
          typeof e === 'object' && e !== null &&
          typeof (e as LegacyAccountEntry).email === 'string' &&
          typeof (e as LegacyAccountEntry).oauth2?.refreshToken === 'string'
      );
      if (valid.length === 0) {
        result.warnings.push(`${dirName}/accounts.json: no valid accounts found`);
        continue;
      }
      legacyData.set(service, valid);

      // Collect credentials
      if (valid[0]?.oauth2?.clientId) {
        legacyCreds.push({
          clientId: valid[0].oauth2.clientId,
          clientSecret: valid[0].oauth2.clientSecret,
        });
      }
    } catch (err: unknown) {
      if (isEnoent(err)) {
        // Legacy dir doesn't exist — not a warning, just skip
        continue;
      }
      result.warnings.push(`${dirName}/accounts.json: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Also try to read credentials.json from legacy dir
    try {
      const credRaw = await readFile(join(dir, 'credentials.json'), 'utf-8');
      const cred = JSON.parse(credRaw);
      if (cred?.clientId && cred?.clientSecret) {
        legacyCreds.push({ clientId: cred.clientId, clientSecret: cred.clientSecret });
      }
    } catch {
      // Credentials file missing — not critical
    }
  }

  if (legacyData.size === 0) {
    return result;
  }

  // Verify all credentials share the same clientId
  const clientIds = new Set(legacyCreds.map((c) => c.clientId));
  if (clientIds.size > 1) {
    result.warnings.push(
      `Legacy stores use different OAuth clients (${[...clientIds].join(', ')}). ` +
      `Migration will use the first one found. Tokens from other clients may not work.`
    );
  }

  // Write credentials.json if we don't have one
  const existingCreds = await readCredentials();
  if (!existingCreds && legacyCreds.length > 0) {
    await writeCredentials(legacyCreds[0]);
  }

  // Build unified store
  let store = await readAccountStore() ?? { version: 1 as const, accounts: [] };
  const accountServiceMap = new Map<string, Set<GoogleService>>();

  for (const [service, entries] of legacyData) {
    for (const entry of entries) {
      const email = entry.email.trim().toLowerCase();
      const now = new Date().toISOString();

      const token: OAuthToken = {
        refreshToken: entry.oauth2.refreshToken,
        scopes: [SCOPES[service]],
        grantedAt: now, // We don't know the real date
      };

      const newAccount: GoEasyAccount = {
        email,
        tokens: { [service]: token },
        addedAt: now,
        migratedFrom: [LEGACY_DIRS[service].replace('.', '')],
      };

      store = upsertAccount(store, newAccount);

      // Also track migratedFrom on existing accounts
      const existing = findAccount(store, email);
      if (existing && existing.migratedFrom) {
        const source = LEGACY_DIRS[service].replace('.', '');
        if (!existing.migratedFrom.includes(source)) {
          existing.migratedFrom.push(source);
        }
      }

      // Track for result
      if (!accountServiceMap.has(email)) {
        accountServiceMap.set(email, new Set());
      }
      accountServiceMap.get(email)!.add(service);
    }
  }

  await writeAccountStore(store);
  result.migrated = true;

  for (const [email, services] of accountServiceMap) {
    result.accounts.push({ email, services: [...services] });
  }

  return result;
}

/**
 * Check if legacy stores exist (quick check for whether migration is needed).
 */
export async function hasLegacyStores(): Promise<boolean> {
  for (const dirName of Object.values(LEGACY_DIRS)) {
    try {
      await access(join(homedir(), dirName, 'accounts.json'), constants.R_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ─── Internal helpers ──────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
  try {
    await mkdir(GO_EASY_DIR, { recursive: true });
    await safeChmod(GO_EASY_DIR, 0o700);
  } catch {
    // Directory already exists
  }
  try {
    await mkdir(PENDING_DIR, { recursive: true });
  } catch {
    // Already exists
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}

/** chmod that doesn't throw on Windows (NTFS ACLs ≠ POSIX) */
async function safeChmod(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch {
    // Windows may not support POSIX chmod — best-effort
  }
}
