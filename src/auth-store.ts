/**
 * Auth store — manages the ~/.go-easy/ token store.
 *
 * Responsibilities:
 *   - Read/write accounts.json (v1 schema, atomic writes)
 *   - File permissions (0o700 dir, 0o600 files)
 *   - Provide typed account/token resolution
 *
 * Does NOT handle OAuth flows — that's auth-flow.ts (Phase 2).
 */

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SCOPES } from './scopes.js';

// ─── Types ─────────────────────────────────────────────────

export type GoogleService = 'gmail' | 'drive' | 'calendar' | 'tasks';

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
    tasks?: OAuthToken;
  };
  addedAt: string;
}

export interface AccountStore {
  version: 1;
  accounts: GoEasyAccount[];
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

// ─── Paths ─────────────────────────────────────────────────

const GO_EASY_DIR = join(homedir(), '.go-easy');
const ACCOUNTS_FILE = join(GO_EASY_DIR, 'accounts.json');
const CREDENTIALS_FILE = join(GO_EASY_DIR, 'credentials.json');
const PENDING_DIR = join(GO_EASY_DIR, 'pending');

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
    // Support Google-emitted format: {"installed":{"client_id":...,"client_secret":...}}
    const inner = parsed?.installed ?? parsed?.web ?? parsed;
    const clientId = inner?.client_id ?? inner?.clientId;
    const clientSecret = inner?.client_secret ?? inner?.clientSecret;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
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
    // (per-service tokens are deleted after upgrade per D1)
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
