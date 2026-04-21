import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GmailMessage } from './types.js';

export interface GmailCacheEntry extends GmailMessage {
  fetched_at: string;
}

function getCacheDir(): string {
  return join(homedir(), '.config', 'go-easy', 'cache', 'gmail');
}

function getCachePath(account: string): string {
  const safe = account.replace(/[^a-zA-Z0-9@._-]/g, '_');
  return join(getCacheDir(), `${safe}.json`);
}

function loadCache(account: string): Record<string, GmailCacheEntry> {
  const path = getCachePath(account);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, GmailCacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(account: string, cache: Record<string, GmailCacheEntry>): void {
  const dir = getCacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getCachePath(account), JSON.stringify(cache, null, 2), 'utf-8');
}

export function cacheMessages(account: string, messages: GmailMessage[]): void {
  const cache = loadCache(account);
  const now = new Date().toISOString();
  for (const msg of messages) {
    cache[msg.id] = { ...msg, fetched_at: now };
  }
  saveCache(account, cache);
}

export function getCachedMessage(account: string, id: string): GmailCacheEntry | undefined {
  return loadCache(account)[id];
}

/** Search cache entries by free text (subject, from, to, snippet, body.text). */
export function queryCache(account: string, text?: string): GmailCacheEntry[] {
  const entries = Object.values(loadCache(account));
  if (!text) return entries;
  const lower = text.toLowerCase();
  return entries.filter(
    (e) =>
      e.subject.toLowerCase().includes(lower) ||
      e.from.toLowerCase().includes(lower) ||
      e.snippet.toLowerCase().includes(lower) ||
      e.to.some((t) => t.toLowerCase().includes(lower)) ||
      (e.body.text?.toLowerCase().includes(lower) ?? false)
  );
}
