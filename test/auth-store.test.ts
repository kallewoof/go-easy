import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockRename = vi.fn();
const mockMkdir = vi.fn();
const mockChmod = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}));

import {
  readAccountStore,
  writeAccountStore,
  readCredentials,
  writeCredentials,
  findAccount,
  resolveToken,
  upsertAccount,
  removeAccount,
  hashPass,
  filterAccountsByPass,
  findPassEntry,
  getCalendarDenyList,
  addPassEntry,
  removePassEntry,
  addCalendarDeny,
  removeCalendarDeny,
} from '../src/auth-store.js';
import type { AccountStore, GoEasyAccount } from '../src/auth-store.js';

// ─── Fixtures ──────────────────────────────────────────────

const makeStore = (accounts: GoEasyAccount[] = []): AccountStore => ({
  version: 1,
  accounts,
});

const aliceAccount: GoEasyAccount = {
  email: 'alice@example.com',
  tokens: {
    gmail: {
      refreshToken: 'rt-alice-gmail',
      scopes: ['https://mail.google.com/'],
      grantedAt: '2026-01-01T00:00:00Z',
    },
    drive: {
      refreshToken: 'rt-alice-drive',
      scopes: ['https://www.googleapis.com/auth/drive'],
      grantedAt: '2026-01-01T00:00:00Z',
    },
  },
  addedAt: '2026-01-01T00:00:00Z',
};

const aliceCombined: GoEasyAccount = {
  email: 'alice@example.com',
  tokens: {
    combined: {
      refreshToken: 'rt-alice-combined',
      scopes: [
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
      ],
      grantedAt: '2026-02-01T00:00:00Z',
    },
  },
  addedAt: '2026-01-01T00:00:00Z',
};

// ─── readAccountStore ──────────────────────────────────────

describe('readAccountStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed store when file exists', async () => {
    const store = makeStore([aliceAccount]);
    mockReadFile.mockResolvedValue(JSON.stringify(store));
    const result = await readAccountStore();
    expect(result).toEqual(store);
  });

  it('returns null when file does not exist', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const result = await readAccountStore();
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON structure', async () => {
    mockReadFile.mockResolvedValue('{"version": 2, "accounts": []}');
    const result = await readAccountStore();
    expect(result).toBeNull();
  });

  it('returns null when accounts is not an array', async () => {
    mockReadFile.mockResolvedValue('{"version": 1, "accounts": "not an array"}');
    const result = await readAccountStore();
    expect(result).toBeNull();
  });
});

// ─── writeAccountStore ─────────────────────────────────────

describe('writeAccountStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it('writes atomically via tmp file + rename', async () => {
    const store = makeStore([aliceAccount]);
    await writeAccountStore(store);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const writePath = mockWriteFile.mock.calls[0][0] as string;
    expect(writePath).toContain('accounts.json.tmp');

    expect(mockRename).toHaveBeenCalledOnce();
    const [from, to] = mockRename.mock.calls[0] as string[];
    expect(from).toContain('accounts.json.tmp');
    expect(to).toContain('accounts.json');
    expect(to).not.toContain('.tmp');
  });

  it('creates config dir with mkdir', async () => {
    await writeAccountStore(makeStore());
    expect(mockMkdir).toHaveBeenCalled();
  });

  it('sets file permissions to 0o600', async () => {
    await writeAccountStore(makeStore());
    const chmodCalls = mockChmod.mock.calls;
    const fileChmod = chmodCalls.find(
      (c) => (c[0] as string).includes('accounts.json.tmp')
    );
    expect(fileChmod).toBeDefined();
    expect(fileChmod![1]).toBe(0o600);
  });
});

// ─── findAccount ───────────────────────────────────────────

describe('findAccount', () => {
  const store = makeStore([aliceAccount, { ...aliceAccount, email: 'bob@example.com' }]);

  it('finds account by exact email', () => {
    expect(findAccount(store, 'alice@example.com')?.email).toBe('alice@example.com');
  });

  it('finds account case-insensitively', () => {
    expect(findAccount(store, 'ALICE@EXAMPLE.COM')?.email).toBe('alice@example.com');
  });

  it('trims whitespace from email', () => {
    expect(findAccount(store, '  alice@example.com  ')?.email).toBe('alice@example.com');
  });

  it('returns first account when no email given', () => {
    expect(findAccount(store)?.email).toBe('alice@example.com');
  });

  it('returns undefined for unknown email', () => {
    expect(findAccount(store, 'nobody@example.com')).toBeUndefined();
  });

  it('returns undefined for empty store', () => {
    expect(findAccount(makeStore())).toBeUndefined();
  });
});

// ─── resolveToken ──────────────────────────────────────────

describe('resolveToken', () => {
  it('resolves per-service token', () => {
    const result = resolveToken(aliceAccount, 'gmail');
    expect(result).not.toBeNull();
    expect(result!.refreshToken).toBe('rt-alice-gmail');
    expect(result!.scopes).toContain('https://mail.google.com/');
  });

  it('resolves combined token when scope matches', () => {
    const result = resolveToken(aliceCombined, 'gmail');
    expect(result).not.toBeNull();
    expect(result!.refreshToken).toBe('rt-alice-combined');
  });

  it('prefers combined over per-service', () => {
    const both: GoEasyAccount = {
      ...aliceAccount,
      tokens: {
        ...aliceAccount.tokens,
        combined: aliceCombined.tokens.combined,
      },
    };
    const result = resolveToken(both, 'gmail');
    expect(result!.refreshToken).toBe('rt-alice-combined');
  });

  it('returns null when no token for service', () => {
    const result = resolveToken(aliceAccount, 'calendar');
    expect(result).toBeNull();
  });

  it('returns null when combined lacks the needed scope', () => {
    const partial: GoEasyAccount = {
      email: 'alice@example.com',
      tokens: {
        combined: {
          refreshToken: 'rt-partial',
          scopes: ['https://mail.google.com/'], // gmail only
          grantedAt: '2026-01-01T00:00:00Z',
        },
      },
      addedAt: '2026-01-01T00:00:00Z',
    };
    const result = resolveToken(partial, 'drive');
    expect(result).toBeNull();
  });
});

// ─── upsertAccount ─────────────────────────────────────────

describe('upsertAccount', () => {
  it('adds a new account', () => {
    const store = makeStore();
    const result = upsertAccount(store, aliceAccount);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].email).toBe('alice@example.com');
  });

  it('merges tokens for existing account (case-insensitive)', () => {
    const store = makeStore([aliceAccount]);
    const calToken: GoEasyAccount = {
      email: 'ALICE@example.com',
      tokens: {
        calendar: {
          refreshToken: 'rt-alice-cal',
          scopes: ['https://www.googleapis.com/auth/calendar'],
          grantedAt: '2026-02-01T00:00:00Z',
        },
      },
      addedAt: '2026-02-01T00:00:00Z',
    };
    const result = upsertAccount(store, calToken);
    expect(result.accounts).toHaveLength(1);
    const acc = result.accounts[0];
    expect(acc.tokens.gmail).toBeDefined();
    expect(acc.tokens.drive).toBeDefined();
    expect(acc.tokens.calendar).toBeDefined();
  });
});

// ─── removeAccount ─────────────────────────────────────────

describe('removeAccount', () => {
  it('removes an existing account', () => {
    const store = makeStore([aliceAccount]);
    expect(removeAccount(store, 'alice@example.com')).toBe(true);
    expect(store.accounts).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const store = makeStore([aliceAccount]);
    expect(removeAccount(store, 'ALICE@EXAMPLE.COM')).toBe(true);
    expect(store.accounts).toHaveLength(0);
  });

  it('returns false for non-existent account', () => {
    const store = makeStore([aliceAccount]);
    expect(removeAccount(store, 'nobody@example.com')).toBe(false);
    expect(store.accounts).toHaveLength(1);
  });
});

// ─── hashPass ─────────────────────────────────────────────

describe('hashPass', () => {
  it('is deterministic', () => {
    expect(hashPass('mysecret')).toBe(hashPass('mysecret'));
  });

  it('returns a 64-char lowercase hex string (SHA-256)', () => {
    expect(hashPass('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashPass('a')).not.toBe(hashPass('b'));
  });
});

// ─── filterAccountsByPass ──────────────────────────────────

describe('filterAccountsByPass', () => {
  const pass = 'mysecret';

  const unprotected: GoEasyAccount = { ...aliceAccount };
  const protected_: GoEasyAccount = {
    ...aliceAccount,
    email: 'bob@example.com',
    passHash: hashPass(pass),
  };

  it('shows unprotected accounts when no passes given', () => {
    const store = makeStore([unprotected]);
    expect(filterAccountsByPass(store, []).accounts).toHaveLength(1);
  });

  it('hides protected accounts when no passes given', () => {
    const store = makeStore([protected_]);
    expect(filterAccountsByPass(store, []).accounts).toHaveLength(0);
  });

  it('shows protected account with the correct pass', () => {
    const store = makeStore([protected_]);
    expect(filterAccountsByPass(store, [pass]).accounts).toHaveLength(1);
  });

  it('hides protected account with the wrong pass', () => {
    const store = makeStore([protected_]);
    expect(filterAccountsByPass(store, ['wrongpass']).accounts).toHaveLength(0);
  });

  it('shows unprotected + matching protected together', () => {
    const store = makeStore([unprotected, protected_]);
    expect(filterAccountsByPass(store, [pass]).accounts).toHaveLength(2);
  });

  it('does not mutate the original store', () => {
    const store = makeStore([unprotected, protected_]);
    filterAccountsByPass(store, []);
    expect(store.accounts).toHaveLength(2);
  });
});

// ─── readCredentials ───────────────────────────────────────

describe('readCredentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads and parses credentials.json', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ clientId: 'cid', clientSecret: 'csec' }));
    const creds = await readCredentials();
    expect(creds).toEqual({ clientId: 'cid', clientSecret: 'csec' });
  });

  it('returns null when file missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await readCredentials()).toBeNull();
  });

  it('returns null for invalid shape', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
    expect(await readCredentials()).toBeNull();
  });

  it('reads Google-emitted installed app format', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ installed: { client_id: 'cid', client_secret: 'csec', other: 'ignored' } }));
    expect(await readCredentials()).toEqual({ clientId: 'cid', clientSecret: 'csec' });
  });

  it('reads Google-emitted web app format', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ web: { client_id: 'cid', client_secret: 'csec' } }));
    expect(await readCredentials()).toEqual({ clientId: 'cid', clientSecret: 'csec' });
  });
});

// ─── writeCredentials ──────────────────────────────────────

describe('writeCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it('writes atomically', async () => {
    await writeCredentials({ clientId: 'cid', clientSecret: 'csec' });
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockRename).toHaveBeenCalledOnce();
    const writePath = mockWriteFile.mock.calls[0][0] as string;
    expect(writePath).toContain('credentials.json.tmp');
  });
});

// ─── Multi-pass: fixtures ──────────────────────────────────

const makePassAccount = (overrides: Partial<GoEasyAccount> = {}): GoEasyAccount => ({
  email: 'alice@example.com',
  tokens: { combined: { refreshToken: 'rt', scopes: [], grantedAt: '2026-01-01T00:00:00Z' } },
  addedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ─── findPassEntry ─────────────────────────────────────────

describe('findPassEntry', () => {
  it('finds a matching passes[] entry', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('secret') }] });
    const entry = findPassEntry(account, 'secret');
    expect(entry).not.toBeNull();
    expect(entry!.hash).toBe(hashPass('secret'));
  });

  it('returns entry with deny list intact', () => {
    const account = makePassAccount({
      passes: [{ hash: hashPass('secret'), calendarDeny: ['cal1', 'cal2'] }],
    });
    expect(findPassEntry(account, 'secret')!.calendarDeny).toEqual(['cal1', 'cal2']);
  });

  it('falls back to legacy passHash', () => {
    const account = makePassAccount({ passHash: hashPass('legacy') });
    const entry = findPassEntry(account, 'legacy');
    expect(entry).not.toBeNull();
    expect(entry!.hash).toBe(hashPass('legacy'));
  });

  it('legacy passHash match has no calendarDeny', () => {
    const account = makePassAccount({ passHash: hashPass('legacy') });
    expect(findPassEntry(account, 'legacy')!.calendarDeny).toBeUndefined();
  });

  it('passHash takes precedence over same-hash passes[] entry with calendarDeny', () => {
    // If passHash and a passes[] entry share the same hash, passHash wins — no restrictions.
    const account = makePassAccount({
      passHash: hashPass('admin'),
      passes: [{ hash: hashPass('admin'), calendarDeny: ['cal1'] }],
    });
    const entry = findPassEntry(account, 'admin');
    expect(entry).not.toBeNull();
    expect(entry!.calendarDeny).toBeUndefined();
  });

  it('returns null for wrong passphrase', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('right') }] });
    expect(findPassEntry(account, 'wrong')).toBeNull();
  });

  it('returns null when no passes configured', () => {
    expect(findPassEntry(makePassAccount(), 'anything')).toBeNull();
  });
});

// ─── getCalendarDenyList ───────────────────────────────────

describe('getCalendarDenyList', () => {
  it('returns [] when pass not found', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('other') }] });
    expect(getCalendarDenyList(account, 'unknown')).toEqual([]);
  });

  it('returns [] when entry has no calendarDeny', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }] });
    expect(getCalendarDenyList(account, 'p')).toEqual([]);
  });

  it('returns the calendarDeny array', () => {
    const account = makePassAccount({
      passes: [{ hash: hashPass('p'), calendarDeny: ['cal1'] }],
    });
    expect(getCalendarDenyList(account, 'p')).toEqual(['cal1']);
  });

  it('returns [] for legacy passHash match (no deny list possible)', () => {
    const account = makePassAccount({ passHash: hashPass('legacy') });
    expect(getCalendarDenyList(account, 'legacy')).toEqual([]);
  });
});

// ─── addPassEntry ──────────────────────────────────────────

describe('addPassEntry', () => {
  it('creates passes[] when absent and adds entry', () => {
    const account = makePassAccount();
    addPassEntry(account, 'newpass');
    expect(account.passes).toHaveLength(1);
    expect(account.passes![0].hash).toBe(hashPass('newpass'));
  });

  it('appends to existing passes[]', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('first') }] });
    addPassEntry(account, 'second');
    expect(account.passes).toHaveLength(2);
  });

  it('is idempotent — does not duplicate an existing hash', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }] });
    addPassEntry(account, 'p');
    addPassEntry(account, 'p');
    expect(account.passes).toHaveLength(1);
  });

  it('returns the existing entry when hash already present', () => {
    const entry = { hash: hashPass('p'), calendarDeny: ['cal1'] };
    const account = makePassAccount({ passes: [entry] });
    const returned = addPassEntry(account, 'p');
    expect(returned).toBe(entry);
    expect(returned.calendarDeny).toEqual(['cal1']);
  });
});

// ─── removePassEntry ───────────────────────────────────────

describe('removePassEntry', () => {
  it('removes a matching passes[] entry', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }, { hash: hashPass('q') }] });
    expect(removePassEntry(account, 'p')).toBe(true);
    expect(account.passes).toHaveLength(1);
    expect(account.passes![0].hash).toBe(hashPass('q'));
  });

  it('removes legacy passHash', () => {
    const account = makePassAccount({ passHash: hashPass('legacy') });
    expect(removePassEntry(account, 'legacy')).toBe(true);
    expect(account.passHash).toBeUndefined();
  });

  it('returns false when pass not found', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }] });
    expect(removePassEntry(account, 'notfound')).toBe(false);
  });

  it('returns false on account with no passes', () => {
    expect(removePassEntry(makePassAccount(), 'anything')).toBe(false);
  });
});

// ─── addCalendarDeny ──────────────────────────────────────

describe('addCalendarDeny', () => {
  it('adds a calendarId to the deny list', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }] });
    expect(addCalendarDeny(account, 'p', 'cal1')).toBe(true);
    expect(account.passes![0].calendarDeny).toEqual(['cal1']);
  });

  it('is idempotent — does not duplicate a calendarId', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p'), calendarDeny: ['cal1'] }] });
    addCalendarDeny(account, 'p', 'cal1');
    expect(account.passes![0].calendarDeny).toHaveLength(1);
  });

  it('appends to an existing calendarDeny list', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p'), calendarDeny: ['cal1'] }] });
    addCalendarDeny(account, 'p', 'cal2');
    expect(account.passes![0].calendarDeny).toEqual(['cal1', 'cal2']);
  });

  it('returns false if pass not found in passes[]', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('other') }] });
    expect(addCalendarDeny(account, 'notfound', 'cal1')).toBe(false);
  });

  it('returns false for legacy passHash (cannot carry deny list)', () => {
    const account = makePassAccount({ passHash: hashPass('legacy') });
    expect(addCalendarDeny(account, 'legacy', 'cal1')).toBe(false);
  });
});

// ─── removeCalendarDeny ───────────────────────────────────

describe('removeCalendarDeny', () => {
  it('removes an existing calendarId from the deny list', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p'), calendarDeny: ['cal1', 'cal2'] }] });
    expect(removeCalendarDeny(account, 'p', 'cal1')).toBe(true);
    expect(account.passes![0].calendarDeny).toEqual(['cal2']);
  });

  it('returns false if calendarId not in deny list', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p'), calendarDeny: ['cal1'] }] });
    expect(removeCalendarDeny(account, 'p', 'cal2')).toBe(false);
  });

  it('returns false if calendarDeny is absent', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('p') }] });
    expect(removeCalendarDeny(account, 'p', 'cal1')).toBe(false);
  });

  it('returns false if pass not found', () => {
    const account = makePassAccount({ passes: [{ hash: hashPass('other') }] });
    expect(removeCalendarDeny(account, 'notfound', 'cal1')).toBe(false);
  });
});

// ─── filterAccountsByPass (passes[] extensions) ───────────

describe('filterAccountsByPass — passes[] support', () => {
  const pass1 = 'alpha';
  const pass2 = 'beta';

  const passesOnly: GoEasyAccount = makePassAccount({
    passes: [{ hash: hashPass(pass1) }, { hash: hashPass(pass2) }],
  });

  const bothFields: GoEasyAccount = makePassAccount({
    passHash: hashPass('legacy'),
    passes: [{ hash: hashPass(pass1) }],
  });

  it('hides account with passes[] when no pass supplied', () => {
    const store = makeStore([passesOnly]);
    expect(filterAccountsByPass(store, []).accounts).toHaveLength(0);
  });

  it('shows account when first pass matches passes[]', () => {
    const store = makeStore([passesOnly]);
    expect(filterAccountsByPass(store, [pass1]).accounts).toHaveLength(1);
  });

  it('shows account when second pass matches passes[]', () => {
    const store = makeStore([passesOnly]);
    expect(filterAccountsByPass(store, [pass2]).accounts).toHaveLength(1);
  });

  it('hides account when wrong pass supplied', () => {
    const store = makeStore([passesOnly]);
    expect(filterAccountsByPass(store, ['wrong']).accounts).toHaveLength(0);
  });

  it('shows account when passes[] matches (even if passHash does not)', () => {
    const store = makeStore([bothFields]);
    expect(filterAccountsByPass(store, [pass1]).accounts).toHaveLength(1);
  });

  it('shows account when legacy passHash matches (even if passes[] does not)', () => {
    const store = makeStore([bothFields]);
    expect(filterAccountsByPass(store, ['legacy']).accounts).toHaveLength(1);
  });

  it('multiple passes in call: account shown if any matches', () => {
    const store = makeStore([passesOnly]);
    expect(filterAccountsByPass(store, ['wrong', pass2]).accounts).toHaveLength(1);
  });
});
