/**
 * Google Tasks operations — agent-friendly wrappers.
 *
 * All functions take an OAuth2Client and return typed results.
 * Destructive operations (delete, clear) are gated by the safety system.
 */

import { tasks as tasksApi, type tasks_v1 } from '@googleapis/tasks';
import type { OAuth2Client } from 'google-auth-library';
import { GoEasyError, NotFoundError, QuotaError } from '../errors.js';
import { guardOperation } from '../safety.js';
import { parseTaskList, parseTask } from './helpers.js';
import type {
  TaskList,
  Task,
  TaskOptions,
  ListTasksOptions,
  ListResult,
  WriteResult,
} from './types.js';

// Re-export types
export type {
  TaskList,
  Task,
  TaskOptions,
  ListTasksOptions,
  ListResult,
  WriteResult,
} from './types.js';

// ─── API client factory ────────────────────────────────────

function tasksClient(auth: OAuth2Client): tasks_v1.Tasks {
  return tasksApi({ version: 'v1', auth });
}

// ─── Error handling ────────────────────────────────────────

function handleApiError(err: unknown, context: string): never {
  const gErr = err as { code?: number; message?: string };
  if (gErr.code === 404) throw new NotFoundError('task', context, err);
  if (gErr.code === 429) throw new QuotaError('tasks', err);
  throw new GoEasyError(
    `Tasks ${context}: ${gErr.message ?? 'Unknown error'}`,
    'TASKS_ERROR',
    err
  );
}

// ─── Task Lists ────────────────────────────────────────────

/**
 * List all task lists.
 */
export async function listTaskLists(
  auth: OAuth2Client
): Promise<TaskList[]> {
  const api = tasksClient(auth);
  try {
    const res = await api.tasklists.list({ maxResults: 100 });
    return (res.data.items ?? []).map(parseTaskList);
  } catch (err) {
    handleApiError(err, 'listTaskLists');
  }
}

/**
 * Create a new task list.
 */
export async function createTaskList(
  auth: OAuth2Client,
  title: string
): Promise<WriteResult> {
  const api = tasksClient(auth);
  try {
    const res = await api.tasklists.insert({
      requestBody: { title },
    });
    return { ok: true, id: res.data.id ?? '' };
  } catch (err) {
    handleApiError(err, 'createTaskList');
  }
}

/**
 * Delete a task list.
 *
 * ⚠️ DESTRUCTIVE — requires safety confirmation.
 */
export async function deleteTaskList(
  auth: OAuth2Client,
  taskListId: string
): Promise<WriteResult> {
  const api = tasksClient(auth);

  // Fetch for confirmation details
  let title = taskListId;
  try {
    const res = await api.tasklists.get({ tasklist: taskListId });
    title = res.data.title ?? taskListId;
  } catch {
    // Use ID as fallback
  }

  await guardOperation({
    level: 'DESTRUCTIVE',
    name: 'tasks.deleteTaskList',
    description: `Delete task list "${title}" and all its tasks`,
  });

  try {
    await api.tasklists.delete({ tasklist: taskListId });
    return { ok: true, id: taskListId };
  } catch (err) {
    handleApiError(err, `deleteTaskList ${taskListId}`);
  }
}

// ─── Tasks ─────────────────────────────────────────────────

/**
 * List tasks in a task list.
 */
export async function listTasks(
  auth: OAuth2Client,
  taskListId: string,
  opts: ListTasksOptions = {}
): Promise<ListResult<Task>> {
  const api = tasksClient(auth);
  try {
    const res = await api.tasks.list({
      tasklist: taskListId,
      maxResults: opts.maxResults ?? 20,
      pageToken: opts.pageToken,
      dueMin: opts.dueMin,
      dueMax: opts.dueMax,
      showCompleted: opts.showCompleted ?? true,
      showHidden: opts.showHidden ?? false,
      showDeleted: opts.showDeleted ?? false,
    });
    return {
      items: (res.data.items ?? []).map(parseTask),
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  } catch (err) {
    handleApiError(err, 'listTasks');
  }
}

/**
 * Get a single task by ID.
 */
export async function getTask(
  auth: OAuth2Client,
  taskListId: string,
  taskId: string
): Promise<Task> {
  const api = tasksClient(auth);
  try {
    const res = await api.tasks.get({
      tasklist: taskListId,
      task: taskId,
    });
    return parseTask(res.data);
  } catch (err) {
    handleApiError(err, `getTask ${taskId}`);
  }
}

/**
 * Create a new task.
 */
export async function createTask(
  auth: OAuth2Client,
  taskListId: string,
  opts: TaskOptions
): Promise<WriteResult> {
  const api = tasksClient(auth);
  try {
    const body: tasks_v1.Schema$Task = {
      title: opts.title,
    };
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.due !== undefined) {
      // Normalize date-only to RFC 3339 datetime
      body.due = opts.due.includes('T') ? opts.due : `${opts.due}T00:00:00.000Z`;
    }
    if (opts.status !== undefined) body.status = opts.status;

    const res = await api.tasks.insert({
      tasklist: taskListId,
      parent: opts.parent,
      previous: opts.previous,
      requestBody: body,
    });
    return { ok: true, id: res.data.id ?? '' };
  } catch (err) {
    handleApiError(err, 'createTask');
  }
}

/**
 * Update a task. Uses PATCH semantics — only provided fields are changed.
 */
export async function updateTask(
  auth: OAuth2Client,
  taskListId: string,
  taskId: string,
  opts: Partial<TaskOptions>
): Promise<WriteResult> {
  const api = tasksClient(auth);
  try {
    const body: tasks_v1.Schema$Task = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.due !== undefined) {
      body.due = opts.due.includes('T') ? opts.due : `${opts.due}T00:00:00.000Z`;
    }
    if (opts.status !== undefined) body.status = opts.status;

    const res = await api.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: body,
    });
    return { ok: true, id: res.data.id ?? '' };
  } catch (err) {
    handleApiError(err, `updateTask ${taskId}`);
  }
}

/**
 * Complete a task (shorthand for update with status='completed').
 */
export async function completeTask(
  auth: OAuth2Client,
  taskListId: string,
  taskId: string
): Promise<WriteResult> {
  return updateTask(auth, taskListId, taskId, { status: 'completed' });
}

/**
 * Move a task (reorder or reparent).
 */
export async function moveTask(
  auth: OAuth2Client,
  taskListId: string,
  taskId: string,
  opts: { parent?: string; previous?: string } = {}
): Promise<WriteResult> {
  const api = tasksClient(auth);
  try {
    const res = await api.tasks.move({
      tasklist: taskListId,
      task: taskId,
      parent: opts.parent,
      previous: opts.previous,
    });
    return { ok: true, id: res.data.id ?? '' };
  } catch (err) {
    handleApiError(err, `moveTask ${taskId}`);
  }
}

/**
 * Delete a task.
 *
 * ⚠️ DESTRUCTIVE — requires safety confirmation.
 */
export async function deleteTask(
  auth: OAuth2Client,
  taskListId: string,
  taskId: string
): Promise<WriteResult> {
  const api = tasksClient(auth);

  // Fetch for confirmation details
  let title = taskId;
  try {
    const res = await api.tasks.get({ tasklist: taskListId, task: taskId });
    title = res.data.title ?? taskId;
  } catch {
    // Use ID as fallback
  }

  await guardOperation({
    level: 'DESTRUCTIVE',
    name: 'tasks.deleteTask',
    description: `Delete task "${title}"`,
  });

  try {
    await api.tasks.delete({ tasklist: taskListId, task: taskId });
    return { ok: true, id: taskId };
  } catch (err) {
    handleApiError(err, `deleteTask ${taskId}`);
  }
}

/**
 * Clear all completed tasks from a task list.
 *
 * ⚠️ DESTRUCTIVE — requires safety confirmation.
 */
export async function clearCompleted(
  auth: OAuth2Client,
  taskListId: string
): Promise<WriteResult> {
  const api = tasksClient(auth);

  await guardOperation({
    level: 'DESTRUCTIVE',
    name: 'tasks.clearCompleted',
    description: `Clear all completed tasks from task list`,
  });

  try {
    await api.tasks.clear({ tasklist: taskListId });
    return { ok: true, id: taskListId };
  } catch (err) {
    handleApiError(err, `clearCompleted ${taskListId}`);
  }
}
