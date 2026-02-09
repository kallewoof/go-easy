#!/usr/bin/env node
/**
 * auth-server — Background loopback OAuth callback server.
 *
 * Spawned as a detached child by auth-flow.ts.
 * Listens on 127.0.0.1:<port>, waits for Google OAuth callback,
 * exchanges code for token, writes result to pending/<email>.json,
 * updates accounts.json.
 *
 * Communicates with parent via:
 *   1. stdout: JSON line with { port, pid, authUrl } (parent reads this, then detaches)
 *   2. pending/<email>.json file (poll target for subsequent CLI calls)
 *
 * Usage (not meant to be called directly):
 *   node auth-server.js <email> <port>
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { URL } from 'node:url';
import type { AddressInfo } from 'node:net';

// ─── Constants ─────────────────────────────────────────────

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (D6)
const GO_EASY_DIR = join(homedir(), '.go-easy');
const PENDING_DIR = join(GO_EASY_DIR, 'pending');
const CREDENTIALS_FILE = join(GO_EASY_DIR, 'credentials.json');
const ACCOUNTS_FILE = join(GO_EASY_DIR, 'accounts.json');

// All scopes requested by default (D2)
const ALL_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

// ─── Args ──────────────────────────────────────────────────

const email = process.argv[2];
const requestedPort = parseInt(process.argv[3] || '0', 10);

if (!email) {
  process.stderr.write('Usage: auth-server <email> [port]\n');
  process.exit(1);
}

// ─── HTML responses ────────────────────────────────────────

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0fdf4;">
<div style="text-align:center;max-width:400px;">
<h1 style="color:#16a34a;">✅ Authorization successful!</h1>
<p>You can close this tab and return to your AI assistant.</p>
</div>
</body>
</html>`;

const DENIED_HTML = `<!DOCTYPE html>
<html>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef2f2;">
<div style="text-align:center;max-width:400px;">
<h1 style="color:#dc2626;">❌ Authorization declined</h1>
<p>You can close this tab. Run <code>npx go-easy auth add ${email}</code> to try again.</p>
</div>
</body>
</html>`;

const PARTIAL_HTML = (granted: string[], missing: string[]) => `<!DOCTYPE html>
<html>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fffbeb;">
<div style="text-align:center;max-width:500px;">
<h1 style="color:#d97706;">⚠️ Partial authorization</h1>
<p>Some permissions were not granted. Granted: <strong>${granted.join(', ')}</strong></p>
<p>Missing: <strong>${missing.join(', ')}</strong></p>
<p>Run <code>npx go-easy auth add ${email}</code> to add missing permissions.</p>
</div>
</body>
</html>`;

// ─── Helpers ───────────────────────────────────────────────

function pendingFile(): string {
  return join(PENDING_DIR, `${email.toLowerCase()}.json`);
}

async function writePending(data: Record<string, unknown>): Promise<void> {
  await mkdir(PENDING_DIR, { recursive: true });
  await writeFile(pendingFile(), JSON.stringify(data, null, 2), 'utf-8');
}

async function readCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const raw = await readFile(CREDENTIALS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function scopeToService(scope: string): string {
  if (scope === 'https://mail.google.com/') return 'gmail';
  if (scope === 'https://www.googleapis.com/auth/drive') return 'drive';
  if (scope === 'https://www.googleapis.com/auth/calendar') return 'calendar';
  if (scope === 'https://www.googleapis.com/auth/tasks') return 'tasks';
  return scope;
}

// ─── Token exchange ────────────────────────────────────────

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expires_in: number;
}> {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    scope: string;
    token_type: string;
    expires_in: number;
  }>;
}

// ─── Account store update ──────────────────────────────────

async function updateAccountStore(
  refreshToken: string,
  grantedScopes: string[]
): Promise<void> {
  // Read existing store (or create new)
  let store: { version: number; accounts: Array<Record<string, unknown>> };
  try {
    const raw = await readFile(ACCOUNTS_FILE, 'utf-8');
    store = JSON.parse(raw);
  } catch {
    store = { version: 1, accounts: [] };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  // Find or create account
  let account = store.accounts.find(
    (a: Record<string, unknown>) =>
      (a.email as string).toLowerCase() === normalizedEmail
  );

  if (!account) {
    account = {
      email: normalizedEmail,
      tokens: {},
      addedAt: now,
    };
    store.accounts.push(account);
  }

  const tokens = (account.tokens ?? {}) as Record<string, unknown>;

  // Write combined token
  tokens.combined = {
    refreshToken,
    scopes: grantedScopes,
    grantedAt: now,
  };

  // D1: Delete per-service tokens after successful upgrade
  // (only if combined has all scopes those per-service tokens had)
  for (const svc of ['gmail', 'drive', 'calendar']) {
    const svcToken = tokens[svc] as { scopes?: string[] } | undefined;
    if (svcToken?.scopes) {
      const covered = svcToken.scopes.every((s: string) => grantedScopes.includes(s));
      if (covered) {
        delete tokens[svc];
      }
    }
  }

  account.tokens = tokens;

  // Atomic write
  const tmpFile = ACCOUNTS_FILE + '.tmp';
  await writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpFile, ACCOUNTS_FILE);
}

// ─── HTTP Server ───────────────────────────────────────────

async function start(): Promise<void> {
  const creds = await readCredentials();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Only handle the callback path
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Check for error (user denied)
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DENIED_HTML);

      await writePending({
        status: 'denied',
        message: `User declined authorization: ${error}`,
        completedAt: new Date().toISOString(),
      });

      shutdown();
      return;
    }

    // Get the authorization code
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing code parameter');
      return;
    }

    try {
      const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;

      // Exchange code for token
      const tokenResponse = await exchangeCodeForToken(
        code,
        redirectUri,
        creds.clientId,
        creds.clientSecret
      );

      if (!tokenResponse.refresh_token) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:40px;">
          <h1 style="color:#dc2626;">Error: No refresh token received</h1>
          <p>Google did not return a refresh token. This can happen if the app was previously authorized.
          Try revoking access at <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>
          and running <code>npx go-easy auth add ${email}</code> again.</p>
          </body></html>`);

        await writePending({
          status: 'error',
          message: 'No refresh token received — revoke at https://myaccount.google.com/permissions and retry',
          completedAt: new Date().toISOString(),
        });

        shutdown();
        return;
      }

      // Parse granted scopes
      const grantedScopeString = tokenResponse.scope || '';
      const grantedScopes = grantedScopeString.split(' ').filter(Boolean);

      // Check for partial scopes
      const missingScopes = ALL_SCOPES.filter((s) => !grantedScopes.includes(s));

      // Update account store
      await updateAccountStore(tokenResponse.refresh_token, grantedScopes);

      if (missingScopes.length === 0) {
        // Full success
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);

        await writePending({
          status: 'complete',
          email,
          scopes: grantedScopes.map(scopeToService),
          completedAt: new Date().toISOString(),
        });
      } else {
        // Partial authorization
        const grantedNames = grantedScopes.map(scopeToService);
        const missingNames = missingScopes.map(scopeToService);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PARTIAL_HTML(grantedNames, missingNames));

        await writePending({
          status: 'partial',
          email,
          grantedScopes: grantedNames,
          missingScopes: missingNames,
          message: `User did not grant all requested scopes`,
          completedAt: new Date().toISOString(),
        });
      }

      shutdown();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500);
      res.end(`Error: ${msg}`);

      await writePending({
        status: 'error',
        message: msg,
        completedAt: new Date().toISOString(),
      });

      shutdown();
    }
  });

  // Try to listen on requested port (0 = random)
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Build Google OAuth URL
  const authUrl = buildAuthUrl(creds.clientId, redirectUri);

  // Write initial pending file
  await writePending({
    status: 'waiting',
    port,
    pid: process.pid,
    authUrl,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TIMEOUT_MS).toISOString(),
  });

  // No stdout — parent polls the pending file instead
  // (stdio is 'ignore' when spawned detached)

  // Set timeout
  const timer = setTimeout(() => {
    writePending({
      status: 'expired',
      message: `Authorization not completed within ${TIMEOUT_MS / 1000 / 60} minutes`,
      completedAt: new Date().toISOString(),
    }).finally(() => {
      shutdown();
    });
  }, TIMEOUT_MS);

  function shutdown(): void {
    clearTimeout(timer);
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 3s if close hangs
    setTimeout(() => process.exit(0), 3000).unref();
  }
}

function buildAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ALL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh_token
    login_hint: email,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ─── Go ────────────────────────────────────────────────────

start().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`auth-server error: ${msg}\n`);

  // Try to write error to pending file
  writePending({
    status: 'error',
    message: msg,
    completedAt: new Date().toISOString(),
  }).finally(() => process.exit(1));
});
