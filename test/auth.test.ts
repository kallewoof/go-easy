import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthError } from '../src/errors.js';

// ─── Mocks ─────────────────────────────────────────────────

// Mock auth-store before importing auth
// We need real implementations of findAccount and resolveToken (pure functions),
// but mock the I/O functions. vi.mock hoists, so we can't use await import.
// Instead, we provide inline implementations matching the real ones.
const mockReadAccountStore = vi.fn();
const mockReadCredentials = vi.fn();

vi.mock('../src/auth-store.js', () => {
  // Inline pure functions (matching real implementations)
  const SCOPES: Record<string, string> = {
    gmail: 'https://mail.google.com/',
    drive: 'https://www.googleapis.com/auth/drive',
    calendar: 'https://www.googleapis.com/auth/calendar',
  };

  function findAccount(store: { accounts: Array<{ email: string }> }, email?: string) {
    if (!email) return store.accounts[0];
    const normalized = email.trim().toLowerCase();
    return store.accounts.find((a: { email: string }) => a.email.toLowerCase() === normalized);
  }

  function resolveToken(
    account: { tokens: Record<string, { refreshToken: string; scopes: string[] } | undefined> },
    service: string
  ) {
    const neededScope = SCOPES[service];
    const combined = account.tokens.combined;
    if (combined) {
      if (combined.scopes.includes(neededScope)) {
        return { refreshToken: combined.refreshToken, scopes: combined.scopes };
      }
    }
    const serviceToken = account.tokens[service];
    if (serviceToken) {
      return { refreshToken: serviceToken.refreshToken, scopes: serviceToken.scopes };
    }
    return null;
  }

  return {
    readAccountStore: (...args: unknown[]) => mockReadAccountStore(...args),
    readCredentials: (...args: unknown[]) => mockReadCredentials(...args),
    findAccount,
    resolveToken,
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
