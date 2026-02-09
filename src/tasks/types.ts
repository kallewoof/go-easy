/**
 * Tasks types — agent-friendly shapes, not raw API types.
 */

/** A task list */
export interface TaskList {
  id: string;
  title: string;
  updated?: string;
}

/** A task */
export interface Task {
  id: string;
  title: string;
  /** Detailed notes / description */
  notes?: string;
  /** Status: 'needsAction' or 'completed' */
  status: 'needsAction' | 'completed';
  /** Due date (RFC 3339 date, e.g. '2026-02-14T00:00:00.000Z') */
  due?: string;
  /** Completion datetime (RFC 3339) */
  completed?: string;
  /** Parent task ID (for subtasks) */
  parent?: string;
  /** Position string (for ordering) */
  position?: string;
  /** Whether this task is hidden (completed + cleared) */
  hidden?: boolean;
  /** Whether this task is deleted */
  deleted?: boolean;
  /** Links associated with the task */
  links?: Array<{ type?: string; description?: string; link?: string }>;
  /** Last updated */
  updated?: string;
}

/** Options for creating/updating a task */
export interface TaskOptions {
  title: string;
  notes?: string;
  /** Due date: ISO 8601 date (e.g. '2026-02-14') or datetime */
  due?: string;
  /** Status: 'needsAction' or 'completed' */
  status?: 'needsAction' | 'completed';
  /** Parent task ID (to create a subtask) */
  parent?: string;
  /** Previous sibling task ID (for ordering) */
  previous?: string;
}

/** Options for listing tasks */
export interface ListTasksOptions {
  /** Maximum results (default: 20) */
  maxResults?: number;
  /** Page token for pagination */
  pageToken?: string;
  /** Due min (RFC 3339 datetime) */
  dueMin?: string;
  /** Due max (RFC 3339 datetime) */
  dueMax?: string;
  /** Show completed tasks (default: true) */
  showCompleted?: boolean;
  /** Show hidden tasks (default: false) */
  showHidden?: boolean;
  /** Show deleted tasks (default: false) */
  showDeleted?: boolean;
}

/** Paginated list result */
export interface ListResult<T> {
  items: T[];
  nextPageToken?: string;
}

/** Result of a write operation */
export interface WriteResult {
  ok: true;
  id: string;
}
