---
"@marcfargas/go-easy": minor
---

Improve forward with draft support, thread preservation, and attachment filtering.

- `asDraft: true` — create forward as draft instead of sending (WRITE, no safety gate)
- `keepInThread: true` (default) — forward stays in the original thread
- `excludeAttachments: ['Receipt']` — exclude attachments by filename match
- `includeAttachments: ['Invoice']` — include only matching attachments
- `html` / `markdown` support for the forwarding body
- New CLI command: `go-gmail forward <msgId> --to=... [--as-draft] [--exclude=...] [--include=...]`
