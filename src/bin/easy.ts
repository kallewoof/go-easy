#!/usr/bin/env node
/**
 * go-easy — Umbrella CLI for cross-service operations.
 *
 * Usage:
 *   go-easy auth list                     — List configured accounts
 *   go-easy auth add <email>              — Add or upgrade account (Phase 2)
 *   go-easy auth remove <email> --confirm — Remove account (Phase 3)
 */

import {
  listAllAccounts,
  clearAuthCache,
} from '../auth.js';
import {
  readAccountStore,
  writeAccountStore,
  readCredentials,
  readAllCredentials,
  importCredentials,
  appendCredentials,
  findAccount,
  removeAccount,
  hashPass,
  getConfigDir,
} from '../auth-store.js';
import type { GoEasyAccount } from '../auth-store.js';
import { authAdd as authAddFlow } from '../auth-flow.js';
import { GoEasyError, SafetyError } from '../errors.js';
import { setSafetyContext } from '../safety.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export function usage(): never {
  console.log(
    JSON.stringify({
      error: 'USAGE',
      message: 'go-easy <command> [args...]',
      commands: {
        'auth list [--pass <phrase>]': 'List accounts visible with the given passphrase (unprotected accounts always shown)',
        'auth add <email> [--credentials <name|index>]': 'Add or upgrade an account (starts auth flow)',
        'auth remove <email> --confirm': 'Remove an account',
        'auth pass-set <email> <new-passphrase> [--current-pass <phrase>]': 'Protect an account with a passphrase (--current-pass required if one is already set)',
        'auth pass-remove <email> [--current-pass <phrase>]': 'Remove passphrase protection (--current-pass required if one is set)',
        'credentials list': 'List configured OAuth credentials',
        'credentials set <file>': 'Set credentials from a Google-format JSON file (replaces existing)',
        'credentials append <file> [--name <name>]': 'Append credentials from a file (for multiple OAuth apps)',
      },
    })
  );
  process.exit(1);
}

/** Parse --key=value and --key value flags from args */
export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] !== undefined) {
      flags[m[1]] = m[2];
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[m[1]] = argv[++i];
    } else {
      flags[m[1]] = 'true';
    }
  }
  return flags;
}

/** Positional args (non-flag) */
export function positionals(argv: string[]): string[] {
  const consumed = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] === undefined && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      consumed.add(++i);
    }
  }
  return argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length < 1) usage();

  const [group, subcommand, ...rest] = args;

  switch (group) {
    case 'auth':
      switch (subcommand) {
        case 'list':
          await authList(rest);
          break;
        case 'add':
          await authAdd(rest);
          break;
        case 'remove':
          await authRemove(rest);
          break;
        case 'pass-set':
          await authPassSet(rest);
          break;
        case 'pass-remove':
          await authPassRemove(rest);
          break;
        default:
          usage();
      }
      break;

    case 'credentials':
      switch (subcommand) {
        case 'list':
          await credentialsList();
          break;
        case 'set':
          await credentialsSet(rest);
          break;
        case 'append':
          await credentialsAppend(rest);
          break;
        default:
          usage();
      }
      break;

    default:
      usage();
  }
}

// ─── auth list ─────────────────────────────────────────────

export async function authList(argv: string[] = []): Promise<void> {
  const flags = parseFlags(argv);
  const passes = flags.pass ? flags.pass.split(',') : [];
  const accounts = await listAllAccounts(passes);
  console.log(JSON.stringify({ accounts }, null, 2));
}

// ─── auth add ──────────────────────────────────────────────

export async function authAdd(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const flags = parseFlags(argv);
  const email = pos[0];
  const credentialsSelector = flags.credentials;

  if (!email) {
    console.log(
      JSON.stringify({
        error: 'USAGE',
        message: 'go-easy auth add <email> [--credentials <name>]',
      })
    );
    process.exit(1);
  }

  const result = await authAddFlow(email, credentialsSelector);
  console.log(JSON.stringify(result, null, 2));
}

// ─── auth remove ───────────────────────────────────────────

export async function authRemove(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const flags = parseFlags(argv);
  const email = pos[0];

  if (!email) {
    console.log(
      JSON.stringify({
        error: 'USAGE',
        message: 'go-easy auth remove <email> --confirm',
      })
    );
    process.exit(1);
  }

  const store = await readAccountStore();
  if (!store) {
    console.log(
      JSON.stringify({
        error: 'AUTH_NO_ACCOUNT',
        message: 'No accounts configured',
      })
    );
    process.exit(1);
  }

  const account = findAccount(store, email);
  if (!account) {
    console.log(
      JSON.stringify({
        error: 'AUTH_NO_ACCOUNT',
        message: `Account "${email}" not found`,
      })
    );
    process.exit(1);
  }

  // Safety gate
  if (flags.confirm !== 'true') {
    console.log(
      JSON.stringify({
        blocked: true,
        operation: 'go-easy.auth.remove',
        description: `Remove account ${account.email} and all its tokens`,
        hint: 'Add --confirm to execute',
      })
    );
    process.exit(2);
  }

  removeAccount(store, email);
  await writeAccountStore(store);
  clearAuthCache();

  console.log(
    JSON.stringify({
      ok: true,
      removed: account.email,
    })
  );
}

// ─── auth pass-set ─────────────────────────────────────────

export async function authPassSet(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const flags = parseFlags(argv);
  const email = pos[0];
  const phrase = pos[1];

  if (!email || !phrase) {
    console.log(JSON.stringify({ error: 'USAGE', message: 'go-easy auth pass-set <email> <new-passphrase> [--current-pass <phrase>]' }));
    process.exit(1);
  }

  const store = await readAccountStore();
  if (!store) {
    console.log(JSON.stringify({ error: 'AUTH_NO_ACCOUNT', message: 'No accounts configured' }));
    process.exit(1);
  }

  const account = findAccount(store, email);
  if (!account) {
    console.log(JSON.stringify({ error: 'AUTH_NO_ACCOUNT', message: `Account "${email}" not found` }));
    process.exit(1);
  }

  if (account.passHash) {
    const currentPass = flags['current-pass'];
    if (!currentPass || hashPass(currentPass) !== account.passHash) {
      console.log(JSON.stringify({ error: 'AUTH_PASS_WRONG', message: 'Current passphrase required: --current-pass <phrase>' }));
      process.exit(1);
    }
  }

  account.passHash = hashPass(phrase);
  await writeAccountStore(store);
  console.log(JSON.stringify({ ok: true, email: account.email, passProtected: true }));
}

// ─── auth pass-remove ──────────────────────────────────────

export async function authPassRemove(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const flags = parseFlags(argv);
  const email = pos[0];

  if (!email) {
    console.log(JSON.stringify({ error: 'USAGE', message: 'go-easy auth pass-remove <email> [--current-pass <phrase>]' }));
    process.exit(1);
  }

  const store = await readAccountStore();
  if (!store) {
    console.log(JSON.stringify({ error: 'AUTH_NO_ACCOUNT', message: 'No accounts configured' }));
    process.exit(1);
  }

  const account = findAccount(store, email);
  if (!account) {
    console.log(JSON.stringify({ error: 'AUTH_NO_ACCOUNT', message: `Account "${email}" not found` }));
    process.exit(1);
  }

  if (account.passHash) {
    const currentPass = flags['current-pass'];
    if (!currentPass || hashPass(currentPass) !== account.passHash) {
      console.log(JSON.stringify({ error: 'AUTH_PASS_WRONG', message: 'Current passphrase required: --current-pass <phrase>' }));
      process.exit(1);
    }
  }

  delete account.passHash;
  await writeAccountStore(store);
  console.log(JSON.stringify({ ok: true, email: account.email, passProtected: false }));
}

// ─── credentials list ──────────────────────────────────────

export async function credentialsList(): Promise<void> {
  const entries = await readAllCredentials();
  if (entries.length === 0) {
    console.log(
      JSON.stringify({
        credentials: [],
        configDir: getConfigDir(),
        hint: `No credentials configured. Run: go-easy credentials set <path-to-google-credentials.json>`,
      }, null, 2)
    );
    return;
  }
  console.log(
    JSON.stringify({
      credentials: entries.map((e, i) => ({
        index: i,
        name: e.name ?? null,
        clientId: e.clientId,
      })),
      configDir: getConfigDir(),
    }, null, 2)
  );
}

// ─── credentials set ───────────────────────────────────────

export async function credentialsSet(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const file = pos[0];

  if (!file) {
    console.log(
      JSON.stringify({
        error: 'USAGE',
        message: 'go-easy credentials set <path-to-credentials.json>',
      })
    );
    process.exit(1);
  }

  try {
    const entry = await importCredentials(file);
    console.log(
      JSON.stringify({
        ok: true,
        clientId: entry.clientId,
        configDir: getConfigDir(),
      }, null, 2)
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        error: 'INVALID_CREDENTIALS',
        message: err instanceof Error ? err.message : String(err),
        file,
      })
    );
    process.exit(1);
  }
}

// ─── credentials append ────────────────────────────────────

export async function credentialsAppend(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const flags = parseFlags(argv);
  const file = pos[0];
  const name = flags.name;

  if (!file) {
    console.log(
      JSON.stringify({
        error: 'USAGE',
        message: 'go-easy credentials append <path-to-credentials.json> [--name <name>]',
      })
    );
    process.exit(1);
  }

  try {
    const entry = await appendCredentials(file, name);
    const all = await readAllCredentials();
    console.log(
      JSON.stringify({
        ok: true,
        appended: { clientId: entry.clientId, name: entry.name ?? null },
        total: all.length,
        configDir: getConfigDir(),
      }, null, 2)
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        error: 'INVALID_CREDENTIALS',
        message: err instanceof Error ? err.message : String(err),
        file,
      })
    );
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((err) => {
    if (err instanceof GoEasyError) {
      console.error(JSON.stringify(err.toJSON()));
    } else {
      console.error(
        JSON.stringify({
          error: 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
    process.exit(1);
  });
}
