import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scopeToService,
  buildAuthUrl,
  exchangeCodeForToken,
  updateAccountStore,
  readCredentials,
} from '../src/auth-server.js';

// ─── scopeToService ────────────────────────────────────────

describe('scopeToService', () => {
  it('maps known scopes to service names', () => {
    expect(scopeToService('https://mail.google.com/')).toBe('gmail');
    expect(scopeToService('https://www.googleapis.com/auth/drive')).toBe('drive');
    expect(scopeToService('https://www.googleapis.com/auth/calendar')).toBe('calendar');
    expect(scopeToService('https://www.googleapis.com/auth/tasks')).toBe('tasks');
  });

  it('returns the raw scope string for unknown scopes', () => {
    const unknown = 'https://www.googleapis.com/auth/unknown';
    expect(scopeToService(unknown)).toBe(unknown);
  });
});

// ─── buildAuthUrl ──────────────────────────────────────────

describe('buildAuthUrl', () => {
  it('targets accounts.google.com exclusively', () => {
    const url = new URL(buildAuthUrl('client-id', 'http://127.0.0.1:12345/callback', 'user@example.com'));
    expect(url.hostname).toBe('accounts.google.com');
  });

  it('includes all four required scopes', () => {
    const url = new URL(buildAuthUrl('client-id', 'http://127.0.0.1:12345/callback', 'user@example.com'));
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://mail.google.com/');
    expect(scope).toContain('https://www.googleapis.com/auth/drive');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar');
    expect(scope).toContain('https://www.googleapis.com/auth/tasks');
  });

  it('sets access_type=offline and prompt=consent to ensure a refresh token', () => {
    const url = new URL(buildAuthUrl('client-id', 'http://127.0.0.1:12345/callback', 'user@example.com'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('uses the provided login_hint', () => {
    const url = new URL(buildAuthUrl('client-id', 'http://127.0.0.1:12345/callback', 'user@example.com'));
    expect(url.searchParams.get('login_hint')).toBe('user@example.com');
  });

  it('uses the provided redirect_uri verbatim', () => {
    const redirectUri = 'http://127.0.0.1:54321/callback';
    const url = new URL(buildAuthUrl('client-id', redirectUri, 'user@example.com'));
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
  });
});

// ─── exchangeCodeForToken ──────────────────────────────────

describe('exchangeCodeForToken', () => {
  const mockTokenResponse = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    scope: 'https://mail.google.com/ https://www.googleapis.com/auth/drive',
    token_type: 'Bearer',
    expires_in: 3600,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTokenResponse),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the request only to https://oauth2.googleapis.com/token', async () => {
    await exchangeCodeForToken('code', 'http://127.0.0.1/callback', 'client-id', 'client-secret');
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
  });

  it('uses POST with form-encoded body', async () => {
    await exchangeCodeForToken('code', 'http://127.0.0.1/callback', 'client-id', 'client-secret');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit & { headers: Record<string, string> }).headers['Content-Type'])
      .toBe('application/x-www-form-urlencoded');
  });

  it('includes the authorization code and client credentials in the body', async () => {
    await exchangeCodeForToken('my-code', 'http://127.0.0.1/callback', 'my-client', 'my-secret');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get('code')).toBe('my-code');
    expect(body.get('client_id')).toBe('my-client');
    expect(body.get('client_secret')).toBe('my-secret');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('returns the token response on success', async () => {
    const result = await exchangeCodeForToken('code', 'http://127.0.0.1/callback', 'id', 'secret');
    expect(result.refresh_token).toBe('refresh-token');
    expect(result.access_token).toBe('access-token');
  });

  it('throws on non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    }));
    await expect(
      exchangeCodeForToken('bad-code', 'http://127.0.0.1/callback', 'id', 'secret')
    ).rejects.toThrow('Token exchange failed (400)');
  });
});

// ─── readCredentials → buildAuthUrl integration ────────────

describe('readCredentials → buildAuthUrl integration', () => {
  it('Google-emitted installed format produces a defined client_id in the auth URL', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ installed: { client_id: 'my-client-id', client_secret: 'csec' } }) as never
    );
    const creds = await readCredentials();
    const url = new URL(buildAuthUrl(creds!.clientId, 'http://127.0.0.1:12345/callback', 'user@example.com'));
    expect(url.searchParams.get('client_id')).toBe('my-client-id');
  });
});

// ─── updateAccountStore ────────────────────────────────────
// vi.mock is hoisted, so this must live at the module's top scope.
// The factory runs once; individual tests control behaviour via vi.mocked().

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

describe('updateAccountStore', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    // Reset call history between tests
    const { writeFile } = await import('node:fs/promises');
    vi.mocked(writeFile).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes only to the local accounts file, not to any network endpoint', async () => {
    const { writeFile } = await import('node:fs/promises');
    await updateAccountStore('refresh-token', ['https://mail.google.com/'], 'user@example.com');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    const [writtenPath] = vi.mocked(writeFile).mock.calls[0];
    expect(String(writtenPath)).toContain('accounts.json');
  });

  it('stores the token under the normalized (lowercase) email address', async () => {
    const { writeFile } = await import('node:fs/promises');
    await updateAccountStore('my-refresh', ['https://mail.google.com/'], 'User@Example.COM');

    const writtenContent = String(vi.mocked(writeFile).mock.calls[0][1]);
    const store = JSON.parse(writtenContent);
    expect(store.accounts[0].email).toBe('user@example.com');
  });

  it('stores the refresh token in the combined token slot', async () => {
    const { writeFile } = await import('node:fs/promises');
    await updateAccountStore('my-refresh', ['https://mail.google.com/'], 'user@example.com');

    const writtenContent = String(vi.mocked(writeFile).mock.calls[0][1]);
    const store = JSON.parse(writtenContent);
    expect(store.accounts[0].tokens.combined.refreshToken).toBe('my-refresh');
  });
});
