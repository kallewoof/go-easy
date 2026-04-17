#!/usr/bin/env node
/**
 * go-tasks — Gateway CLI for Google Tasks operations.
 *
 * Always outputs JSON. Designed for agent consumption.
 *
 * Usage:
 *   go-tasks <account> <command> [args...]
 *   go-tasks marc@blegal.eu lists
 *   go-tasks marc@blegal.eu tasks <listId>
 *   go-tasks marc@blegal.eu add <listId> --title="Buy milk"
 *
 * Safety:
 *   Destructive operations (delete, clear) require --confirm flag.
 */

import { fileURLToPath } from 'node:url';
import { getAuth } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import * as tasks from '../tasks/index.js';

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-tasks <account> <command> [args...]',
    commands: {
      lists: 'go-tasks <account> lists',
      tasks: 'go-tasks <account> tasks <listId> [--max=N] [--page-token=<token>] [--show-completed] [--show-hidden]',
      get: 'go-tasks <account> get <listId> <taskId>',
      add: 'go-tasks <account> add <listId> --title="..." [--notes="..."] [--due=YYYY-MM-DD] [--parent=<taskId>]',
      update: 'go-tasks <account> update <listId> <taskId> [--title="..."] [--notes="..."] [--due=YYYY-MM-DD] [--status=completed|needsAction]',
      complete: 'go-tasks <account> complete <listId> <taskId>',
      move: 'go-tasks <account> move <listId> <taskId> [--parent=<taskId>] [--previous=<taskId>]',
      delete: 'go-tasks <account> delete <listId> <taskId> --confirm',
      'create-list': 'go-tasks <account> create-list --title="..."',
      'delete-list': 'go-tasks <account> delete-list <listId> --confirm',
      clear: 'go-tasks <account> clear <listId> --confirm',
    },
  }, null, 2));
  process.exit(1);
}

/** Parse --key=value flags from args */
export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/s);
    if (match) {
      flags[match[1]] = match[2] ?? 'true';
    }
  }
  return flags;
}

/** Get positional args (non-flag) */
export function positional(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('--'));
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.length < 2) usage();

  const account = args[0];
  const command = args[1];
  const rest = args.slice(2);
  const flags = parseFlags(rest);
  const pos = positional(rest);

  // Set up safety context
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

  let auth;
  try {
    auth = await getAuth('tasks', account);
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

  try {
    let result: unknown;

    switch (command) {
      case 'lists':
        result = await tasks.listTaskLists(auth);
        break;

      case 'tasks':
        if (!pos[0]) usage();
        result = await tasks.listTasks(auth, pos[0], {
          maxResults: flags.max ? parseInt(flags.max) : undefined,
          pageToken: flags['page-token'],
          showCompleted: 'show-completed' in flags ? true : undefined,
          showHidden: 'show-hidden' in flags ? true : undefined,
        });
        break;

      case 'get':
        if (!pos[0] || !pos[1]) usage();
        result = await tasks.getTask(auth, pos[0], pos[1]);
        break;

      case 'add':
        if (!pos[0]) usage();
        result = await tasks.createTask(auth, pos[0], {
          title: flags.title ?? '',
          notes: flags.notes,
          due: flags.due,
          parent: flags.parent,
          previous: flags.previous,
        });
        break;

      case 'update':
        if (!pos[0] || !pos[1]) usage();
        result = await tasks.updateTask(auth, pos[0], pos[1], {
          title: flags.title,
          notes: flags.notes,
          due: flags.due,
          status: flags.status as 'needsAction' | 'completed' | undefined,
        });
        break;

      case 'complete':
        if (!pos[0] || !pos[1]) usage();
        result = await tasks.completeTask(auth, pos[0], pos[1]);
        break;

      case 'move':
        if (!pos[0] || !pos[1]) usage();
        result = await tasks.moveTask(auth, pos[0], pos[1], {
          parent: flags.parent,
          previous: flags.previous,
        });
        break;

      case 'delete':
        if (!pos[0] || !pos[1]) usage();
        result = await tasks.deleteTask(auth, pos[0], pos[1]);
        break;

      case 'create-list':
        result = await tasks.createTaskList(auth, flags.title ?? '');
        break;

      case 'delete-list':
        if (!pos[0]) usage();
        result = await tasks.deleteTaskList(auth, pos[0]);
        break;

      case 'clear':
        if (!pos[0]) usage();
        result = await tasks.clearCompleted(auth, pos[0]);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => process.exit(1));
}
