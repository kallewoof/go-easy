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
