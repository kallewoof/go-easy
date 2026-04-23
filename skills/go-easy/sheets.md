# go-easy: Sheets Reference

## Gateway CLI: `npx go-sheets`

```
npx go-sheets <account> <command> [args...] [--flags]
```

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

### Commands

#### tabs
List all sheet tabs in a spreadsheet.
```bash
npx go-sheets <account> tabs <spreadsheetId>
```
Returns: `SheetTab[]` (bare array)

Each tab includes its numeric `sheetId`, human-visible `title`, `index`, `rowCount`, `colCount`, `sheetType`, and `hidden` flag.

Use `sheetId` (numeric) as a stable reference — tab titles can be renamed. Use the `title` in range strings (e.g. `Revenue!A1:Z`).

#### read
Read cell values from a range.
```bash
# Read a named range or full sheet
npx go-sheets <account> read <spreadsheetId> "Sheet1!A1:Z"
npx go-sheets <account> read <spreadsheetId> "Sheet1"

# Read with specific render option
npx go-sheets <account> read <spreadsheetId> "Sheet1!A1:D10" --render=UNFORMATTED_VALUE
npx go-sheets <account> read <spreadsheetId> "Sheet1!A1:D10" --render=FORMULA
```
Returns: `string[][]` (array of rows, each row an array of cell values)

**`--render` options:**
- `FORMATTED_VALUE` (default) — what the user sees, e.g. `"$1,234.56"`, `"Jan 5 2025"`
- `UNFORMATTED_VALUE` — raw numbers/booleans; dates become float serial numbers (days since Dec 30 1899)
- `FORMULA` — formula strings for formula cells, raw values for others

**Important:** The API omits trailing empty rows and trims trailing empty cells from each row. The returned array may be ragged — do not assume rectangular shape. If you need rectangular output, pad each row yourself.

#### write (WRITE)
Write values to a range from a JSON file.
```bash
npx go-sheets <account> write <spreadsheetId> "Sheet1!A1" --values-file=./data.json
npx go-sheets <account> write <spreadsheetId> "Sheet1!A1:B2" --values-file=./data.json --input=RAW
```
`--values-file` must contain a JSON array of arrays, e.g.:
```json
[["Name", "Score"], ["Alice", 95], ["Bob", 87]]
```
Returns: `{ ok: true, updatedRows, updatedColumns, updatedCells, updatedRange }`

**`--input` options:**
- `USER_ENTERED` (default) — parsed as if typed into the UI; formulas like `=SUM(A1:A5)` work
- `RAW` — all values treated as literal strings/numbers; formulas are stored as text

Only cells with corresponding entries in the values array are written. Other cells in the range are untouched — `write` does not clear cells that have no value provided.

#### clear (WRITE)
Clear all values in a range (formatting is preserved).
```bash
npx go-sheets <account> clear <spreadsheetId> "Sheet1!A1:Z"
```
Returns: `{ ok: true, updatedRange }`

This removes cell values entirely (equivalent to selecting the range and pressing Delete). To write empty strings instead, use `write` with `""` values.

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listSheets, getValues, updateValues, clearValues } from '@marcfargas/go-easy/sheets';

const auth = await getAuth('sheets', '<account>');

// List tabs
const tabs = await listSheets(auth, 'spreadsheetId');
// tabs[0] → { sheetId: 0, title: 'Sheet1', index: 0, rowCount: 1000, colCount: 26, ... }

// Read values (returns string[][] — may be ragged)
const values = await getValues(auth, 'spreadsheetId', 'Sheet1!A1:Z');
const raw = await getValues(auth, 'spreadsheetId', 'Sheet1', { valueRenderOption: 'UNFORMATTED_VALUE' });

// Write values
const result = await updateValues(auth, 'spreadsheetId', 'Sheet1!A1', [['hello', 'world']]);
// result → { ok: true, updatedRows: 1, updatedColumns: 2, updatedCells: 2, ... }

// Write with RAW input (formulas stored as text)
await updateValues(auth, 'spreadsheetId', 'A1', [['=SUM(B1:B5)']], { valueInputOption: 'RAW' });

// Clear a range
await clearValues(auth, 'spreadsheetId', 'Sheet1!A1:Z');
```

## Range Syntax

Ranges use A1 notation: `SheetTitle!StartCell:EndCell`

```
Sheet1            → entire sheet (all data)
Sheet1!A1:Z       → row 1 to end, columns A–Z
Sheet1!A1:D10     → rows 1–10, columns A–D
Sheet1!A:A        → entire column A
Sheet1!1:1        → entire row 1
```

If the sheet title contains spaces or special characters, wrap it in single quotes: `'My Sheet'!A1:Z`

## Types

```typescript
interface SheetTab {
  sheetId: number;       // stable numeric ID (use in batchUpdate requests)
  title: string;         // human-visible tab name (use in range strings)
  index: number;         // zero-based left-to-right position
  rowCount: number;      // allocated grid rows (includes empty rows)
  colCount: number;      // allocated grid columns (includes empty columns)
  sheetType: string;     // 'GRID' for regular sheets, 'OBJECT' for chart sheets
  hidden: boolean;
}

interface SheetWriteResult {
  ok: true;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
  updatedRange?: string;
}
```

## Error Codes

| Code | Meaning | Exit Code |
|------|---------|-----------|
| `AUTH_NO_ACCOUNT` | Account not configured | 1 |
| `AUTH_MISSING_SCOPE` | Account exists but missing Sheets scope | 1 |
| `AUTH_TOKEN_REVOKED` | Refresh token revoked — re-auth needed | 1 |
| `AUTH_NO_CREDENTIALS` | OAuth credentials missing | 1 |
| `NOT_FOUND` | Spreadsheet not found (404) | 1 |
| `QUOTA_EXCEEDED` | Sheets API rate limit (429) — wait and retry | 1 |
| `SHEETS_ERROR` | Other Sheets API error (e.g. 403 permission denied) | 1 |

Auth errors include a `fix` field: `{ "error": "AUTH_NO_ACCOUNT", "fix": "npx go-easy auth add <email>" }`

**Note on 403:** A `SHEETS_ERROR` with a permission-denied message usually means the account's token lacks the `spreadsheets` scope. Re-authenticate: `npx go-easy auth add <email>`

## Available Accounts

```bash
npx go-easy auth list
```

If an account is missing or lacks Sheets scope, add it: `npx go-easy auth add <email>` (see [SKILL.md](SKILL.md) for the full auth workflow).
