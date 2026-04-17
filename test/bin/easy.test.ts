import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authList, authAdd, authRemove, parseFlags, positionals } from '../../src/bin/easy.js';

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

describe('authList', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('outputs accounts as JSON', async () => {
    await authList();
    expect(logSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('accounts');
    expect(Array.isArray(output.accounts)).toBe(true);
  });
});

describe('authAdd', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('outputs the auth flow result as JSON', async () => {
    await authAdd(['user@example.com']);
    expect(logSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.status).toBe('started');
  });

  it('exits with usage error when no email is provided', async () => {
    await expect(authAdd([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('authRemove', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('removes account and outputs ok:true when --confirm is provided', async () => {
    await authRemove(['user@example.com', '--confirm']);
    expect(logSpy).toHaveBeenCalledOnce();
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
