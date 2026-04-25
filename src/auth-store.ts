/**
 * Auth store — manages the ~/.config/go-easy/ token store.
 *
 * Responsibilities:
 *   - Read/write accounts.json (v1 schema, atomic writes)
 *   - File permissions (0o700 dir, 0o600 files)
 *   - Provide typed account/token resolution
 *
 * Does NOT handle OAuth flows — that's auth-flow.ts (Phase 2).
 */

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { SCOPES } from './scopes.js';

// ─── Types ─────────────────────────────────────────────────

export type GoogleService = 'gmail' | 'drive' | 'calendar' | 'tasks' | 'sheets';

export interface OAuthToken {
  refreshToken: string;
  scopes: string[];
  grantedAt: string;
}

/** A single passphrase entry with optional per-service access restrictions. */
export interface PassEntry {
  hash: string;
  calendarDeny?: string[];
}

export interface GoEasyAccount {
  email: string;
  clientId?: string;
  /** @deprecated Use passes[] for new accounts. Kept for backward compatibility. */
  passHash?: string;
  /** Multi-pass entries. Each pass independently unlocks the account and can carry its own restrictions. */
  passes?: PassEntry[];
  tokens: {
    combined?: OAuthToken;
    gmail?: OAuthToken;
    drive?: OAuthToken;
    calendar?: OAuthToken;
    tasks?: OAuthToken;
    sheets?: OAuthToken;
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

export interface OAuthCredentialsEntry extends OAuthCredentials {
  name?: string;
}

// ─── Paths ─────────────────────────────────────────────────

function platformConfigBase(): string {
  const home = homedir();
  const os = platform();
  if (os === 'win32') return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'go-easy');
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'go-easy');
  return join(process.env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'go-easy');
}

function resolveConfigDir(): string {
  if (process.env['GO_EASY_DIR']) return process.env['GO_EASY_DIR'];
  const legacy = join(homedir(), '.go-easy');
  const modern = platformConfigBase();
  if (existsSync(legacy) && !existsSync(modern)) {
    try {
      renameSync(legacy, modern);
      process.stderr.write(`go-easy: config directory migrated from ${legacy} to ${modern}\n`);
      return modern;
    } catch {
      // Cross-device rename (rare); fall back to legacy rather than failing.
      return legacy;
    }
  }
  return modern;
}

const GO_EASY_DIR = resolveConfigDir();
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
 * Creates ~/.config/go-easy/ if needed with correct permissions.
 */
export async function writeAccountStore(store: AccountStore): Promise<void> {
  await ensureConfigDir();
  const tmpFile = ACCOUNTS_FILE + '.tmp';
  await writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
  await safeChmod(tmpFile, 0o600);
  await rename(tmpFile, ACCOUNTS_FILE);
}

/**
 * Parse a credentials object (Google-emitted or our format) into OAuthCredentials.
 * Returns null if the object doesn't contain valid credentials.
 */
function parseCredentialsObject(obj: unknown): OAuthCredentials | null {
  const o = obj as Record<string, unknown>;
  const inner = (o?.installed ?? o?.web ?? o) as Record<string, unknown>;
  const clientId = (inner?.client_id ?? inner?.clientId) as string | undefined;
  const clientSecret = (inner?.client_secret ?? inner?.clientSecret) as string | undefined;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Read OAuth credentials (clientId + clientSecret).
 * Returns the first entry if credentials.json contains multiple entries.
 * Returns null if credentials.json doesn't exist or is empty.
 *
 * Pass a selector to pick a specific entry: a name string or a numeric index string.
 */
export async function readCredentials(selector?: string): Promise<OAuthCredentialsEntry | null> {
  const entries = await readAllCredentials();
  if (!selector) return entries[0] ?? null;
  const idx = Number(selector);
  if (!isNaN(idx)) return entries[idx] ?? null;
  return entries.find((e) => e.name === selector) ?? null;
}

/**
 * Read all OAuth credential entries from credentials.json.
 * Handles both single-object and array formats.
 */
export async function readAllCredentials(): Promise<OAuthCredentialsEntry[]> {
  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => {
        const creds = parseCredentialsObject(item);
        if (!creds) return [];
        return [{ ...creds, name: (item as Record<string, unknown>).name as string | undefined }];
      });
    }
    const creds = parseCredentialsObject(parsed);
    return creds ? [creds] : [];
  } catch (err: unknown) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/**
 * Write a single set of OAuth credentials, replacing any existing credentials.
 */
export async function writeCredentials(creds: OAuthCredentials): Promise<void> {
  await writeAllCredentials([creds]);
}

/**
 * Write all credential entries to credentials.json (atomic).
 */
export async function writeAllCredentials(entries: OAuthCredentialsEntry[]): Promise<void> {
  await ensureConfigDir();
  const tmpFile = CREDENTIALS_FILE + '.tmp';
  const data = entries.length === 1 ? entries[0] : entries;
  await writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  await safeChmod(tmpFile, 0o600);
  await rename(tmpFile, CREDENTIALS_FILE);
}

/**
 * Import credentials from a file path (Google-format or our format).
 * Replaces any existing credentials.
 */
export async function importCredentials(filePath: string): Promise<OAuthCredentialsEntry> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const creds = parseCredentialsObject(parsed);
  if (!creds) throw new Error('File does not contain valid OAuth credentials (client_id + client_secret)');
  await writeAllCredentials([creds]);
  return creds;
}

/**
 * Append credentials from a file path to the existing credentials.json.
 * Replaces an existing entry with the same name (if name is given).
 */
export async function appendCredentials(filePath: string, name?: string): Promise<OAuthCredentialsEntry> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const creds = parseCredentialsObject(parsed);
  if (!creds) throw new Error('File does not contain valid OAuth credentials (client_id + client_secret)');
  const entry: OAuthCredentialsEntry = { ...creds, ...(name ? { name } : {}) };
  const existing = await readAllCredentials();
  const filtered = name
    ? existing.filter((e) => e.name !== name)
    : existing.filter((e) => e.clientId !== creds.clientId);
  await writeAllCredentials([...filtered, entry]);
  return entry;
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
 * Hash a passphrase for storage (SHA-256 hex).
 * Passphrases are capability tokens, not passwords — no salt needed.
 */
export function hashPass(pass: string): string {
  return createHash('sha256').update(pass).digest('hex');
}

/**
 * Return a store containing only accounts visible to the given passphrases.
 *
 * An account is unprotected (always visible) if it has neither passHash nor passes[].
 * A protected account is visible when any supplied pass matches its passHash or any passes[] entry.
 */
export function filterAccountsByPass(store: AccountStore, passes: string[]): AccountStore {
  const hashed = passes.map(hashPass);
  return {
    ...store,
    accounts: store.accounts.filter((a) => {
      const isProtected = !!(a.passHash || a.passes?.length);
      if (!isProtected) return true;
      if (a.passHash && hashed.includes(a.passHash)) return true;
      return a.passes?.some((p) => hashed.includes(p.hash)) ?? false;
    }),
  };
}

/**
 * Find the PassEntry for a given plaintext passphrase.
 * Checks passHash first (takes precedence — unconditional access, no calendar restrictions),
 * then falls back to passes[].
 * Returns null if no match is found.
 *
 * passHash always wins over a same-hash passes[] entry so that a legacy admin pass
 * can never be accidentally restricted by a calendarDeny migration.
 */
export function findPassEntry(account: GoEasyAccount, pass: string): PassEntry | null {
  const h = hashPass(pass);
  if (account.passHash === h) return { hash: h };
  return account.passes?.find((p) => p.hash === h) ?? null;
}

/**
 * Return the calendar deny list for the given plaintext passphrase.
 * Returns [] if the pass is not found or has no deny list configured.
 */
export function getCalendarDenyList(account: GoEasyAccount, pass: string): string[] {
  return findPassEntry(account, pass)?.calendarDeny ?? [];
}

/**
 * Add a new pass entry to passes[]. Returns the entry (existing or newly created).
 * Idempotent: if the hash already exists in passes[], the existing entry is returned unchanged.
 */
export function addPassEntry(account: GoEasyAccount, pass: string): PassEntry {
  const h = hashPass(pass);
  if (!account.passes) account.passes = [];
  const existing = account.passes.find((p) => p.hash === h);
  if (existing) return existing;
  const entry: PassEntry = { hash: h };
  account.passes.push(entry);
  return entry;
}

/**
 * Remove the passes[] entry (or legacy passHash) matching the given plaintext passphrase.
 * Returns true if an entry was removed, false if not found.
 */
export function removePassEntry(account: GoEasyAccount, pass: string): boolean {
  const h = hashPass(pass);
  const before = account.passes?.length ?? 0;
  account.passes = account.passes?.filter((p) => p.hash !== h) ?? [];
  if (account.passes.length < before) return true;
  if (account.passHash === h) {
    delete account.passHash;
    return true;
  }
  return false;
}

/**
 * Add a calendar ID to the deny list for the given passphrase.
 * Returns false if the pass entry does not exist in passes[] (legacy passHash entries
 * cannot carry a deny list — use pass-add first to migrate).
 * Idempotent: adding an already-denied calendar ID has no effect.
 */
export function addCalendarDeny(account: GoEasyAccount, pass: string, calendarId: string): boolean {
  const h = hashPass(pass);
  const entry = account.passes?.find((p) => p.hash === h);
  if (!entry) return false;
  if (!entry.calendarDeny) entry.calendarDeny = [];
  if (!entry.calendarDeny.includes(calendarId)) entry.calendarDeny.push(calendarId);
  return true;
}

/**
 * Remove a calendar ID from the deny list for the given passphrase.
 * Returns false if the pass entry or calendar ID was not found.
 */
export function removeCalendarDeny(account: GoEasyAccount, pass: string, calendarId: string): boolean {
  const h = hashPass(pass);
  const entry = account.passes?.find((p) => p.hash === h);
  if (!entry?.calendarDeny) return false;
  const before = entry.calendarDeny.length;
  entry.calendarDeny = entry.calendarDeny.filter((id) => id !== calendarId);
  return entry.calendarDeny.length < before;
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
