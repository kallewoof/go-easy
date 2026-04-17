# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # compile TypeScript to dist/
npm test             # run all tests (vitest)
npm run lint         # type-check only (tsc --noEmit)
npm run dev          # watch mode compilation
```

Run a single test file:
```bash
npx vitest run test/gmail/search.test.ts
```

## Architecture

**go-easy** is a TypeScript library + CLI toolkit providing agent-friendly wrappers around Google APIs (Gmail, Drive, Calendar, Tasks). Published as `@marcfargas/go-easy`.

### Module Layout

```
src/
  auth.ts / auth-store.ts / auth-flow.ts / auth-server.ts  # OAuth system
  safety.ts        # destructive-op safety gates
  errors.ts        # custom error hierarchy with codes
  scopes.ts        # OAuth scope definitions
  gmail/           # search, send, reply, drafts, labels, raw export
  drive/           # list, upload, share, export, folders
  calendar/        # events, freebusy, calendars
  tasks/           # task lists, tasks, subtasks
  bin/             # five CLI entry points (go-easy, go-gmail, go-drive, go-calendar, go-tasks)
```

Tests mirror the `src/` structure under `test/`.

### Auth System

- Single combined OAuth2 token per account covering all scopes, stored at `~/.config/go-easy/accounts.json`
- Two-phase OAuth flow (Phase 1 returns URL, Phase 2 polls) — designed for agent-compatibility
- OAuth2Client is cached per `"service:email"` key
- Backward-compatible with legacy per-service token files (`~/.gmcli`, `~/.gdcli`, `~/.gccli`)

### Safety Model

Three levels enforced via `SafetyContext`:
- **READ** — no gate (search, list, get)
- **WRITE** — logged, not blocked (create draft, upload, label, mkdir)
- **DESTRUCTIVE** — blocked unless `SafetyContext.confirm()` returns true (send, reply, forward, external share, delete, trash)

Library users call `setSafetyContext()` once at startup. CLI uses `--confirm` flag; without it, the CLI prints a preview and exits with code 2.

### CLI Design

All CLIs output JSON for agent consumption. Positional args: `<account> <command> [args...]`.

Body content is always passed via file flags (`--body-text-file`, `--body-html-file`, `--body-md-file`) — never inline — to avoid shell escaping issues.

### Error Codes

`GoEasyError` subclasses carry machine-readable codes: `AUTH_NO_ACCOUNT`, `AUTH_MISSING_SCOPE`, `AUTH_TOKEN_REVOKED`, `AUTH_REFRESH_FAILED`, `NOT_FOUND`, `QUOTA_EXCEEDED`, `SAFETY_BLOCKED`. `AuthError` includes a `.fix` field with the exact CLI command to resolve.

### Exports (subpath)

Package exports map cleanly: `@marcfargas/go-easy/gmail`, `.../drive`, `.../calendar`, `.../tasks`, `.../auth`, `.../auth-store`, `.../scopes`.

### Releases

Uses **changesets** for semantic versioning. Create a changeset with `npm run changeset` before merging features or fixes. CI runs on Node 20/22/24.
