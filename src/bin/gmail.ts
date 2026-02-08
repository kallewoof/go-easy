#!/usr/bin/env node
/**
 * go-gmail — Gateway CLI for Gmail operations.
 *
 * Always outputs JSON. Designed for agent consumption.
 *
 * Usage:
 *   go-gmail <account> <command> [args...]
 *   go-gmail marc@blegal.eu search "from:client is:unread"
 *   go-gmail marc@blegal.eu get <messageId>
 *   go-gmail marc@blegal.eu thread <threadId>
 *   go-gmail marc@blegal.eu labels
 *   go-gmail marc@blegal.eu send --to=x@y.com --subject="Hi" --body="Hello"
 *
 * Safety:
 *   Destructive operations (send, reply, forward, sendDraft) require --confirm flag.
 *   Without --confirm, the command shows what WOULD happen and exits.
 */

import { getAuth } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import * as gmail from '../gmail/index.js';

const args = process.argv.slice(2);

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-gmail <account> <command> [args...]',
    commands: {
      search: 'go-gmail <account> search "<query>" [--max=N]',
      get: 'go-gmail <account> get <messageId>',
      thread: 'go-gmail <account> thread <threadId>',
      labels: 'go-gmail <account> labels',
      send: 'go-gmail <account> send --to=<addr> --subject="..." --body="..." [--html="..."] [--confirm]',
      forward: 'go-gmail <account> forward <messageId> --to=<addr> [--body="..."] [--exclude=file1,file2] [--as-draft] [--confirm]',
      draft: 'go-gmail <account> draft --to=<addr> --subject="..." --body="..."',
      'send-draft': 'go-gmail <account> send-draft <draftId> [--confirm]',
      drafts: 'go-gmail <account> drafts [--max=N]',
      'batch-label': 'go-gmail <account> batch-label --ids=id1,id2 --add=LABEL --remove=LABEL',
      attachment: 'go-gmail <account> attachment <messageId> <attachmentId>',
      profile: 'go-gmail <account> profile',
    },
  }, null, 2));
  process.exit(1);
}

/** Parse --key=value flags from args */
function parseFlags(args: string[]): Record<string, string> {
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
function positional(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('--'));
}

async function main() {
  if (args.length < 2) usage();

  const account = args[0];
  const command = args[1];
  const rest = args.slice(2);
  const flags = parseFlags(rest);
  const pos = positional(rest);

  // Set up safety context: --confirm flag allows destructive ops
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

  const auth = await getAuth('gmail', account);

  try {
    let result: unknown;

    switch (command) {
      case 'profile':
        result = { email: await gmail.getProfile(auth) };
        break;

      case 'search':
        result = await gmail.search(auth, {
          query: pos[0] ?? '',
          maxResults: flags.max ? parseInt(flags.max) : undefined,
        });
        break;

      case 'get':
        if (!pos[0]) usage();
        result = await gmail.getMessage(auth, pos[0]);
        break;

      case 'thread':
        if (!pos[0]) usage();
        result = await gmail.getThread(auth, pos[0]);
        break;

      case 'labels':
        result = await gmail.listLabels(auth);
        break;

      case 'send':
        result = await gmail.send(auth, {
          to: flags.to ?? '',
          cc: flags.cc,
          bcc: flags.bcc,
          subject: flags.subject ?? '',
          body: flags.body,
          html: flags.html,
          markdown: flags.markdown ?? flags.md,
          attachments: flags.attach?.split(','),
        });
        break;

      case 'forward':
        if (!pos[0]) usage();
        result = await gmail.forward(auth, {
          messageId: pos[0],
          to: flags.to ?? '',
          body: flags.body,
          html: flags.html,
          markdown: flags.markdown ?? flags.md,
          includeAttachments: flags.include ? flags.include.split(',') : true,
          excludeAttachments: flags.exclude?.split(','),
          asDraft: 'as-draft' in flags,
          keepInThread: !('no-thread' in flags),
        });
        break;

      case 'draft':
        result = await gmail.createDraft(auth, {
          to: flags.to ?? '',
          subject: flags.subject ?? '',
          body: flags.body,
          html: flags.html,
          markdown: flags.markdown ?? flags.md,
        });
        break;

      case 'send-draft':
        if (!pos[0]) usage();
        result = await gmail.sendDraft(auth, pos[0]);
        break;

      case 'drafts':
        result = await gmail.listDrafts(auth, flags.max ? parseInt(flags.max) : undefined);
        break;

      case 'batch-label':
        result = await gmail.batchModifyLabels(auth, {
          messageIds: (flags.ids ?? '').split(','),
          addLabelIds: flags.add?.split(','),
          removeLabelIds: flags.remove?.split(','),
        });
        break;

      case 'attachment': {
        if (!pos[0] || !pos[1]) usage();
        const buf = await gmail.getAttachmentContent(auth, pos[0], pos[1]);
        // Output base64 for binary safety
        result = { data: buf.toString('base64'), size: buf.length };
        break;
      }

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

main();
