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
  findAccount,
  removeAccount,
} from '../auth-store.js';
import type { GoEasyAccount } from '../auth-store.js';
import { authAdd as authAddFlow } from '../auth-flow.js';
import { GoEasyError, SafetyError } from '../errors.js';
import { setSafetyContext } from '../safety.js';
import { fileURLToPath } from 'node:url';

export function usage(): never {
  console.log(
    JSON.stringify({
      error: 'USAGE',
      message: 'go-easy <command> [args...]',
      commands: {
        'auth list': 'List configured accounts and their scopes',
        'auth add <email>': 'Add or upgrade an account (starts auth flow)',
        'auth remove <email> --confirm': 'Remove an account',
      },
    })
  );
  process.exit(1);
}

/** Parse --key=value flags from args */
export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? 'true';
  }
  return flags;
}

/** Positional args (non-flag) */
export function positionals(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('--'));
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length < 1) usage();

  const [group, subcommand, ...rest] = args;

  if (group !== 'auth') {
    usage();
  }

  switch (subcommand) {
    case 'list':
      await authList();
      break;

    case 'add':
      await authAdd(rest);
      break;

    case 'remove':
      await authRemove(rest);
      break;

    default:
      usage();
  }
}

// ─── auth list ─────────────────────────────────────────────

export async function authList(): Promise<void> {
  const accounts = await listAllAccounts();
  console.log(JSON.stringify({ accounts }, null, 2));
}

// ─── auth add ──────────────────────────────────────────────

export async function authAdd(argv: string[]): Promise<void> {
  const pos = positionals(argv);
  const email = pos[0];

  if (!email) {
    console.log(
      JSON.stringify({
        error: 'USAGE',
        message: 'go-easy auth add <email>',
      })
    );
    process.exit(1);
  }

  const result = await authAddFlow(email);
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

// ─── Main ──────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
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
