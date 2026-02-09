/**
 * Tasks helpers — parsing raw API responses into agent-friendly types.
 */

import type { tasks_v1 } from '@googleapis/tasks';
import type { Task, TaskList } from './types.js';

/** Parse a raw task list into our type */
export function parseTaskList(raw: tasks_v1.Schema$TaskList): TaskList {
  return {
    id: raw.id ?? '',
    title: raw.title ?? '',
    updated: raw.updated ?? undefined,
  };
}

/** Parse a raw task into our type */
export function parseTask(raw: tasks_v1.Schema$Task): Task {
  return {
    id: raw.id ?? '',
    title: raw.title ?? '',
    notes: raw.notes ?? undefined,
    status: (raw.status as Task['status']) ?? 'needsAction',
    due: raw.due ?? undefined,
    completed: raw.completed ?? undefined,
    parent: raw.parent ?? undefined,
    position: raw.position ?? undefined,
    hidden: raw.hidden ?? undefined,
    deleted: raw.deleted ?? undefined,
    links: raw.links?.map((l) => ({
      type: l.type ?? undefined,
      description: l.description ?? undefined,
      link: l.link ?? undefined,
    })),
    updated: raw.updated ?? undefined,
  };
}
