import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthError } from '../src/errors.js';

// ─── Mocks ─────────────────────────────────────────────────

// Mock auth-store before importing auth.
// Use importOriginal to keep pure functions (findAccount, resolveToken,
// filterAccountsByPass, hashPass) as real implementations; only I/O is mocked.
const mockReadAccountStore = vi.fn();
const mockReadCredentials = vi.fn();

vi.mock('../src/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/auth-store.js')>();
  return {
    ...actual,
    readAccountStore: (...args: unknown[]) => mockReadAccountStore(...args),
    readAllCredentials: async () => {
      const creds = await mockReadCredentials();
      return creds ? [creds] : [];
    },
  };
});

// Track OAuth2 instances
const mockSetCredentials = vi.fn();
const mockOAuth2Instances: Array<{ clientId: string; clientSecret: string }> = [];

vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2 {
    constructor(clientId: string, clientSecret: string) {
      mockOAuth2Instances.push({ clientId, clientSecret });
    }
    setCredentials = mockSetCredentials;
  },
}));

// Import after mocks
import { getAuth, listAccounts, listAllAccounts, clearAuthCache } from '../src/auth.js';
import type { AccountStore } from '../src/auth-store.js';
import { hashPass } from '../src/auth-store.js';

// ─── Fixtures ──────────────────────────────────────────────

const fakeCredentials = {
  clientId: 'client-id-1',
  clientSecret: 'client-secret-1',
};

const fakeStore: AccountStore = {
  version: 1,
  accounts: [
    {
      email: 'alice@example.com',
      tokens: {
        gmail: {
          refreshToken: 'refresh-alice-gmail',
          scopes: ['https://mail.google.com/'],
          grantedAt: '2026-01-01T00:00:00Z',
        },
        drive: {
          refreshToken: 'refresh-alice-drive',
          scopes: ['https://www.googleapis.com/auth/drive'],
          grantedAt: '2026-01-01T00:00:00Z',
        },
        calendar: {
          refreshToken: 'refresh-alice-cal',
          scopes: ['https://www.googleapis.com/auth/calendar'],
          grantedAt: '2026-01-01T00:00:00Z',
        },
      },
      addedAt: '2026-01-01T00:00:00Z',
    },
    {
      email: 'bob@example.com',
      tokens: {
        gmail: {
          refreshToken: 'refresh-bob-gmail',
          scopes: ['https://mail.google.com/'],
          grantedAt: '2026-01-01T00:00:00Z',
        },
      },
      addedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const fakeCombinedStore: AccountStore = {
  version: 1,
  accounts: [
    {
      email: 'alice@example.com',
      tokens: {
        combined: {
          refreshToken: 'refresh-alice-combined',
          scopes: [
            'https://mail.google.com/',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/calendar',
          ],
          grantedAt: '2026-02-01T00:00:00Z',
        },
      },
      addedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const PASS = 'mysecret';

// Store where alice is protected by a passphrase
const fakePassStore: AccountStore = {
  version: 1,
  accounts: [
    {
      ...fakeStore.accounts[0],
      passHash: hashPass(PASS),
    },
    fakeStore.accounts[1], // bob is unprotected
  ],
};

// ─── Tests ─────────────────────────────────────────────────

describe('getAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOAuth2Instances.length = 0;
    clearAuthCache();
    mockReadAccountStore.mockResolvedValue(fakeStore);
    mockReadCredentials.mockResolvedValue(fakeCredentials);
  });

  it('loads token and returns an OAuth2Client', async () => {
    const client = await getAuth('gmail', 'alice@example.com');
    expect(client).toBeDefined();
    expect(mockOAuth2Instances).toHaveLength(1);
    expect(mockOAuth2Instances[0].clientId).toBe('client-id-1');
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-gmail',
    });
  });

  it('uses the correct per-service token', async () => {
    await getAuth('gmail', 'alice@example.com');
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-gmail',
    });

    clearAuthCache();
    await getAuth('drive', 'alice@example.com');
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-drive',
    });

    clearAuthCache();
    await getAuth('calendar', 'alice@example.com');
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-cal',
    });
  });

  it('prefers combined token over per-service when scope matches', async () => {
    mockReadAccountStore.mockResolvedValue(fakeCombinedStore);
    await getAuth('gmail', 'alice@example.com');
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-combined',
    });
  });

  it('defaults to first account when no email specified', async () => {
    const client = await getAuth('gmail');
    expect(client).toBeDefined();
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-gmail',
    });
  });

  it('caches clients by service:email', async () => {
    const client1 = await getAuth('gmail', 'alice@example.com');
    const client2 = await getAuth('gmail', 'alice@example.com');
    expect(client1).toBe(client2); // same reference
    expect(mockOAuth2Instances).toHaveLength(1); // only created once
  });

  it('creates separate clients for different accounts', async () => {
    await getAuth('gmail', 'alice@example.com');
    await getAuth('gmail', 'bob@example.com');
    expect(mockOAuth2Instances).toHaveLength(2);
  });

  it('creates separate clients for different services', async () => {
    await getAuth('gmail', 'alice@example.com');
    await getAuth('drive', 'alice@example.com');
    expect(mockOAuth2Instances).toHaveLength(2);
  });

  it('throws AUTH_NO_ACCOUNT for unknown account', async () => {
    await expect(getAuth('gmail', 'nobody@example.com')).rejects.toThrow(AuthError);
    try {
      await getAuth('gmail', 'nobody@example.com');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe('AUTH_NO_ACCOUNT');
      expect((err as AuthError).fix).toContain('go-easy auth add');
    }
  });

  it('throws AUTH_MISSING_SCOPE when account exists but no token for service', async () => {
    // bob only has gmail token, not drive
    await expect(getAuth('drive', 'bob@example.com')).rejects.toThrow(AuthError);
    try {
      await getAuth('drive', 'bob@example.com');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe('AUTH_MISSING_SCOPE');
      expect((err as AuthError).fix).toContain('go-easy auth add bob@example.com');
    }
  });

  it('throws AUTH_NO_ACCOUNT when store is empty', async () => {
    mockReadAccountStore.mockResolvedValue(null);
    await expect(getAuth('gmail')).rejects.toThrow(AuthError);
    try {
      await getAuth('gmail');
    } catch (err) {
      expect((err as AuthError).code).toBe('AUTH_NO_ACCOUNT');
    }
  });

  it('throws AUTH_NO_CREDENTIALS when credentials.json is missing', async () => {
    mockReadCredentials.mockResolvedValue(null);
    await expect(getAuth('gmail', 'alice@example.com')).rejects.toThrow(AuthError);
    try {
      await getAuth('gmail', 'alice@example.com');
    } catch (err) {
      expect((err as AuthError).code).toBe('AUTH_NO_CREDENTIALS');
    }
  });

  it('is case-insensitive for email matching', async () => {
    const client = await getAuth('gmail', 'ALICE@example.com');
    expect(client).toBeDefined();
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-gmail',
    });
  });

  it('throws AUTH_NO_ACCOUNT with email in message when store is null and account is specified', async () => {
    mockReadAccountStore.mockResolvedValue(null);
    const err = await getAuth('gmail', 'specific@example.com').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('AUTH_NO_ACCOUNT');
    expect(err.message).toContain('specific@example.com');
    expect(err.fix).toContain('specific@example.com');
  });

  it('throws AUTH_NO_ACCOUNT with generic message when store is null and no account specified', async () => {
    // Existing test covers this path; this variant tests empty store (no accounts)
    // so findAccount returns undefined, hitting the no-account-specified branches
    mockReadAccountStore.mockResolvedValue({ version: 1, accounts: [] });
    const err = await getAuth('gmail').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('AUTH_NO_ACCOUNT');
    expect(err.message).toBe('No accounts configured');
    expect(err.fix).toBe('npx go-easy auth add <email>');
  });

  it('throws AUTH_PROTECTED when account exists but no pass given', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const err = await getAuth('gmail', 'alice@example.com').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('AUTH_PROTECTED');
    expect(err.message).toContain('--pass');
  });

  it('throws AUTH_PASS_WRONG when account exists but wrong pass given', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const err = await getAuth('gmail', 'alice@example.com', 'wrongpass').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('AUTH_PASS_WRONG');
  });

  it('succeeds for pass-protected account with correct pass', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const client = await getAuth('gmail', 'alice@example.com', PASS);
    expect(client).toBeDefined();
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-alice-gmail',
    });
  });

  it('does not require pass for unprotected accounts even when other accounts are protected', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const client = await getAuth('gmail', 'bob@example.com');
    expect(client).toBeDefined();
  });
});

describe('listAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAccountStore.mockResolvedValue(fakeStore);
  });

  it('returns emails that have a token for the service', async () => {
    const gmailAccounts = await listAccounts('gmail');
    expect(gmailAccounts).toEqual(['alice@example.com', 'bob@example.com']);

    const driveAccounts = await listAccounts('drive');
    expect(driveAccounts).toEqual(['alice@example.com']); // bob has no drive token
  });

  it('returns empty array when no store', async () => {
    mockReadAccountStore.mockResolvedValue(null);
    const emails = await listAccounts('gmail');
    expect(emails).toEqual([]);
  });

  it('excludes pass-protected accounts when no pass given', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const emails = await listAccounts('gmail');
    expect(emails).not.toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
  });

  it('includes pass-protected accounts with correct pass', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const emails = await listAccounts('gmail', PASS);
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
  });
});

describe('listAllAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAccountStore.mockResolvedValue(fakeStore);
  });

  it('returns empty array when no store', async () => {
    mockReadAccountStore.mockResolvedValue(null);
    expect(await listAllAccounts()).toEqual([]);
  });

  it('reports source=legacy for per-service tokens', async () => {
    const results = await listAllAccounts();
    const alice = results.find((a) => a.email === 'alice@example.com')!;
    expect(alice.source).toBe('legacy');
    expect(alice.scopes).toContain('https://mail.google.com/');
    expect(alice.scopes).toContain('https://www.googleapis.com/auth/drive');
  });

  it('reports source=combined for combined token', async () => {
    mockReadAccountStore.mockResolvedValue(fakeCombinedStore);
    const results = await listAllAccounts();
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('combined');
    expect(results[0].scopes).toContain('https://mail.google.com/');
  });

  it('includes passProtected:false for unprotected accounts', async () => {
    const results = await listAllAccounts();
    expect(results.every((a) => a.passProtected === false)).toBe(true);
  });

  it('hides pass-protected accounts when no passes given', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const results = await listAllAccounts();
    expect(results.map((a) => a.email)).not.toContain('alice@example.com');
  });

  it('shows pass-protected accounts with correct pass and marks passProtected:true', async () => {
    mockReadAccountStore.mockResolvedValue(fakePassStore);
    const results = await listAllAccounts([PASS]);
    const alice = results.find((a) => a.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice!.passProtected).toBe(true);
  });
});

describe('clearAuthCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOAuth2Instances.length = 0;
    clearAuthCache();
    mockReadAccountStore.mockResolvedValue(fakeStore);
    mockReadCredentials.mockResolvedValue(fakeCredentials);
  });

  it('forces re-creation of clients after clearing', async () => {
    await getAuth('gmail', 'alice@example.com');
    expect(mockOAuth2Instances).toHaveLength(1);

    clearAuthCache();

    await getAuth('gmail', 'alice@example.com');
    expect(mockOAuth2Instances).toHaveLength(2); // new instance created
  });
});
