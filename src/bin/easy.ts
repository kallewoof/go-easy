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
  migrateFromLegacy,
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
import { GoEasyError, SafetyError } from '../errors.js';
import { setSafetyContext } from '../safety.js';

const args = process.argv.slice(2);

function usage(): never {
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
function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? 'true';
  }
  return flags;
}

/** Positional args (non-flag) */
function positionals(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('--'));
}

async function main(): Promise<void> {
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

async function authList(): Promise<void> {
  // Check if we need to migrate
  let store = await readAccountStore();
  let migrationResult = null;

  if (!store) {
    // Try migration from legacy stores
    migrationResult = await migrateFromLegacy();
    if (migrationResult.migrated) {
      store = await readAccountStore();
    }
  }

  const accounts = await listAllAccounts();

  const output: Record<string, unknown> = { accounts };
  if (migrationResult?.migrated) {
    output.migrated = true;
    output.migratedAccounts = migrationResult.accounts;
  }
  if (migrationResult?.warnings && migrationResult.warnings.length > 0) {
    output.warnings = migrationResult.warnings;
  }

  console.log(JSON.stringify(output, null, 2));
}

// ─── auth add ──────────────────────────────────────────────

async function authAdd(argv: string[]): Promise<void> {
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

  // Check if already fully configured
  const store = await readAccountStore();
  if (store) {
    const account = findAccount(store, email);
    if (account?.tokens.combined) {
      // Already has combined token — check if all scopes present
      const { SCOPES } = await import('../scopes.js');
      const allScopes = Object.values(SCOPES);
      const hasAll = allScopes.every((s) =>
        account.tokens.combined!.scopes.includes(s)
      );
      if (hasAll) {
        console.log(
          JSON.stringify({
            status: 'complete',
            email: account.email,
            scopes: account.tokens.combined.scopes,
            message: 'Account already configured with all scopes',
          })
        );
        return;
      }
    }
  }

  // Phase 2: Start auth flow (not yet implemented)
  console.log(
    JSON.stringify({
      status: 'not_implemented',
      message:
        'Auth flow not yet implemented (Phase 2). ' +
        'Use legacy CLI tools (gmcli/gdcli/gccli) to authorize, then run: npx go-easy auth list',
      email,
    })
  );
  process.exit(1);
}

// ─── auth remove ───────────────────────────────────────────

async function authRemove(argv: string[]): Promise<void> {
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
