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
 *   go-gmail marc@blegal.eu send --to=x@y.com --subject="Hi" --body-text-file=body.txt --confirm
 *
 * Body content:
 *   --body-text-file=<path>  Read plain text body from file (UTF-8)
 *   --body-html-file=<path>  Read HTML body from file (UTF-8)
 *   --body-md-file=<path>    Read Markdown body from file (auto-converted to HTML)
 *
 * Safety:
 *   Destructive operations (send, reply, forward, sendDraft) require --confirm flag.
 *   Without --confirm, the command shows what WOULD happen and exits.
 */

import { writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuth } from '../auth.js';
import { setSafetyContext } from '../safety.js';
import * as gmail from '../gmail/index.js';
import { cacheMessages, getCachedMessage, queryCache } from '../gmail/cache.js';
import { parseFlags, readBodyFlags } from './gmail-flags.js';

function usage(): never {
  console.log(JSON.stringify({
    error: 'USAGE',
    message: 'go-gmail <account> <command> [args...]',
    commands: {
      search: 'go-gmail <account> search "<query>" [--max=N] [--page-token=<token>]  — fetch from Gmail, cache results, omit body',
      query: 'go-gmail <account> query "<text>"  — search local cache (no API call)',
      get: 'go-gmail <account> get <messageId> [<page>] [--format=eml|text|html|sane-html] [--output=<path>] [--b64encode] [--no-cache]',
      thread: 'go-gmail <account> thread <threadId> [--format=mbox] [--output=<path>] [--b64encode]',
      labels: 'go-gmail <account> labels',
      send: 'go-gmail <account> send --to=<addr> --subject="..." --body-text-file=body.txt [--cc=<addr>] [--bcc=<addr>] [--confirm]',
      reply: 'go-gmail <account> reply <messageId> --body-text-file=reply.txt [--reply-all] --confirm',
      forward: 'go-gmail <account> forward <messageId> --to=<addr> [--body-text-file=note.txt] [--exclude=file1,file2] [--send-now --confirm]',
      draft: 'go-gmail <account> draft --to=<addr> --subject="..." --body-text-file=body.txt [--cc=<addr>] [--bcc=<addr>] [--in-reply-to=<messageId>]',
      'send-draft': 'go-gmail <account> send-draft <draftId> [--confirm]',
      drafts: 'go-gmail <account> drafts [--max=N] [--page-token=<token>]',
      'batch-label': 'go-gmail <account> batch-label --ids=id1,id2 --add=LABEL_ID --remove=LABEL_ID',
      attachment: 'go-gmail <account> attachment <messageId> <attachmentId>',
      profile: 'go-gmail <account> profile',
    },
    bodyFlags: {
      '--body-text-file': 'Read plain text body from file (UTF-8)',
      '--body-html-file': 'Read HTML body from file (UTF-8)',
      '--body-md-file': 'Read Markdown body from file (auto-converted to HTML)',
    },
  }, null, 2));
  process.exit(1);
}

/** Get positional args (non-flag), skipping values consumed by --key value pairs */
export function positional(args: string[]): string[] {
  const consumed = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/s);
    if (!match) continue;
    if (match[2] === undefined && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      consumed.add(++i);
    }
  }
  return args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
}

/** Strip body from a message and add a hint for retrieving it. */
function stripBody<T extends { body: unknown; id: string }>(
  msg: T,
  account: string
): Omit<T, 'body'> & { read_body_cmd: string } {
  const { body: _, ...rest } = msg;
  return { ...rest, read_body_cmd: `npx go-gmail ${account} get ${msg.id}` };
}

/**
 * Handle output for --format=eml / --format=mbox / --format=text / --format=html / --format=sane-html.
 *
 * Three output modes:
 *   --output=<path>   Write bytes to file → JSON { ok, format, path, bytes }
 *   --b64encode       Emit JSON { format, data: "<base64>", bytes } to stdout
 *   (neither)         Write content directly to stdout (pipe-friendly, non-JSON)
 *
 * Returns the JSON result object when writing to file or b64, or undefined
 * when writing raw to stdout (caller must not JSON.stringify again).
 */
export function handleRawOutput(
  buf: Buffer,
  format: string,
  flags: Record<string, string>
): object | undefined {
  const outputPath = flags['output'];
  const b64encode = 'b64encode' in flags;

  if (outputPath) {
    writeFileSync(outputPath, buf);
    return { ok: true, format, path: outputPath, bytes: buf.length };
  }

  if (b64encode) {
    return { format, data: buf.toString('base64'), bytes: buf.length };
  }

  // Raw bytes to stdout — intentionally non-JSON for pipe usage:
  //   go-gmail <account> get <id> --format=eml > message.eml
  process.stdout.write(buf);
  return undefined; // caller must not call JSON.stringify
}

const PAGE_BYTES = 45_000;

/**
 * Split JSON output into pageable chunks.
 *
 * JSON-escaped newlines (\\n) are expanded to real newlines first so that the
 * logical line breaks inside email body strings become actual line boundaries.
 * Lines are then grouped into pages whose UTF-8 byte size stays under PAGE_BYTES.
 * Individual lines that exceed PAGE_BYTES on their own get their own page as-is.
 */
function pageText(json: string, page: number): { content: string; totalPages: number } {
  const expanded = json.replace(/\\n/g, '\n');
  if (Buffer.byteLength(expanded, 'utf8') <= PAGE_BYTES) {
    return { content: expanded, totalPages: 1 };
  }

  const lines = expanded.split('\n');
  const pages: string[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  for (const line of lines) {
    const lb = Buffer.byteLength(line + '\n', 'utf8');
    if (chunkBytes + lb > PAGE_BYTES && chunk.length > 0) {
      pages.push(chunk.join('\n'));
      chunk = [line];
      chunkBytes = lb;
    } else {
      chunk.push(line);
      chunkBytes += lb;
    }
  }
  if (chunk.length > 0) pages.push(chunk.join('\n'));

  return { content: pages[page - 1] ?? '', totalPages: pages.length };
}

function emitPaged(text: string, page: number, account: string, msgId: string): void {
  const { content, totalPages } = pageText(text, page);
  if (totalPages === 1) {
    console.log(content);
  } else {
    const next = page < totalPages
      ? `\n[To read next page: npx go-gmail ${account} get ${msgId} ${page + 1}]`
      : '\n[End of message]';
    console.log(`[Page ${page}/${totalPages}]\n${content}${next}`);
  }
}

export async function main(args: string[] = process.argv.slice(2)) {
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

  try {
    const auth = await getAuth('gmail', account, flags.pass);
    let result: unknown;

    switch (command) {
      case 'profile':
        result = { email: await gmail.getProfile(auth) };
        break;

      case 'search': {
        const searchResult = await gmail.search(auth, {
          query: pos[0] ?? '',
          maxResults: flags.max ? parseInt(flags.max) : undefined,
          pageToken: flags['page-token'],
        });
        cacheMessages(account, searchResult.items);
        result = {
          ...searchResult,
          items: searchResult.items.map((m) => stripBody(m, account)),
        };
        break;
      }

      case 'get': {
        if (!pos[0]) usage();
        const fmt = flags.format;
        const noCache = 'no-cache' in flags;
        const page = pos[1] ? Math.max(1, parseInt(pos[1], 10)) : 1;

        if (fmt === 'eml') {
          // Raw bytes are not cached — always fetch from API
          const buf = await gmail.getMessageRaw(auth, pos[0]);
          result = handleRawOutput(buf, 'eml', flags);
          if (result === undefined) return;
        } else {
          // All other formats: try cache first, fall back to API + cache
          const cached = !noCache ? getCachedMessage(account, pos[0]) : undefined;
          const msg = cached ?? await gmail.getMessage(auth, pos[0]);
          if (!cached) cacheMessages(account, [msg]);

          if (fmt === 'text' || fmt === 'html' || fmt === 'sane-html') {
            let content: string;
            if (fmt === 'text') {
              content = msg.body.text ?? '';
            } else if (fmt === 'html') {
              content = msg.body.html ?? '';
            } else {
              content = gmail.sanitizeEmailHtml(msg.body.html ?? '');
            }
            // file/base64 output: no truncation concern, skip pagination
            if (flags['output'] || 'b64encode' in flags) {
              result = handleRawOutput(Buffer.from(content, 'utf-8'), fmt, flags);
              if (result === undefined) return;
            } else {
              emitPaged(content, page, account, pos[0]);
              return;
            }
          } else {
            emitPaged(JSON.stringify(msg, null, 2), page, account, pos[0]);
            return;
          }
        }
        break;
      }

      case 'thread':
        if (!pos[0]) usage();
        if (flags.format === 'mbox') {
          const fromAddress = await gmail.getProfile(auth);
          const buf = await gmail.getThreadMbox(auth, pos[0], fromAddress);
          result = handleRawOutput(buf, 'mbox', flags);
          if (result === undefined) return; // already written to stdout
        } else {
          const thread = await gmail.getThread(auth, pos[0]);
          cacheMessages(account, thread.messages);
          result = thread;
        }
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
          ...readBodyFlags(flags),
          attachments: flags.attach?.split(','),
        });
        break;

      case 'reply': {
        if (!pos[0]) usage();
        const origMsg = await gmail.getMessage(auth, pos[0]);
        result = await gmail.reply(auth, {
          threadId: origMsg.threadId,
          messageId: pos[0],
          ...readBodyFlags(flags),
          replyAll: 'reply-all' in flags,
        });
        break;
      }

      case 'forward':
        if (!pos[0]) usage();
        result = await gmail.forward(auth, {
          messageId: pos[0],
          to: flags.to ?? '',
          ...readBodyFlags(flags),
          includeAttachments: flags.include ? flags.include.split(',') : true,
          excludeAttachments: flags.exclude?.split(','),
          sendNow: 'send-now' in flags,
          keepInThread: !('no-thread' in flags),
        });
        break;

      case 'draft': {
        let threadId: string | undefined;
        let extraHeaders: Record<string, string> | undefined;

        // If --in-reply-to is provided, fetch the original message to get threadId and Message-ID
        const inReplyToId = flags['in-reply-to'];
        if (inReplyToId) {
          const original = await gmail.getMessage(auth, inReplyToId);
          threadId = original.threadId;
          const messageIdRef = original.rfc822MessageId ?? `<${inReplyToId}>`;
          extraHeaders = {
            'In-Reply-To': messageIdRef,
            'References': messageIdRef,
          };
        }

        result = await gmail.createDraft(auth, {
          to: flags.to ?? '',
          cc: flags.cc,
          bcc: flags.bcc,
          subject: flags.subject ?? '',
          ...readBodyFlags(flags),
          threadId,
          extraHeaders,
        });
        break;
      }

      case 'send-draft':
        if (!pos[0]) usage();
        result = await gmail.sendDraft(auth, pos[0]);
        break;

      case 'drafts':
        result = await gmail.listDrafts(
          auth,
          flags.max ? parseInt(flags.max) : undefined,
          flags['page-token'],
        );
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

      case 'query': {
        const entries = queryCache(account, pos[0]);
        result = {
          items: entries.map((m) => stripBody(m, account)),
          total: entries.length,
          source: 'cache',
        };
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

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((err: unknown) => {
    const e = err as { toJSON?: () => unknown; message?: string; code?: string };
    if (typeof e.toJSON === 'function') {
      console.error(JSON.stringify(e.toJSON(), null, 2));
    } else {
      console.error(JSON.stringify({ error: e.code ?? 'UNKNOWN', message: e.message ?? String(err) }, null, 2));
    }
    process.exit(1);
  });
}
