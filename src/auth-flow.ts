/**
 * auth-flow — Two-phase OAuth flow for agent-compatible auth.
 *
 * Phase 1 (start): Spawn background auth server, return URL.
 * Phase 2 (poll): Check pending file for completion status.
 *
 * The agent calls `npx go-easy auth add <email>` which:
 *   - On first call: starts the server, returns { status: "started", authUrl }
 *   - On subsequent calls: polls and returns current status
 *   - When user completes auth: returns { status: "complete" }
 */

import { readFile, unlink, stat } from 'node:fs/promises';
import { join, resolve as pathResolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getPendingDir,
  readAccountStore,
  readCredentials,
  findAccount,
} from './auth-store.js';
import { ALL_SCOPES, scopeToService } from './scopes.js';
import { AuthError } from './errors.js';

// ─── Types ─────────────────────────────────────────────────

export type AuthFlowStatus =
  | { status: 'started'; authUrl: string; expiresIn: number }
  | { status: 'waiting'; authUrl: string; expiresIn: number }
  | { status: 'complete'; email: string; scopes: string[] }
  | { status: 'partial'; email: string; grantedScopes: string[]; missingScopes: string[]; message: string }
  | { status: 'denied'; message: string }
  | { status: 'expired'; message: string }
  | { status: 'error'; message: string };

interface PendingSession {
  status: string;
  port?: number;
  pid?: number;
  authUrl?: string;
  startedAt?: string;
  expiresAt?: string;
  email?: string;
  scopes?: string[];
  grantedScopes?: string[];
  missingScopes?: string[];
  message?: string;
  completedAt?: string;
}

// ─── Public API ────────────────────────────────────────────

/**
 * Start or poll the auth flow for an email.
 *
 * This is the single entry point — handles all states:
 * - No session → start new auth server
 * - Pending session with live server → return waiting/started
 * - Completed session → return result, clean up
 * - Stale session (dead pid) → clean up, restart
 */
export async function authAdd(email: string): Promise<AuthFlowStatus> {
  // Check if already fully configured
  const store = await readAccountStore();
  if (store) {
    const account = findAccount(store, email);
    if (account?.tokens.combined) {
      const hasAll = ALL_SCOPES.every((s) =>
        account.tokens.combined!.scopes.includes(s)
      );
      if (hasAll) {
        // Clean up any stale pending file
        await cleanupPending(email);
        return {
          status: 'complete',
          email: account.email,
          scopes: account.tokens.combined.scopes.map(
            (s) => scopeToService(s) ?? s
          ),
        };
      }
    }
  }

  // Check credentials exist
  const creds = await readCredentials();
  if (!creds) {
    throw new AuthError('AUTH_NO_CREDENTIALS', {
      message: 'OAuth client credentials not found at ~/.config/go-easy/credentials.json',
    });
  }

  // Check for pending session
  const pending = await readPending(email);

  if (pending) {
    // Terminal states: return and clean up
    if (pending.status === 'complete') {
      await cleanupPending(email);
      return {
        status: 'complete',
        email: pending.email ?? email,
        scopes: pending.scopes ?? [],
      };
    }
    if (pending.status === 'partial') {
      await cleanupPending(email);
      return {
        status: 'partial',
        email: pending.email ?? email,
        grantedScopes: pending.grantedScopes ?? [],
        missingScopes: pending.missingScopes ?? [],
        message: pending.message ?? 'Partial authorization',
      };
    }
    if (pending.status === 'denied') {
      await cleanupPending(email);
      return {
        status: 'denied',
        message: pending.message ?? 'User declined authorization',
      };
    }
    if (pending.status === 'expired') {
      await cleanupPending(email);
      return {
        status: 'expired',
        message: pending.message ?? 'Authorization timed out',
      };
    }
    if (pending.status === 'error') {
      await cleanupPending(email);
      return {
        status: 'error',
        message: pending.message ?? 'Unknown error during authorization',
      };
    }

    // Active session (waiting/started)
    if (pending.status === 'waiting' || pending.status === 'started') {
      // Check if the server process is still alive
      if (pending.pid && isProcessAlive(pending.pid)) {
        // Check if expired by time
        if (pending.expiresAt && new Date(pending.expiresAt) < new Date()) {
          await cleanupPending(email);
          return {
            status: 'expired',
            message: 'Authorization timed out',
          };
        }
        // Still waiting — return current state
        const expiresIn = pending.expiresAt
          ? Math.max(0, Math.floor((new Date(pending.expiresAt).getTime() - Date.now()) / 1000))
          : 300;
        return {
          status: 'waiting',
          authUrl: pending.authUrl ?? '',
          expiresIn,
        };
      }
      // PID is dead — stale session, clean up and restart
      await cleanupPending(email);
    }
  }

  // Start new auth flow
  return startAuthServer(email);
}

// ─── Internal ──────────────────────────────────────────────

function pendingFilePath(email: string): string {
  return join(getPendingDir(), `${email.toLowerCase().trim()}.json`);
}

async function readPending(email: string): Promise<PendingSession | null> {
  try {
    const raw = await readFile(pendingFilePath(email), 'utf-8');
    return JSON.parse(raw) as PendingSession;
  } catch {
    return null;
  }
}

async function cleanupPending(email: string): Promise<void> {
  try {
    await unlink(pendingFilePath(email));
  } catch {
    // Already deleted or never existed
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn the auth-server as a fully detached background process.
 *
 * Uses stdio: 'ignore' so the child has no pipe ties to the parent.
 * The child writes its startup info to the pending/<email>.json file.
 * We poll that file briefly to get the authUrl.
 */
async function startAuthServer(email: string): Promise<AuthFlowStatus> {
  // Resolve the auth-server script path
  const thisDir = typeof __dirname !== 'undefined'
    ? __dirname
    : fileURLToPath(new URL('.', import.meta.url));
  const serverScript = join(thisDir, 'auth-server.js');

  // Verify the script exists
  try {
    await stat(serverScript);
  } catch {
    throw new AuthError('AUTH_ERROR', {
      message: `Auth server script not found: ${serverScript}`,
    });
  }

  // Clean up any old pending file first
  await cleanupPending(email);

  // Spawn fully detached — no pipes, child survives parent exit
  const child = spawn(
    process.execPath, // node.exe
    [serverScript, email.toLowerCase().trim(), '0'],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  child.unref();

  // Poll the pending file for the server's startup info
  const maxWait = 10_000; // 10s
  const pollInterval = 100; // 100ms
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await sleep(pollInterval);
    const pending = await readPending(email);
    if (pending && pending.authUrl) {
      return {
        status: 'started',
        authUrl: pending.authUrl,
        expiresIn: pending.expiresAt
          ? Math.max(0, Math.floor((new Date(pending.expiresAt).getTime() - Date.now()) / 1000))
          : 300,
      };
    }
    // If the server wrote an error/terminal state, return it
    if (pending && pending.status === 'error') {
      return {
        status: 'error',
        message: pending.message ?? 'Auth server failed to start',
      };
    }
  }

  throw new AuthError('AUTH_ERROR', {
    message: 'Auth server did not start within 10 seconds',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
