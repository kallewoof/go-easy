import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authList, authAdd, authRemove, authPassSet, authPassRemove, authPassAdd, authPassRm, authPassList, authCalendarDeny, credentialsList, credentialsSet, credentialsAppend, parseFlags, positionals, main } from '../../src/bin/easy.js';
import { readAccountStore, writeAccountStore } from '../../src/auth-store.js';

vi.mock('../../src/auth.js', () => ({
  listAllAccounts: vi.fn().mockResolvedValue([{ email: 'user@example.com', tokens: {}, passProtected: false }]),
  clearAuthCache: vi.fn(),
}));

const mockImportCredentials = vi.fn().mockResolvedValue({ clientId: 'new-id', clientSecret: 'new-secret' });
const mockAppendCredentials = vi.fn().mockResolvedValue({ clientId: 'appended-id', clientSecret: 'appended-secret', name: 'work' });
const mockReadAllCredentials = vi.fn().mockResolvedValue([{ clientId: 'id', clientSecret: 'secret' }]);

// Simple predictable hash for tests: 'hash:' + input
const mockHashPass = vi.fn((p: string) => 'hash:' + p);

const mockFindPassEntry = vi.fn();
const mockAddPassEntry = vi.fn();
const mockRemovePassEntry = vi.fn();
const mockAddCalendarDeny = vi.fn();
const mockRemoveCalendarDeny = vi.fn();
const mockGetCalendarDenyList = vi.fn();

vi.mock('../../src/auth-store.js', () => ({
  readAccountStore: vi.fn().mockImplementation(() => Promise.resolve({
    version: 1,
    accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
  })),
  writeAccountStore: vi.fn().mockResolvedValue(undefined),
  readCredentials: vi.fn().mockResolvedValue({ clientId: 'id', clientSecret: 'secret' }),
  readAllCredentials: (...args: unknown[]) => mockReadAllCredentials(...args),
  importCredentials: (...args: unknown[]) => mockImportCredentials(...args),
  appendCredentials: (...args: unknown[]) => mockAppendCredentials(...args),
  getConfigDir: vi.fn().mockReturnValue('/mock/config'),
  hashPass: (...args: unknown[]) => mockHashPass(...(args as [string])),
  findAccount: vi.fn((store: { accounts: Array<{ email: string }> }, email: string) =>
    store.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null
  ),
  removeAccount: vi.fn((store: { accounts: Array<{ email: string }> }, email: string) => {
    store.accounts = store.accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  }),
  findPassEntry: (...args: unknown[]) => mockFindPassEntry(...args),
  addPassEntry: (...args: unknown[]) => mockAddPassEntry(...args),
  removePassEntry: (...args: unknown[]) => mockRemovePassEntry(...args),
  addCalendarDeny: (...args: unknown[]) => mockAddCalendarDeny(...args),
  removeCalendarDeny: (...args: unknown[]) => mockRemoveCalendarDeny(...args),
  getCalendarDenyList: (...args: unknown[]) => mockGetCalendarDenyList(...args),
}));

vi.mock('../../src/auth-flow.js', () => ({
  authAdd: vi.fn().mockResolvedValue({ status: 'started', authUrl: 'https://accounts.google.com/auth' }),
}));

vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/errors.js', () => ({
  GoEasyError: class GoEasyError extends Error {},
  SafetyError: class SafetyError extends Error {},
}));

// ─── Utilities ─────────────────────────────────────────────

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--confirm=true', '--email=foo@bar.com'])).toEqual({
      confirm: 'true',
      email: 'foo@bar.com',
    });
  });

  it('parses --key value (space-separated)', () => {
    expect(parseFlags(['--credentials', '1'])).toEqual({ credentials: '1' });
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--confirm'])).toEqual({ confirm: 'true' });
  });

  it('ignores non-flag arguments', () => {
    expect(parseFlags(['positional', '--flag=val'])).toEqual({ flag: 'val' });
  });
});

describe('positionals', () => {
  it('returns only non-flag arguments', () => {
    expect(positionals(['add', 'user@example.com', '--confirm'])).toEqual(['add', 'user@example.com']);
  });
});

// ─── Handlers ──────────────────────────────────────────────

describe('authList', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy?.mockRestore(); });

  it('outputs accounts as JSON', async () => {
    await authList();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('accounts');
    expect(Array.isArray(output.accounts)).toBe(true);
  });
});

describe('authAdd', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('outputs the auth flow result as JSON', async () => {
    await authAdd(['user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.status).toBe('started');
  });

  it('exits with error when no email is provided', async () => {
    await expect(authAdd([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('authRemove', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('removes account and outputs ok:true when --confirm is provided', async () => {
    await authRemove(['user@example.com', '--confirm']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.removed).toBe('user@example.com');
  });

  it('blocks without --confirm and exits with code 2', async () => {
    await expect(authRemove(['user@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.blocked).toBe(true);
  });

  it('exits with error when account is not found', async () => {
    await expect(authRemove(['nobody@example.com', '--confirm'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with error when no email is provided', async () => {
    await expect(authRemove(['--confirm'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── auth pass-set / pass-remove ───────────────────────────

describe('authPassSet', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('sets passHash and outputs ok:true', async () => {
    await authPassSet(['user@example.com', 'newsecret']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.passProtected).toBe(true);
    expect(vi.mocked(writeAccountStore)).toHaveBeenCalledOnce();
    const stored = vi.mocked(writeAccountStore).mock.calls[0][0];
    expect(stored.accounts[0].passHash).toBe('hash:newsecret');
  });

  it('exits with error when no email or passphrase provided', async () => {
    await expect(authPassSet(['user@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with error when account not found', async () => {
    await expect(authPassSet(['nobody@example.com', 'secret'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requires --current-pass when account already has a passHash', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:oldsecret' }],
    });
    await expect(authPassSet(['user@example.com', 'newsecret'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('accepts correct --current-pass when account already has a passHash', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:oldsecret' }],
    });
    await authPassSet(['user@example.com', 'newsecret', '--current-pass', 'oldsecret']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });
});

describe('authPassRemove', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:mysecret' }],
    });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('removes passHash and outputs passProtected:false with correct --current-pass', async () => {
    await authPassRemove(['user@example.com', '--current-pass', 'mysecret']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.passProtected).toBe(false);
    const stored = vi.mocked(writeAccountStore).mock.calls[0][0];
    expect(stored.accounts[0].passHash).toBeUndefined();
  });

  it('exits with AUTH_PASS_WRONG when --current-pass is missing', async () => {
    await expect(authPassRemove(['user@example.com'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('exits with AUTH_PASS_WRONG when --current-pass is wrong', async () => {
    await expect(authPassRemove(['user@example.com', '--current-pass', 'wrongpass'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('succeeds immediately when account has no passHash', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
    await authPassRemove(['user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.passProtected).toBe(false);
  });

  it('exits with error when no email provided', async () => {
    await expect(authPassRemove([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── credentials commands ──────────────────────────────────

describe('credentialsList', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy?.mockRestore(); });

  it('outputs credentials list with clientIds', async () => {
    await credentialsList();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(Array.isArray(output.credentials)).toBe(true);
    expect(output.credentials[0]).toHaveProperty('clientId');
    expect(output.credentials[0]).not.toHaveProperty('clientSecret');
  });

  it('outputs hint when no credentials configured', async () => {
    mockReadAllCredentials.mockResolvedValueOnce([]);
    await credentialsList();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.credentials).toHaveLength(0);
    expect(output.hint).toMatch(/credentials set/);
  });
});

describe('credentialsSet', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('imports credentials from file and outputs ok', async () => {
    await credentialsSet(['/path/to/creds.json']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.clientId).toBe('new-id');
  });

  it('exits with error when no file path provided', async () => {
    await expect(credentialsSet([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with error when import fails', async () => {
    mockImportCredentials.mockRejectedValueOnce(new Error('bad file'));
    await expect(credentialsSet(['/bad.json'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('credentialsAppend', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('appends credentials and outputs ok with total count', async () => {
    mockReadAllCredentials.mockResolvedValueOnce([{ clientId: 'id' }, { clientId: 'appended-id' }]);
    await credentialsAppend(['/path/to/creds.json', '--name=work']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.appended.clientId).toBe('appended-id');
    expect(output.total).toBe(2);
  });

  it('exits with error when no file path provided', async () => {
    await expect(credentialsAppend([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── main() dispatch ───────────────────────────────────────

describe('main() dispatch', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('auth list routes correctly', async () => {
    await main(['auth', 'list']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('accounts');
  });

  it('auth add routes correctly', async () => {
    await main(['auth', 'add', 'user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.status).toBe('started');
  });

  it('auth remove routes correctly', async () => {
    await main(['auth', 'remove', 'user@example.com', '--confirm']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('credentials list routes correctly', async () => {
    await main(['credentials', 'list']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('credentials');
  });

  it('credentials set routes correctly', async () => {
    await main(['credentials', 'set', '/path/to/creds.json']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('credentials append routes correctly', async () => {
    await main(['credentials', 'append', '/path/to/creds.json']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('exits on unknown credentials subcommand', async () => {
    await expect(main(['credentials', 'unknown'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits on unknown group', async () => {
    await expect(main(['unknown', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits on unknown subcommand', async () => {
    await expect(main(['auth', 'unknown'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when no args provided', async () => {
    await expect(main([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('auth pass-add routes correctly', async () => {
    mockFindPassEntry.mockReturnValue(null);
    mockAddPassEntry.mockImplementation((account: { passes?: unknown[] }) => {
      if (!account.passes) account.passes = [];
      account.passes.push({ hash: 'hash:newpass' });
      return account.passes[account.passes.length - 1];
    });
    await main(['auth', 'pass-add', 'user@example.com', 'newpass']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('auth pass-rm routes correctly', async () => {
    mockFindPassEntry.mockReturnValue({ hash: 'hash:oldpass' });
    mockRemovePassEntry.mockReturnValue(true);
    await main(['auth', 'pass-rm', 'user@example.com', 'oldpass']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('auth pass-list routes correctly', async () => {
    await main(['auth', 'pass-list', 'user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('passes');
  });

  it('auth calendar-deny add routes correctly', async () => {
    mockFindPassEntry.mockReturnValue({ hash: 'hash:p' });
    mockAddPassEntry.mockImplementation((account: { passes?: unknown[] }) => {
      if (!account.passes) account.passes = [];
      const entry = { hash: 'hash:p', calendarDeny: [] };
      account.passes.push(entry);
      return entry;
    });
    mockAddCalendarDeny.mockReturnValue(true);
    mockGetCalendarDenyList.mockReturnValue(['cal1']);
    await main(['auth', 'calendar-deny', 'add', 'user@example.com', 'p', 'cal1']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('auth calendar-deny remove routes correctly', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
    mockFindPassEntry.mockReturnValue({ hash: 'hash:p' }); // both p and admin are found
    mockRemoveCalendarDeny.mockReturnValue(true);
    mockGetCalendarDenyList.mockReturnValue([]); // admin has no restrictions
    await main(['auth', 'calendar-deny', 'remove', 'user@example.com', 'p', 'cal1', '--current-pass', 'admin']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('auth calendar-deny list routes correctly', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
    mockFindPassEntry.mockReturnValue({ hash: 'hash:p' });
    mockGetCalendarDenyList.mockReturnValue(['cal1']);
    await main(['auth', 'calendar-deny', 'list', 'user@example.com', 'p']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('calendarDeny');
  });
});

// ─── authPassAdd ───────────────────────────────────────────

describe('authPassAdd', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
    mockFindPassEntry.mockReturnValue(null);
    mockAddPassEntry.mockImplementation((account: { passes?: Array<{ hash: string }> }) => {
      if (!account.passes) account.passes = [];
      const entry = { hash: 'hash:newpass' };
      account.passes.push(entry);
      return entry;
    });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('adds pass and outputs ok:true when account is unprotected', async () => {
    await authPassAdd(['user@example.com', 'newpass']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.email).toBe('user@example.com');
    expect(vi.mocked(writeAccountStore)).toHaveBeenCalledOnce();
  });

  it('exits with error when missing email or passphrase', async () => {
    await expect(authPassAdd(['user@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with error when account not found', async () => {
    await expect(authPassAdd(['nobody@example.com', 'newpass'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_NO_ACCOUNT');
  });

  it('requires --current-pass when account has existing passHash', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:old' }],
    });
    mockFindPassEntry.mockReturnValue(null);
    await expect(authPassAdd(['user@example.com', 'newpass'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('requires --current-pass when account has existing passes[]', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passes: [{ hash: 'hash:old' }] }],
    });
    mockFindPassEntry.mockReturnValue(null);
    await expect(authPassAdd(['user@example.com', 'newpass'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('accepts valid --current-pass and adds new pass', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:old' }],
    });
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'old' ? { hash: 'hash:old' } : null
    );
    await authPassAdd(['user@example.com', 'newpass', '--current-pass', 'old']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
  });

  it('rejects wrong --current-pass', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:old' }],
    });
    mockFindPassEntry.mockReturnValue(null);
    await expect(authPassAdd(['user@example.com', 'newpass', '--current-pass', 'wrong'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });
});

// ─── authPassRm ────────────────────────────────────────────

describe('authPassRm', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passes: [{ hash: 'hash:target' }] }],
    });
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'target' ? { hash: 'hash:target' } : null
    );
    mockRemovePassEntry.mockReturnValue(true);
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('removes a pass and outputs ok:true', async () => {
    await authPassRm(['user@example.com', 'target']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(vi.mocked(writeAccountStore)).toHaveBeenCalledOnce();
  });

  it('exits with error when passphrase not found', async () => {
    mockFindPassEntry.mockReturnValue(null);
    await expect(authPassRm(['user@example.com', 'notfound'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('allows --current-pass to authorize removal of a different passphrase', async () => {
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'admin' ? { hash: 'hash:admin' } : null
    );
    mockRemovePassEntry.mockReturnValue(true);
    await authPassRm(['user@example.com', 'target', '--current-pass', 'admin']);
    expect(vi.mocked(writeAccountStore)).toHaveBeenCalledOnce();
  });

  it('exits when removePassEntry returns false', async () => {
    mockRemovePassEntry.mockReturnValue(false);
    await expect(authPassRm(['user@example.com', 'target'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('exits with error when missing positional args', async () => {
    await expect(authPassRm(['user@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── authPassList ──────────────────────────────────────────

describe('authPassList', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('lists passes for account with no passes', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
    });
    await authPassList(['user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.passes).toHaveLength(0);
  });

  it('lists passes[] entries with deny lists', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{
        email: 'user@example.com',
        tokens: { combined: {} },
        passes: [
          { hash: 'h1', calendarDeny: ['cal1'] },
          { hash: 'h2' },
        ],
      }],
    });
    await authPassList(['user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.passes).toHaveLength(2);
    expect(output.passes[0].calendarDeny).toEqual(['cal1']);
    expect(output.passes[1].calendarDeny).toBeUndefined();
  });

  it('lists legacy passHash as type:legacy', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [{ email: 'user@example.com', tokens: { combined: {} }, passHash: 'hash:old' }],
    });
    await authPassList(['user@example.com']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.passes).toHaveLength(1);
    expect(output.passes[0].type).toBe('legacy');
  });

  it('exits with error when account not found', async () => {
    vi.mocked(readAccountStore).mockResolvedValue({ version: 1, accounts: [] });
    await expect(authPassList(['nobody@example.com'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_NO_ACCOUNT');
  });

  it('exits with error when no email provided', async () => {
    await expect(authPassList([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── authCalendarDeny ──────────────────────────────────────

describe('authCalendarDeny', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const accountWithPass = {
    email: 'user@example.com',
    tokens: { combined: {} },
    passes: [{ hash: 'hash:p', calendarDeny: [] as string[] }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.mocked(readAccountStore).mockResolvedValue({
      version: 1,
      accounts: [accountWithPass],
    });
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'p' ? { hash: 'hash:p' } : null
    );
    mockAddPassEntry.mockImplementation((account: { passes?: Array<{ hash: string; calendarDeny?: string[] }> }) => {
      if (!account.passes) account.passes = [];
      const existing = account.passes.find((e) => e.hash === 'hash:p');
      if (existing) return existing;
      const e = { hash: 'hash:p', calendarDeny: [] as string[] };
      account.passes.push(e);
      return e;
    });
  });
  afterEach(() => { logSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('add: adds calendar to deny list', async () => {
    mockAddCalendarDeny.mockReturnValue(true);
    mockGetCalendarDenyList.mockReturnValue(['cal1']);
    await authCalendarDeny(['add', 'user@example.com', 'p', 'cal1']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.calendarId).toBe('cal1');
    expect(output.denyList).toEqual(['cal1']);
  });

  it('add: exits with AUTH_PASS_WRONG when pass not found', async () => {
    mockFindPassEntry.mockReturnValue(null);
    await expect(authCalendarDeny(['add', 'user@example.com', 'wrong', 'cal1'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('add: exits with error when addCalendarDeny returns false', async () => {
    mockAddCalendarDeny.mockReturnValue(false);
    await expect(authCalendarDeny(['add', 'user@example.com', 'p', 'cal1'])).rejects.toThrow('exit');
  });

  it('add: exits with error when missing args', async () => {
    await expect(authCalendarDeny(['add', 'user@example.com', 'p'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('remove: removes calendar from deny list with valid --current-pass', async () => {
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'p' || p === 'admin' ? { hash: `hash:${p}` } : null
    );
    mockGetCalendarDenyList.mockReturnValue([]); // admin has no restrictions; phrase's updated list is empty
    mockRemoveCalendarDeny.mockReturnValue(true);
    await authCalendarDeny(['remove', 'user@example.com', 'p', 'cal1', '--current-pass', 'admin']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.denyList).toEqual([]);
  });

  it('remove: exits with NOT_FOUND when calendarId not in deny list', async () => {
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'p' || p === 'admin' ? { hash: `hash:${p}` } : null
    );
    mockGetCalendarDenyList.mockReturnValue([]); // admin has no restrictions
    mockRemoveCalendarDeny.mockReturnValue(false);
    await expect(authCalendarDeny(['remove', 'user@example.com', 'p', 'cal1', '--current-pass', 'admin'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('NOT_FOUND');
  });

  it('remove: exits with AUTH_PASS_WRONG when pass not found', async () => {
    mockFindPassEntry.mockReturnValue(null);
    await expect(authCalendarDeny(['remove', 'user@example.com', 'wrong', 'cal1', '--current-pass', 'admin'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('remove: exits with AUTH_PASS_WRONG when --current-pass is missing', async () => {
    await expect(authCalendarDeny(['remove', 'user@example.com', 'p', 'cal1'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('remove: exits with AUTH_PASS_WRONG when --current-pass is wrong', async () => {
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'p' ? { hash: 'hash:p' } : null
    );
    await expect(authCalendarDeny(['remove', 'user@example.com', 'p', 'cal1', '--current-pass', 'badpass'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('remove: exits with ACCESS_DENIED when --current-pass lacks access to the calendar', async () => {
    mockFindPassEntry.mockImplementation((_: unknown, p: string) =>
      p === 'p' || p === 'restricted' ? { hash: `hash:${p}` } : null
    );
    mockGetCalendarDenyList.mockReturnValue(['cal1']); // restricted pass also cannot access cal1
    await expect(authCalendarDeny(['remove', 'user@example.com', 'p', 'cal1', '--current-pass', 'restricted'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('ACCESS_DENIED');
  });

  it('list: shows calendarDeny for the pass', async () => {
    mockGetCalendarDenyList.mockReturnValue(['cal1', 'cal2']);
    await authCalendarDeny(['list', 'user@example.com', 'p']);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.calendarDeny).toEqual(['cal1', 'cal2']);
  });

  it('list: exits with AUTH_PASS_WRONG when pass not found', async () => {
    mockFindPassEntry.mockReturnValue(null);
    await expect(authCalendarDeny(['list', 'user@example.com', 'wrong'])).rejects.toThrow('exit');
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error).toBe('AUTH_PASS_WRONG');
  });

  it('exits with USAGE on unknown sub-subcommand', async () => {
    await expect(authCalendarDeny(['unknown', 'user@example.com', 'p'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
