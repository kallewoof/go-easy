import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authList, authAdd, authRemove, parseFlags, positionals, main } from '../../src/bin/easy.js';

vi.mock('../../src/auth.js', () => ({
  listAllAccounts: vi.fn().mockResolvedValue([{ email: 'user@example.com', tokens: {} }]),
  clearAuthCache: vi.fn(),
}));

vi.mock('../../src/auth-store.js', () => ({
  readAccountStore: vi.fn().mockImplementation(() => Promise.resolve({
    version: 1,
    accounts: [{ email: 'user@example.com', tokens: { combined: {} } }],
  })),
  writeAccountStore: vi.fn().mockResolvedValue(undefined),
  readCredentials: vi.fn().mockResolvedValue({ clientId: 'id', clientSecret: 'secret' }),
  findAccount: vi.fn((store: { accounts: Array<{ email: string }> }, email: string) =>
    store.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null
  ),
  removeAccount: vi.fn((store: { accounts: Array<{ email: string }> }, email: string) => {
    store.accounts = store.accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  }),
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

// ─── main() dispatch ───────────────────────────────────────

describe('main() dispatch', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
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
});
