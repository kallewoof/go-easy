#!/usr/bin/env node
/**
 * go-sheets — Gateway CLI for Google Sheets operations.
 *
 * Always outputs JSON. Designed for agent consumption.
 *
 * Usage:
 *   go-sheets <account> <command> [args...]
 *   go-sheets marc@example.com tabs <spreadsheetId>
 *   go-sheets marc@example.com read <spreadsheetId> "Sheet1!A1:Z"
 *   go-sheets marc@example.com write <spreadsheetId> "Sheet1!A1" --values-file=./data.json
 *   go-sheets marc@example.com clear <spreadsheetId> "Sheet1!A1:Z"
 */

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuth } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import * as sheetsLib from '../sheets/index.js';
import type { GetValuesOptions } from '../sheets/types.js';

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-sheets <account> <command> [args...]',
    commands: {
      tabs: 'go-sheets <account> tabs <spreadsheetId>',
      read: 'go-sheets <account> read <spreadsheetId> <range> [--render=FORMATTED_VALUE|UNFORMATTED_VALUE|FORMULA]',
      write: 'go-sheets <account> write <spreadsheetId> <range> --values-file=<path> [--input=RAW|USER_ENTERED]',
      clear: 'go-sheets <account> clear <spreadsheetId> <range>',
    },
  }, null, 2));
  process.exit(1);
}

/** Parse --key=value flags from args */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) {
      flags[match[1]] = match[2] ?? 'true';
    }
  }
  return flags;
}

/** Get positional args (non-flag) */
export function positional(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('--'));
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.length < 2) usage();

  const account = args[0];
  const command = args[1];
  const rest = args.slice(2);
  const flags = parseFlags(rest);
  const pos = positional(rest);

  const hasConfirm = 'confirm' in flags;
  setSafetyContext({
    confirm: async (op) => {
      if (!hasConfirm) {
        console.log(JSON.stringify({
          blocked: true,
          operation: op.name,
          description: op.description,
          details: op.details,
          hint: 'Add --confirm to execute this operation',
        }, null, 2));
        process.exit(2);
      }
      return true;
    },
  });

  try {
    const auth = await getAuth('sheets', account);
    let result: unknown;

    switch (command) {
      case 'tabs':
        if (!pos[0]) usage();
        result = await sheetsLib.listSheets(auth, pos[0]);
        break;

      case 'read':
        if (!pos[0] || !pos[1]) usage();
        result = await sheetsLib.getValues(auth, pos[0], pos[1], {
          valueRenderOption: (flags.render as GetValuesOptions['valueRenderOption']) ?? 'FORMATTED_VALUE',
        });
        break;

      case 'write': {
        if (!pos[0] || !pos[1] || !flags['values-file']) usage();
        const raw = await readFile(flags['values-file'], 'utf-8');
        const values = JSON.parse(raw) as string[][];
        if (!Array.isArray(values)) {
          console.error(JSON.stringify({ error: 'INVALID_INPUT', message: '--values-file must contain a JSON array of arrays' }));
          process.exit(1);
        }
        result = await sheetsLib.updateValues(auth, pos[0], pos[1], values, {
          valueInputOption: flags.input as 'RAW' | 'USER_ENTERED' | undefined,
        });
        break;
      }

      case 'clear':
        if (!pos[0] || !pos[1]) usage();
        result = await sheetsLib.clearValues(auth, pos[0], pos[1]);
        break;

      default:
        usage();
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const e = err as { toJSON?: () => unknown; message?: string; code?: string };
    if (typeof e.toJSON === 'function') {
      console.error(JSON.stringify(e.toJSON(), null, 2));
    } else {
      console.error(JSON.stringify({
        error: e.code ?? 'UNKNOWN',
        message: e.message ?? String(err),
      }, null, 2));
    }
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(() => process.exit(1));
}
