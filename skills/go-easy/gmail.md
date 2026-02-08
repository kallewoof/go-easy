# go-easy: Gmail Reference

## Gateway CLI: `npx go-gmail`

```
npx go-gmail <account> <command> [args...] [--flags]
```

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

### Body Content Flags

Body content is always read from files — never passed inline. This avoids shell escaping, encoding, and multiline issues.

| Flag | Description |
|------|-------------|
| `--body-text-file=<path>` | Read plain text body from UTF-8 file |
| `--body-html-file=<path>` | Read HTML body from UTF-8 file |
| `--body-md-file=<path>` | Read Markdown body from file (auto-converted to HTML) |

You can combine `--body-text-file` + `--body-html-file` for multipart/alternative emails.
Markdown (`--body-md-file`) auto-generates HTML; if `--body-html-file` is also set, HTML wins.

### Commands

#### profile
Get authenticated account info.
```bash
npx go-gmail marc@blegal.eu profile
# → { "email": "marc@blegal.eu" }
```

#### search
Search emails using Gmail query syntax.
```bash
npx go-gmail marc@blegal.eu search "from:client is:unread"
npx go-gmail marc@blegal.eu search "subject:invoice after:2026/01/01" --max=5
```
Returns: `{ items: GmailMessage[], nextPageToken?, resultSizeEstimate? }`

#### get
Get a single message by ID.
```bash
npx go-gmail marc@blegal.eu get <messageId>
```
Returns: `GmailMessage`

#### thread
Get a full thread (conversation) by ID.
```bash
npx go-gmail marc@blegal.eu thread <threadId>
```
Returns: `{ id, snippet, messages: GmailMessage[] }`

#### labels
List all labels.
```bash
npx go-gmail marc@blegal.eu labels
```
Returns: `[{ id, name, type }]`

#### send ⚠️ DESTRUCTIVE
Send an email. Requires `--confirm`.
```bash
# Write body to a temp file, then send
npx go-gmail marc@blegal.eu send \
  --to=recipient@example.com \
  --subject="Hello" \
  --body-text-file=body.txt \
  --confirm

# With Markdown body (converted to HTML automatically):
npx go-gmail marc@blegal.eu send \
  --to=recipient@example.com \
  --subject="Weekly Update" \
  --body-md-file=update.md \
  --confirm

# With CC, BCC, HTML, attachments:
npx go-gmail marc@blegal.eu send \
  --to=a@example.com \
  --cc=b@example.com \
  --bcc=c@example.com \
  --subject="Report" \
  --body-text-file=body.txt \
  --body-html-file=body.html \
  --attach=report.pdf,data.xlsx \
  --confirm
```
Returns: `{ ok: true, id, threadId?, labelIds? }`

Without `--confirm`:
```json
{ "blocked": true, "operation": "gmail.send", "description": "...", "hint": "Add --confirm to execute" }
```

#### draft
Create a draft (WRITE — no `--confirm` needed).
```bash
npx go-gmail marc@blegal.eu draft \
  --to=recipient@example.com \
  --subject="Draft subject" \
  --body-text-file=body.txt

# Reply draft (placed in the original thread):
npx go-gmail marc@blegal.eu draft \
  --to=recipient@example.com \
  --subject="RE: Original subject" \
  --body-text-file=reply.txt \
  --in-reply-to=<messageId>
```
`--in-reply-to` fetches the original message to set `threadId`, `In-Reply-To`, and `References` headers.

Returns: `{ id, message: GmailMessage }`

#### send-draft ⚠️ DESTRUCTIVE
Send an existing draft. Requires `--confirm`.
```bash
npx go-gmail marc@blegal.eu send-draft <draftId> --confirm
```

#### drafts
List drafts.
```bash
npx go-gmail marc@blegal.eu drafts
npx go-gmail marc@blegal.eu drafts --max=5
```

#### forward (WRITE — creates draft by default)
Forward a message. Creates a draft by default. Use `--send-now --confirm` to send immediately.
```bash
# Forward as draft (default — no --confirm needed)
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com

# Exclude specific attachments
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com --exclude=Receipt

# Include only specific attachments
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com --include=Invoice

# Add body text from file
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com --body-text-file=note.txt

# Don't keep in same thread
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com --no-thread

# Send immediately (DESTRUCTIVE — requires --confirm)
npx go-gmail marc@blegal.eu forward <messageId> --to=other@example.com --send-now --confirm
```
Returns: `{ ok: true, id, threadId? }`

Options:
- `--send-now` — send immediately instead of creating draft (requires `--confirm`)
- `--exclude=name1,name2` — exclude attachments matching these names
- `--include=name1,name2` — include ONLY attachments matching these names
- `--no-thread` — don't keep in original thread
- `--body-text-file`, `--body-html-file`, `--body-md-file` — prepend body to forwarded message

#### batch-label
Batch modify labels on messages (WRITE — no `--confirm` needed).
```bash
npx go-gmail marc@blegal.eu batch-label \
  --ids=msg1,msg2,msg3 \
  --add=Label_1 \
  --remove=UNREAD
```

#### attachment
Download an attachment (returns base64).
```bash
npx go-gmail marc@blegal.eu attachment <messageId> <attachmentId>
# → { "data": "<base64>", "size": 12345 }
```

## Library API

For direct TypeScript import (when building tools, not using CLI):

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { search, getMessage, getThread, send, reply, forward,
         createDraft, sendDraft, listDrafts, listLabels,
         batchModifyLabels, getAttachmentContent, getProfile,
         markdownToHtml
} from '@marcfargas/go-easy/gmail';
import { setSafetyContext } from '@marcfargas/go-easy';

// Auth
const auth = await getAuth('gmail', 'marc@blegal.eu');

// Safety context (required for destructive ops)
setSafetyContext({
  confirm: async (op) => {
    console.log(`⚠️  ${op.description}`);
    return true; // or prompt user
  }
});

// Search
const results = await search(auth, { query: 'is:unread', maxResults: 10 });

// Get message
const msg = await getMessage(auth, 'messageId');

// Get thread
const thread = await getThread(auth, 'threadId');

// Send (DESTRUCTIVE — needs safety context)
const sent = await send(auth, {
  to: 'recipient@example.com',
  subject: 'Hello',
  body: 'Message text',
  html: '<p>Message HTML</p>',
  attachments: ['path/to/file.pdf'],
});

// Send with Markdown (auto-converted to HTML)
await send(auth, {
  to: 'recipient@example.com',
  subject: 'Update',
  markdown: '# Status\n\n- Task 1: **done**\n- Task 2: _in progress_',
});

// Convert Markdown to HTML manually
const html = markdownToHtml('**bold** and _italic_');

// Reply (DESTRUCTIVE)
const replied = await reply(auth, {
  threadId: 'thread-id',
  messageId: 'msg-id',
  body: 'Thanks!',
  replyAll: false,
});

// Forward as draft (default — WRITE, no safety gate)
const forwarded = await forward(auth, {
  messageId: 'msg-id',
  to: 'other@example.com',
  body: 'FYI',
  excludeAttachments: ['Receipt'],        // exclude by filename match
});

// Forward with markdown and selective attachments
const fwd2 = await forward(auth, {
  messageId: 'msg-id',
  to: 'other@example.com',
  markdown: '**Please review** the attached invoice.',
  includeAttachments: ['Invoice'],        // include only matching filenames
});

// Forward and send immediately (DESTRUCTIVE — needs safety context)
const fwdSent = await forward(auth, {
  messageId: 'msg-id',
  to: 'other@example.com',
  sendNow: true,
});

// Draft (WRITE — no safety gate)
const draft = await createDraft(auth, {
  to: 'recipient@example.com',
  subject: 'Draft',
  body: 'Content',
});

// Draft in a thread (reply draft)
const replyDraft = await createDraft(auth, {
  to: 'recipient@example.com',
  subject: 'RE: Original',
  body: 'Reply content',
  threadId: 'thread-id',
  extraHeaders: {
    'In-Reply-To': '<original-message-id@mail.gmail.com>',
    'References': '<original-message-id@mail.gmail.com>',
  },
});

// Labels
const labels = await listLabels(auth);
await batchModifyLabels(auth, {
  messageIds: ['msg1', 'msg2'],
  addLabelIds: ['Label_1'],
  removeLabelIds: ['UNREAD'],
});

// Attachments
const content = await getAttachmentContent(auth, 'msgId', 'attId');
// content is a Buffer
```

## Gmail Query Syntax (for search)

Same as Gmail UI search:
- `from:user@example.com` — from sender
- `to:user@example.com` — to recipient
- `subject:invoice` — subject contains
- `is:unread` — unread messages
- `is:starred` — starred
- `has:attachment` — has attachments
- `after:2026/01/01` — after date
- `before:2026/02/01` — before date
- `label:important` — with label
- `in:inbox` — in inbox
- `filename:pdf` — attachment filename

Combine with spaces (AND) or `OR`:
```
from:client subject:invoice after:2026/01/01
from:alice OR from:bob
```

## Types

```typescript
interface GmailMessage {
  id: string;
  threadId: string;
  date: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  snippet: string;
  body: { text?: string; html?: string };
  labelIds: string[];
  attachments: AttachmentInfo[];
  /** RFC 2822 Message-ID header (present when available) */
  rfc822MessageId?: string;
}

interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ListResult<T> {
  items: T[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface WriteResult {
  ok: true;
  id: string;
  threadId?: string;
  labelIds?: string[];
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| `AUTH_ERROR` | Token expired, missing, or invalid |
| `NOT_FOUND` | Message/thread not found (404) |
| `QUOTA_EXCEEDED` | Gmail API rate limit (429) |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` |
| `GMAIL_ERROR` | Other Gmail API error |

## Available Accounts

Check `~/.gmcli/accounts.json` for configured accounts.
Typically: `marc@blegal.eu`, `telenieko@gmail.com`.
