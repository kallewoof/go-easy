# go-easy: Tasks Reference

## Gateway CLI: `npx go-tasks`

```
npx go-tasks <account> <command> [args...] [--pass <phrase>] [--flags]
```

`--pass <phrase>` is required when the account is passphrase-protected (see [SKILL.md](SKILL.md)).

All commands output JSON to stdout. Errors output JSON to stderr with exit code 1.

> **New scope**: Tasks requires the `tasks` scope. Existing combined tokens (gmail+drive+calendar)
> don't include it. Run `npx go-easy auth add <email>` to re-authorize with tasks included.

### Commands

#### lists
List all task lists.
```bash
npx go-tasks <account> lists
```
Returns: bare `Array<TaskList>`

Every Google account has a default list called "My Tasks".

#### tasks
List tasks in a task list.
```bash
# All tasks (including completed)
npx go-tasks <account> tasks <listId>

# Limit results and paginate
npx go-tasks <account> tasks <listId> --max=10
npx go-tasks <account> tasks <listId> --max=50 --page-token=<token>

# Show hidden tasks (completed + cleared)
npx go-tasks <account> tasks <listId> --show-hidden
```
Returns: `{ items: Task[], nextPageToken? }`

**Defaults:**
- `--max`: 20 per page
- Completed tasks are shown by default
- Hidden tasks (completed + cleared) are hidden by default

#### get
Get a single task by ID.
```bash
npx go-tasks <account> get <listId> <taskId>
```
Returns: `Task`

#### add (WRITE)
Create a new task.
```bash
# Simple task
npx go-tasks <account> add <listId> --title="Buy milk"

# With notes and due date
npx go-tasks <account> add <listId> --title="File taxes" \
  --notes="Use TurboTax" --due=2026-04-15

# Subtask (child of another task)
npx go-tasks <account> add <listId> --title="Buy oat milk" --parent=<parentTaskId>

# Insert after a specific sibling
npx go-tasks <account> add <listId> --title="Second item" --previous=<siblingTaskId>
```
Returns: `{ ok: true, id }`

**Due dates**: Date-only format `YYYY-MM-DD` (normalized to `YYYY-MM-DDT00:00:00.000Z` internally).
Full RFC 3339 datetimes also accepted.

#### update (WRITE)
Update a task. Uses PATCH — only provided fields are changed.
```bash
# Update title
npx go-tasks <account> update <listId> <taskId> --title="Updated title"

# Update due date and notes
npx go-tasks <account> update <listId> <taskId> \
  --due=2026-03-01 --notes="New notes"

# Mark as needs action (uncomplete)
npx go-tasks <account> update <listId> <taskId> --status=needsAction
```
Returns: `{ ok: true, id }`

#### complete (WRITE)
Mark a task as completed. Shorthand for `update --status=completed`.
```bash
npx go-tasks <account> complete <listId> <taskId>
```
Returns: `{ ok: true, id }`

#### move (WRITE)
Move or reorder a task within a list.
```bash
# Make it a subtask of another task
npx go-tasks <account> move <listId> <taskId> --parent=<parentTaskId>

# Move after a specific sibling
npx go-tasks <account> move <listId> <taskId> --previous=<siblingTaskId>

# Move to top level (unparent)
npx go-tasks <account> move <listId> <taskId>
```
Returns: `{ ok: true, id }`

#### delete ⚠️ DESTRUCTIVE
Delete a task. Requires `--confirm`.
```bash
npx go-tasks <account> delete <listId> <taskId> --confirm
```
Returns: `{ ok: true, id }`

Without `--confirm`:
```json
{ "blocked": true, "operation": "tasks.deleteTask", "description": "Delete task \"Buy milk\"", "hint": "Add --confirm" }
```

#### create-list (WRITE)
Create a new task list.
```bash
npx go-tasks <account> create-list --title="Shopping"
```
Returns: `{ ok: true, id }`

#### delete-list ⚠️ DESTRUCTIVE
Delete a task list and all its tasks. Requires `--confirm`.
```bash
npx go-tasks <account> delete-list <listId> --confirm
```
Returns: `{ ok: true, id }`

⚠️ This deletes the list **and all tasks in it** permanently.

#### clear ⚠️ DESTRUCTIVE
Clear all completed tasks from a list. Requires `--confirm`.
```bash
npx go-tasks <account> clear <listId> --confirm
```
Returns: `{ ok: true, id }`

## Library API

```typescript
import { getAuth } from '@marcfargas/go-easy/auth';
import { listTaskLists, listTasks, getTask, createTask,
         updateTask, completeTask, moveTask, deleteTask,
         createTaskList, deleteTaskList, clearCompleted
} from '@marcfargas/go-easy/tasks';
import { setSafetyContext } from '@marcfargas/go-easy';

const auth = await getAuth('tasks', '<account>');

// List task lists
const lists = await listTaskLists(auth);

// List tasks (with pagination)
const page1 = await listTasks(auth, 'listId', { maxResults: 50 });
if (page1.nextPageToken) {
  const page2 = await listTasks(auth, 'listId', {
    maxResults: 50,
    pageToken: page1.nextPageToken,
  });
}

// Get a task
const task = await getTask(auth, 'listId', 'taskId');

// Create a task
const created = await createTask(auth, 'listId', {
  title: 'Buy milk',
  notes: 'Whole milk',
  due: '2026-02-14',
});

// Create a subtask
await createTask(auth, 'listId', {
  title: 'Buy oat milk',
  parent: 'parentTaskId',
});

// Update (PATCH — only provided fields)
await updateTask(auth, 'listId', 'taskId', { title: 'Updated' });

// Complete
await completeTask(auth, 'listId', 'taskId');

// Move (reparent or reorder)
await moveTask(auth, 'listId', 'taskId', { parent: 'newParentId' });

// Destructive — needs safety context
setSafetyContext({ confirm: async (op) => { /* ... */ return true; } });
await deleteTask(auth, 'listId', 'taskId');
await deleteTaskList(auth, 'listId');
await clearCompleted(auth, 'listId');
```

## Subtasks

Tasks can be nested one level deep using the `--parent` flag:

- **On creation**: `add --parent=<taskId>` creates a subtask
- **On move**: `move --parent=<taskId>` reparents a task
- **On move** (no parent): `move` without `--parent` promotes a subtask to top level

The `parent` field in the Task object shows the parent task ID (if any).

## Types

```typescript
interface TaskList {
  id: string;
  title: string;
  updated?: string;
}

interface Task {
  id: string;
  title: string;
  notes?: string;               // detailed description
  status: 'needsAction' | 'completed';
  due?: string;                  // RFC 3339 datetime (e.g. '2026-02-14T00:00:00.000Z')
  completed?: string;            // RFC 3339 datetime (when completed)
  parent?: string;               // parent task ID (for subtasks)
  position?: string;             // ordering within the list
  hidden?: boolean;              // completed + cleared
  deleted?: boolean;
  links?: Array<{
    type?: string;
    description?: string;
    link?: string;
  }>;
  updated?: string;
}
```

## Error Codes

| Code | Meaning | Exit Code |
|------|---------|-----------|
| `AUTH_NO_ACCOUNT` | Account not configured | 1 |
| `AUTH_PROTECTED` | Account exists but `--pass` was not supplied | 1 |
| `AUTH_PASS_WRONG` | `--pass` supplied but incorrect | 1 |
| `AUTH_MISSING_SCOPE` | Account exists but missing Tasks scope | 1 |
| `AUTH_TOKEN_REVOKED` | Refresh token revoked — re-auth needed | 1 |
| `AUTH_NO_CREDENTIALS` | OAuth credentials missing | 1 |
| `NOT_FOUND` | Task or task list not found (404) | 1 |
| `QUOTA_EXCEEDED` | Tasks API rate limit (429) — wait 30s and retry | 1 |
| `SAFETY_BLOCKED` | Destructive op without `--confirm` | 2 |
| `TASKS_ERROR` | Other Tasks API error | 1 |

Auth errors include a `fix` field: `{ "error": "AUTH_MISSING_SCOPE", "fix": "npx go-easy auth add <email>" }`

## Available Accounts

```bash
npx go-easy auth list
```

If an account is missing or lacks the tasks scope, add/upgrade it: `npx go-easy auth add <email>` (see [SKILL.md](SKILL.md) for the full auth workflow).
