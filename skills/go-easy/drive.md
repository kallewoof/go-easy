# go-easy: Drive Reference

## Gateway CLI: `npx go-drive`

```
npx go-drive <account> <command> [args...] [--flags]
```

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

### Commands

#### ls
List files in a folder or by metadata query.
```bash
# List root folder (most recently modified first)
npx go-drive marc@blegal.eu ls

# List specific folder
npx go-drive marc@blegal.eu ls <folderId>

# With metadata query
npx go-drive marc@blegal.eu ls --query="name contains 'report'"

# Combine folder + query
npx go-drive marc@blegal.eu ls <folderId> --query="mimeType = 'application/pdf'" --max=10

# Order by name
npx go-drive marc@blegal.eu ls --order="name"
```
Returns: `{ items: DriveFile[], nextPageToken? }`

#### search
Full-text content search (searches inside files).
```bash
npx go-drive marc@blegal.eu search "quarterly revenue"
npx go-drive marc@blegal.eu search "contract clause 5" --max=5
```
Returns: `{ items: DriveFile[], nextPageToken? }`

**Note**: `search` searches file *contents*. Use `ls --query` to search by filename/metadata.

#### get
Get file metadata by ID.
```bash
npx go-drive marc@blegal.eu get <fileId>
```
Returns: `DriveFile`

#### download
Download a file (writes to disk).
```bash
npx go-drive marc@blegal.eu download <fileId>              # saves as original filename
npx go-drive marc@blegal.eu download <fileId> ./output.pdf  # saves to specific path
```
Returns: `{ ok: true, path, size, mimeType }`

**Note**: Cannot download Google Workspace files (Docs/Sheets/Slides). Use `export` instead.

#### export
Export Google Workspace files to standard formats.
```bash
npx go-drive marc@blegal.eu export <fileId> pdf
npx go-drive marc@blegal.eu export <fileId> docx ./output.docx
npx go-drive marc@blegal.eu export <fileId> xlsx
npx go-drive marc@blegal.eu export <fileId> csv
```
Formats: `pdf`, `docx`, `xlsx`, `pptx`, `csv`, `txt`, `html`

Returns: `{ ok: true, path, size, mimeType }`

#### upload (WRITE)
Upload a file.
```bash
npx go-drive marc@blegal.eu upload ./report.pdf
npx go-drive marc@blegal.eu upload ./report.pdf --folder=<folderId>
npx go-drive marc@blegal.eu upload ./report.pdf --name="Q1 Report.pdf"
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### mkdir (WRITE)
Create a folder.
```bash
npx go-drive marc@blegal.eu mkdir "New Folder"
npx go-drive marc@blegal.eu mkdir "Subfolder" --parent=<folderId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### move (WRITE)
Move a file to a different folder.
```bash
npx go-drive marc@blegal.eu move <fileId> <newParentId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### rename (WRITE)
Rename a file.
```bash
npx go-drive marc@blegal.eu rename <fileId> "new-name.pdf"
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### copy (WRITE)
Copy a file.
```bash
npx go-drive marc@blegal.eu copy <fileId>
npx go-drive marc@blegal.eu copy <fileId> --name="Copy of report" --parent=<folderId>
```
Returns: `{ ok: true, id, name, webViewLink? }`

Without `--name`, the copy is named "Copy of \<original name\>". Without `--parent`, it stays in the same folder.

#### trash ⚠️ DESTRUCTIVE
Trash a file. Requires `--confirm`.
```bash
npx go-drive marc@blegal.eu trash <fileId> --confirm
```
Returns: `{ ok: true, id, name }`

#### permissions
List sharing permissions on a file.
```bash
npx go-drive marc@blegal.eu permissions <fileId>
```
Returns: `Array<{ id, type, role, emailAddress?, displayName? }>` (bare array)

#### share ⚠️ DESTRUCTIVE (when type=anyone)
Share a file. Requires `--confirm` when sharing with "anyone".
```bash
# Share with specific user
npx go-drive marc@blegal.eu share <fileId> --type=user --role=reader --email=other@example.com

# Share publicly (DESTRUCTIVE — needs --confirm)
npx go-drive marc@blegal.eu share <fileId> --type=anyone --role=reader --confirm

# Share with domain
npx go-drive marc@blegal.eu share <fileId> --type=domain --role=reader --domain=example.com
```
Returns: `{ ok: true, id, name, webViewLink? }`

#### unshare ⚠️ DESTRUCTIVE
Remove a permission. Requires `--confirm`.
```bash
npx go-drive marc@blegal.eu unshare <fileId> <permissionId> --confirm
```
Returns: `{ ok: true, id, name }`

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listFiles, searchFiles, getFile, downloadFile, exportFile,
         uploadFile, createFolder, moveFile, renameFile, copyFile,
         trashFile, listPermissions, shareFile, unshareFile
} from '@marcfargas/go-easy/drive';

const auth = await getAuth('drive', 'marc@blegal.eu');

// List & Search
const files = await listFiles(auth, { folderId: 'folder-id', maxResults: 10 });
const results = await searchFiles(auth, { query: 'contract' });

// Get & Download
const file = await getFile(auth, 'file-id');
const { data, name } = await downloadFile(auth, 'file-id');
const exported = await exportFile(auth, 'doc-id', 'pdf');

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

## Drive Query Syntax (for ls --query)

Same as Drive API v3 query syntax:
- `name = 'report.pdf'` — exact name match
- `name contains 'report'` — name contains text
- `mimeType = 'application/pdf'` — by MIME type
- `mimeType = 'application/vnd.google-apps.folder'` — folders only
- `mimeType contains 'image/'` — all images
- `modifiedTime > '2026-01-01'` — modified after date
- `'me' in owners` — owned by me
- `sharedWithMe` — shared with me
- `trashed = false` — not in trash (default)

Combine with `and`/`or`:
```
name contains 'report' and mimeType = 'application/pdf'
```

## Types

```typescript
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;           // not present for Google Docs/Sheets/Slides
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  driveId?: string;        // Shared Drive ID
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
| `AUTH_MISSING_SCOPE` | Account exists but missing Drive scope | 1 |
| `AUTH_TOKEN_REVOKED` | Refresh token revoked — re-auth needed | 1 |
| `AUTH_NO_CREDENTIALS` | OAuth credentials missing | 1 |
| `NOT_FOUND` | File not found (404) | 1 |
| `QUOTA_EXCEEDED` | Drive API rate limit (429) — wait 30s and retry | 1 |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` | 2 |
| `DRIVE_ERROR` | Other Drive API error | 1 |
| `DRIVE_EXPORT_REQUIRED` | Tried to download a Google Workspace file — use export | 1 |

Auth errors include a `fix` field: `{ "error": "AUTH_NO_ACCOUNT", "fix": "npx go-easy auth add <email>" }`

## Available Accounts

```bash
npx go-easy auth list
```

If an account is missing, add it: `npx go-easy auth add <email>` (see [SKILL.md](SKILL.md) for the full auth workflow).
