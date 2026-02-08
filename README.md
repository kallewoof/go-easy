# go-easy 🟢

> Google APIs made easy — Gmail, Drive, Calendar for AI agents and humans.

Thin TypeScript wrappers over Google's `googleapis` SDK with:
- **Simple auth** — multi-account OAuth2 with token import from existing tools
- **Agent-friendly types** — structured `GmailMessage`, `DriveFile`, `CalendarEvent`
- **Safety guards** — destructive operations (send, share, delete) require explicit confirmation
- **JSON gateways** — CLI tools that always output structured JSON
- **Progressive skills** — designed for AI agent consumption (pi coding agent)

## Quick Start

```ts
import { getAuth } from 'go-easy/auth';
import { search, send } from 'go-easy/gmail';

// Auth: imports tokens from existing CLI tools
const auth = await getAuth('gmail', 'marc@blegal.eu');

// Search (READ — no safety gate)
const results = await search(auth, { query: 'is:unread from:client' });
console.log(results.items);

// Send (DESTRUCTIVE — requires safety context)
import { setSafetyContext } from 'go-easy';

setSafetyContext({
  confirm: async (op) => {
    console.log(`⚠️ ${op.description}`);
    return true; // or prompt the user
  },
});

await send(auth, {
  to: 'client@example.com',
  subject: 'Invoice attached',
  html: '<h1>Invoice</h1><p>Please find attached.</p>',
  attachments: ['./invoice.pdf'],
});
```

## Gateway CLI

```bash
# Search
go-gmail marc@blegal.eu search "is:unread" --max=10

# Read a message
go-gmail marc@blegal.eu get <messageId>

# Send (requires --confirm)
go-gmail marc@blegal.eu send --to=x@y.com --subject="Hi" --body="Hello" --confirm
```

## Services

| Service | Module | Gateway | Status |
|---------|--------|---------|--------|
| Gmail | `go-easy/gmail` | `go-gmail` | 🚧 In progress |
| Drive | `go-easy/drive` | `go-drive` | 📋 Planned |
| Calendar | `go-easy/calendar` | `go-calendar` | 📋 Planned |

## Safety Model

Operations are classified into three levels:

| Level | Gate | Examples |
|-------|------|----------|
| **READ** | None | search, getMessage, listLabels |
| **WRITE** | Logged | createDraft, batchModifyLabels, upload |
| **DESTRUCTIVE** | Blocked unless confirmed | send, reply, forward, share, delete |

Set up a `SafetyContext` at startup to handle confirmation prompts.
Without one, all destructive operations are blocked by default.

## License

MIT
