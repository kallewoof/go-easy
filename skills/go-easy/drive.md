# go-easy: Drive Reference

## Gateway CLI: `npx go-drive`

```
npx go-drive <account> <command> [args...] [--pass <phrase>] [--flags]
```

`--pass <phrase>` is required when the account is passphrase-protected (see [SKILL.md](SKILL.md)).

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.
Shared Drives are supported transparently.

### Commands

#### ls
List files in a folder or by metadata query.
```bash
# List root folder (most recently modified first)
npx go-drive <account> ls

# List specific folder
npx go-drive <account> ls <folderId>

# With metadata query
npx go-drive <account> ls --query="name contains 'report'"

# Combine folder + query + pagination
npx go-drive <account> ls <folderId> --query="mimeType = 'application/pdf'" --max=10
npx go-drive <account> ls --max=50 --page-token=<token>

# Order by name
npx go-drive <account> ls --order="name"
```
Returns: `{ items: DriveFile[], nextPageToken? }`

**Defaults:**
- `--max`: 20 per page
- `--order`: `modifiedTime desc` (most recently modified first)

**Valid `--order` values:** `name`, `modifiedTime`, `modifiedTime desc`, `createdTime`, `createdTime desc`, `folder`, `quotaBytesUsed`, `recency`

#### search
Full-text content search (searches inside file contents).
```bash
npx go-drive <account> search "quarterly revenue"
npx go-drive <account> search "contract clause 5" --max=5
npx go-drive <account> search "budget" --page-token=<token>
```
Returns: `{ items: DriveFile[], nextPageToken? }`

- `--max`: no default (returns all matches, Drive API decides page size)

**Note**: `search` searches file *contents*. Use `ls --query` to search by filename/metadata.

#### get
Get file metadata by ID.
```bash
npx go-drive <account> get <fileId>
```
Returns: `DriveFile`

#### download
Download a file (writes to disk).
```bash
npx go-drive <account> download <fileId>              # saves as original filename in CWD
npx go-drive <account> download <fileId> ./output.pdf  # saves to specific path
```
Returns: `{ ok: true, path, size, mimeType }`

⚠️ Without a destination path, the file is saved to the **current working directory**. Use `$TEMP` or a specific path for agent workflows:
```bash
npx go-drive <account> download <fileId> "$TEMP/downloaded.pdf"
```

**Note**: Cannot download Google Workspace files (Docs/Sheets/Slides) — they have no binary content. Use `export` instead. Attempting to download one throws `DRIVE_EXPORT_REQUIRED`.

#### export
Export Google Workspace files to standard formats.
```bash
npx go-drive <account> export <fileId> pdf
npx go-drive <account> export <fileId> docx ./output.docx
npx go-drive <account> export <fileId> xlsx
```
Returns: `{ ok: true, path, size, mimeType }`

⚠️ Without a destination path, the file is saved to the **current working directory**.

**Export format matrix:**

| Source type | Available formats |
|-------------|-------------------|
| Google Docs | `pdf`, `docx`, `txt`, `html` |
| Google Sheets | `pdf`, `xlsx`, `csv` |
| Google Slides | `pdf`, `pptx` |
| Google Drawings | `pdf` |

Not all combinations work — the table shows supported ones. Unsupported combos return `DRIVE_ERROR`.

**Note:** `export <id> csv` only exports the **first sheet**. To read a specific sheet or tab, use [`go-sheets`](sheets.md) instead.

#### upload (WRITE)
Upload a file.
```bash
npx go-drive <account> upload ./report.pdf
npx go-drive <account> upload ./report.pdf --folder=<folderId>
npx go-drive <account> upload ./report.pdf --name="Q1 Report.pdf"
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### mkdir (WRITE)
Create a folder.
```bash
npx go-drive <account> mkdir "New Folder"
npx go-drive <account> mkdir "Subfolder" --parent=<folderId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### move (WRITE)
Move a file to a different folder.
```bash
npx go-drive <account> move <fileId> <newParentId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### rename (WRITE)
Rename a file.
```bash
npx go-drive <account> rename <fileId> "new-name.pdf"
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### copy (WRITE)
Copy a file.
```bash
npx go-drive <account> copy <fileId>
npx go-drive <account> copy <fileId> --name="Copy of report" --parent=<folderId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

Without `--name`, the copy is named "Copy of \<original name\>". Without `--parent`, it stays in the same folder.

#### trash ⚠️ DESTRUCTIVE
Trash a file. Requires `--confirm`.
```bash
npx go-drive <account> trash <fileId> --confirm
```
Returns: `{ ok: true, id, name }`

#### permissions
List sharing permissions on a file.
```bash
npx go-drive <account> permissions <fileId>
```
Returns: `Array<{ id, type, role, emailAddress?, displayName? }>` (bare array)

#### share ⚠️ DESTRUCTIVE (when type=anyone or type=domain)
Share a file. Requires `--confirm` when sharing with "anyone" or "domain" (exposes data broadly).
```bash
# Share with specific user (WRITE — no --confirm needed)
npx go-drive <account> share <fileId> --type=user --role=reader --email=other@example.com

# Share publicly (DESTRUCTIVE — needs --confirm)
npx go-drive <account> share <fileId> --type=anyone --role=reader --confirm

# Share with domain (DESTRUCTIVE — needs --confirm)
npx go-drive <account> share <fileId> --type=domain --role=reader --domain=example.com --confirm
```
Returns: `{ ok: true, id, name, webViewLink? }`

**Roles:** `reader`, `commenter`, `writer`

#### unshare ⚠️ DESTRUCTIVE
Remove a permission. Requires `--confirm`.
```bash
npx go-drive <account> unshare <fileId> <permissionId> --confirm
```
Returns: `{ ok: true, id, name }`

Get the `permissionId` from the `permissions` command.

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listFiles, searchFiles, getFile, downloadFile, exportFile,
         uploadFile, createFolder, moveFile, renameFile, copyFile,
         trashFile, listPermissions, shareFile, unshareFile
} from '@marcfargas/go-easy/drive';

const auth = await getAuth('drive', '<account>');

// List with pagination
const page1 = await listFiles(auth, { folderId: 'folder-id', maxResults: 50 });
if (page1.nextPageToken) {
  const page2 = await listFiles(auth, { folderId: 'folder-id', maxResults: 50, pageToken: page1.nextPageToken });
}

// Full-text search
const results = await searchFiles(auth, { query: 'contract' });

// Get metadata
const file = await getFile(auth, 'file-id');

// Download (returns Buffer — library does NOT write to disk)
const { data, name, mimeType } = await downloadFile(auth, 'file-id');
// data is a Buffer — write it yourself: fs.writeFileSync('out.pdf', data)

// Export (returns Buffer — library does NOT write to disk)
const exported = await exportFile(auth, 'doc-id', 'pdf');
// exported.data is a Buffer

// Write operations
const uploaded = await uploadFile(auth, './file.pdf', { folderId: 'folder-id' });
const folder = await createFolder(auth, 'New Folder', 'parent-id');
await moveFile(auth, 'file-id', 'new-parent-id');
await renameFile(auth, 'file-id', 'new-name.pdf');
await copyFile(auth, 'file-id', 'Copy', 'parent-id');

// Destructive (needs safety context)
await trashFile(auth, 'file-id');
await shareFile(auth, 'file-id', { type: 'anyone', role: 'reader' });
await unshareFile(auth, 'file-id', 'permission-id');

// Permissions
const perms = await listPermissions(auth, 'file-id');
```

**Library vs CLI difference:** `downloadFile` and `exportFile` return `{ data: Buffer, ... }` in the library. The CLI writes to disk and returns `{ path, size }`.

## Drive Query Syntax (for ls --query)

Same as Drive API v3 query syntax. **Shell quoting**: wrap the whole query in double quotes; use single quotes for string values inside:

```bash
npx go-drive <account> ls --query="name contains 'report'"
npx go-drive <account> ls --query="mimeType = 'application/pdf' and name contains 'invoice'"
```

Common queries:
- `name = 'report.pdf'` — exact name match
- `name contains 'report'` — name contains text
- `mimeType = 'application/pdf'` — by MIME type
- `modifiedTime > '2026-01-01'` — modified after date
- `'me' in owners` — owned by me
- `sharedWithMe` — shared with me
- `trashed = false` — not in trash (default)

Combine with `and`/`or`:
```
name contains 'report' and mimeType = 'application/pdf'
```

### Google Workspace MIME types

| Type | MIME type |
|------|-----------|
| Folder | `application/vnd.google-apps.folder` |
| Document | `application/vnd.google-apps.document` |
| Spreadsheet | `application/vnd.google-apps.spreadsheet` |
| Presentation | `application/vnd.google-apps.presentation` |
| Drawing | `application/vnd.google-apps.drawing` |
| Form | `application/vnd.google-apps.form` |

## Types

```typescript
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;           // not present for Google Workspace files
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  driveId?: string;        // Shared Drive ID (present for Shared Drive files)
  shared?: boolean;
  trashed?: boolean;
}

interface DrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  displayName?: string;
}
```

## Error Codes

| Code | Meaning | Exit Code |
|------|---------|-----------|
| `AUTH_NO_ACCOUNT` | Account not configured | 1 |
| `AUTH_PROTECTED` | Account exists but `--pass` was not supplied | 1 |
| `AUTH_PASS_WRONG` | `--pass` supplied but incorrect | 1 |
| `AUTH_MISSING_SCOPE` | Account exists but missing Drive scope | 1 |
| `AUTH_TOKEN_REVOKED` | Refresh token revoked — re-auth needed | 1 |
| `AUTH_NO_CREDENTIALS` | OAuth credentials missing | 1 |
| `NOT_FOUND` | File not found (404) | 1 |
| `QUOTA_EXCEEDED` | Drive API rate limit (429) — wait 30s and retry | 1 |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` | 2 |
| `DRIVE_ERROR` | Other Drive API error | 1 |
| `DRIVE_EXPORT_REQUIRED` | Tried to download a Google Workspace file — use `export` | 1 |

Auth errors include a `fix` field: `{ "error": "AUTH_NO_ACCOUNT", "fix": "npx go-easy auth add <email>" }`

## Available Accounts

```bash
npx go-easy auth list
```

If an account is missing, add it: `npx go-easy auth add <email>` (see [SKILL.md](SKILL.md) for the full auth workflow).
