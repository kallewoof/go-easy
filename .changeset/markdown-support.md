---
"@marcfargas/go-easy": minor
---

Add Markdown support for email bodies.

- New `markdown` option on `send`, `reply`, and `createDraft` — auto-converts to HTML with email-safe styling
- New `markdownToHtml()` helper exported from `@marcfargas/go-easy/gmail`
- CLI: `--markdown` / `--md` flags for `send` and `draft` commands
- GFM support: tables, strikethrough, code blocks, links, lists
