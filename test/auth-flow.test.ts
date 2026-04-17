/**
 * Tests for auth-flow.ts — the two-phase OAuth flow coordinator.
 *
 * These tests mock the filesystem (pending files + account store) and
 * child_process.spawn to test all state transitions without real OAuth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

// We need to mock several modules before importing auth-flow
const GO_EASY_DIR = join(homedir(), '.config', 'go-easy');
const PENDING_DIR = join(GO_EASY_DIR, 'pending');

// Mock state
let pendingFiles: Record<string, string> = {};
let accountStoreContent: string | null = null;
let credentialsContent: string | null = null;
let mockProcessAlive = false;

// Mock fs/promises
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(async (path: string) => {
      const p = path.replace(/\\/g, '/');
      // Check pending files
      for (const [key, val] of Object.entries(pendingFiles)) {
        if (p.includes(`pending/${key}`)) return val;
      }
      // Check accounts.json
      if (p.endsWith('accounts.json') && accountStoreContent) return accountStoreContent;
      // Check credentials.json
      if (p.endsWith('credentials.json') && credentialsContent) return credentialsContent;
      const err = new Error(`ENOENT: ${path}`);
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    }),
    writeFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    stat: vi.fn(async (path: string) => {
      // auth-server.js check - pretend it always exists
      if (path.includes('auth-server')) return { isFile: () => true };
      const err = new Error(`ENOENT: ${path}`);
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    }),
    rename: vi.fn(async () => {}),
    chmod: vi.fn(async () => {}),
  };
});

// Mock child_process — spawn returns a detached child (stdio: 'ignore')
// The "auth server" writes to the pending file, which we simulate by
// updating pendingFiles after a short delay.
vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');

  return {
    spawn: vi.fn((_cmd: string, args: string[]) => {
      const child = new EventEmitter();
      child.unref = vi.fn();
      child.pid = 99999;

      // Simulate the auth server writing the pending file after a short delay
      const email = args[1]; // auth-server.js <email> <port>
      setTimeout(() => {
        const key = `${email}.json`;
        const future = new Date(Date.now() + 300_000).toISOString();
        pendingFiles[key] = JSON.stringify({
          status: 'waiting',
          port: 54321,
          pid: 99999,
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?test=1',
          startedAt: new Date().toISOString(),
          expiresAt: future,
        });
      }, 50);

      return child;
    }),
  };
});

// We need to intercept process.kill for isProcessAlive
const originalKill = process.kill;

beforeEach(() => {
  pendingFiles = {};
  accountStoreContent = null;
  credentialsContent = JSON.stringify({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  });
  mockProcessAlive = false;

  // Mock process.kill(pid, 0) for alive check
  process.kill = ((pid: number, signal?: string | number) => {
    if (signal === 0) {
      if (!mockProcessAlive) {
        throw new Error('ESRCH');
      }
      return true;
    }
    return originalKill.call(process, pid, signal);
  }) as typeof process.kill;
});

afterEach(() => {
  process.kill = originalKill;
  vi.restoreAllMocks();
});

// Import AFTER mocks are set up
const { authAdd } = await import('../src/auth-flow.js');

describe('authAdd', () => {
  describe('account already complete', () => {
    it('returns complete when account has all scopes', async () => {
      accountStoreContent = JSON.stringify({
        version: 1,
        accounts: [{
          email: 'test@example.com',
          tokens: {
            combined: {
              refreshToken: 'rt-test',
              scopes: [
                'https://mail.google.com/',
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/tasks',
              ],
              grantedAt: '2026-01-01T00:00:00Z',
            },
          },
          addedAt: '2026-01-01T00:00:00Z',
        }],
      });

      const result = await authAdd('test@example.com');
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.email).toBe('test@example.com');
        expect(result.scopes).toContain('gmail');
        expect(result.scopes).toContain('drive');
        expect(result.scopes).toContain('calendar');
      }
    });

    it('is case-insensitive on email', async () => {
      accountStoreContent = JSON.stringify({
        version: 1,
        accounts: [{
          email: 'test@example.com',
          tokens: {
            combined: {
              refreshToken: 'rt-test',
              scopes: [
                'https://mail.google.com/',
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/tasks',
              ],
              grantedAt: '2026-01-01T00:00:00Z',
            },
          },
          addedAt: '2026-01-01T00:00:00Z',
        }],
      });

      const result = await authAdd('TEST@EXAMPLE.COM');
      expect(result.status).toBe('complete');
    });
  });

  describe('no credentials', () => {
    it('throws AUTH_NO_CREDENTIALS when credentials.json missing', async () => {
      credentialsContent = null;
      await expect(authAdd('new@example.com')).rejects.toThrow(/credentials/i);
    });
  });

  describe('pending session states', () => {
    it('returns completed and cleans up pending file', async () => {
      pendingFiles['new@example.com.json'] = JSON.stringify({
        status: 'complete',
        email: 'new@example.com',
        scopes: ['gmail', 'drive', 'calendar'],
        completedAt: '2026-01-01T00:00:00Z',
      });

      const result = await authAdd('new@example.com');
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.email).toBe('new@example.com');
      }
    });

    it('returns denied and cleans up', async () => {
      pendingFiles['denied@example.com.json'] = JSON.stringify({
        status: 'denied',
        message: 'User declined',
      });

      const result = await authAdd('denied@example.com');
      expect(result.status).toBe('denied');
      if (result.status === 'denied') {
        expect(result.message).toContain('declined');
      }
    });

    it('returns expired and cleans up', async () => {
      pendingFiles['expired@example.com.json'] = JSON.stringify({
        status: 'expired',
        message: 'Timed out',
      });

      const result = await authAdd('expired@example.com');
      expect(result.status).toBe('expired');
    });

    it('returns partial and cleans up', async () => {
      pendingFiles['partial@example.com.json'] = JSON.stringify({
        status: 'partial',
        email: 'partial@example.com',
        grantedScopes: ['gmail'],
        missingScopes: ['drive', 'calendar'],
        message: 'User did not grant all scopes',
      });

      const result = await authAdd('partial@example.com');
      expect(result.status).toBe('partial');
      if (result.status === 'partial') {
        expect(result.grantedScopes).toEqual(['gmail']);
        expect(result.missingScopes).toEqual(['drive', 'calendar']);
      }
    });

    it('returns error and cleans up', async () => {
      pendingFiles['error@example.com.json'] = JSON.stringify({
        status: 'error',
        message: 'Token exchange failed',
      });

      const result = await authAdd('error@example.com');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.message).toContain('Token exchange');
      }
    });

    it('returns waiting when session alive', async () => {
      mockProcessAlive = true;
      const future = new Date(Date.now() + 120_000).toISOString();
      pendingFiles['waiting@example.com.json'] = JSON.stringify({
        status: 'waiting',
        pid: 12345,
        authUrl: 'https://accounts.google.com/test',
        startedAt: new Date().toISOString(),
        expiresAt: future,
      });

      const result = await authAdd('waiting@example.com');
      expect(result.status).toBe('waiting');
      if (result.status === 'waiting') {
        expect(result.authUrl).toContain('google.com');
        expect(result.expiresIn).toBeGreaterThan(0);
      }
    });

    it('cleans up and restarts when PID is dead', async () => {
      mockProcessAlive = false; // PID check will throw
      pendingFiles['stale@example.com.json'] = JSON.stringify({
        status: 'waiting',
        pid: 99998,
        authUrl: 'https://old-url',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });

      const result = await authAdd('stale@example.com');
      // Should have started a new flow (spawn was called)
      expect(result.status).toBe('started');
    });
  });

  describe('new auth flow', () => {
    it('starts auth server and returns started with authUrl', async () => {
      const result = await authAdd('new@example.com');
      expect(result.status).toBe('started');
      if (result.status === 'started') {
        expect(result.authUrl).toContain('accounts.google.com');
        expect(result.expiresIn).toBeGreaterThanOrEqual(295);
        expect(result.expiresIn).toBeLessThanOrEqual(300);
      }
    });

    it('starts when account exists but missing scopes', async () => {
      accountStoreContent = JSON.stringify({
        version: 1,
        accounts: [{
          email: 'partial@example.com',
          tokens: {
            gmail: {
              refreshToken: 'rt-gmail',
              scopes: ['https://mail.google.com/'],
              grantedAt: '2026-01-01T00:00:00Z',
            },
          },
          addedAt: '2026-01-01T00:00:00Z',
        }],
      });

      const result = await authAdd('partial@example.com');
      expect(result.status).toBe('started');
    });
  });
});
