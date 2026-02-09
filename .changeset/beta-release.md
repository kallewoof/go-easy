---
"@marcfargas/go-easy": minor
---

Beta release — own auth system, Google Tasks, reply CLI, file-based body flags, Markdown emails.

### Auth (BREAKING)

go-easy now owns its own OAuth2 tokens at `~/.go-easy/` instead of reading from legacy CLI stores (`~/.gmcli`, `~/.gdcli`, `~/.gccli`).

- `npx go-easy auth add <email>` — agent-compatible two-phase OAuth flow (start → poll)
- `npx go-easy auth list` — list configured accounts and scopes
- `npx go-easy auth remove <email> --confirm` — remove an account
- One combined token per account covers Gmail + Drive + Calendar + Tasks
- Specific error codes with `fix` field: `AUTH_NO_ACCOUNT`, `AUTH_MISSING_SCOPE`, `AUTH_TOKEN_REVOKED`, `AUTH_NO_CREDENTIALS`

### Google Tasks (NEW)

New service module and CLI for Google Tasks API:

- `npx go-tasks <account> lists` — list task lists
- `npx go-tasks <account> tasks <listId>` — list tasks with pagination
- `npx go-tasks <account> get/add/update/complete/move/delete` — full CRUD
- `npx go-tasks <account> create-list/delete-list/clear` — list management
- Subtask support via `--parent` flag
- Library: `@marcfargas/go-easy/tasks` export
- Requires re-auth for existing accounts (`npx go-easy auth add <email>`)

### Gmail CLI

- Add `reply` command — reply and reply-all with `--reply-all` flag (DESTRUCTIVE, requires `--confirm`)
- Add `--in-reply-to` flag for `draft` command (thread association)
- Add `--cc` and `--bcc` flags for `draft` and `send` commands
- Add `--page-token` for `search` and `drafts` pagination

### Body Flags (BREAKING)

Replace inline `--body`, `--html`, `--md` flags with file-based alternatives:

- `--body-text-file=<path>` — read plain text body from UTF-8 file
- `--body-html-file=<path>` — read HTML body from UTF-8 file
- `--body-md-file=<path>` — read Markdown body from file (auto-converted to HTML)

This eliminates shell escaping, encoding, and multiline issues for agent use.

### Markdown Email Support

- New `markdown` option on `send`, `reply`, `forward`, and `createDraft`
- Auto-converts Markdown to email-safe HTML with inline styles
- GFM support: tables, strikethrough, code blocks, links, lists
- `markdownToHtml()` helper exported from `@marcfargas/go-easy/gmail`

### Forward Improvements

- Forward creates a draft by default (WRITE, no safety gate)
- `--send-now --confirm` to send immediately (DESTRUCTIVE)
- Attachment filtering: `--include=name` and `--exclude=name` (substring match)
- `--no-thread` to break out of the original thread
- Body content appears above the forwarded message

### Calendar

- Support all event types: working location, out-of-office, focus time, birthday
- `--page-token` for events pagination
- Fix `update` command: use PATCH instead of PUT to prevent data loss on partial updates

### Drive

- `--page-token` for `ls` and `search` pagination

### Fixes

- RFC 2047 encode Subject headers with non-ASCII characters
- Fix forward threading (keep in original thread by default)
- Fix auth HTML pages: add `<meta charset="utf-8">` for emoji rendering
