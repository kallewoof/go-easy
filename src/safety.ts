/**
 * Safety module — guards destructive/irreversible operations.
 *
 * Operations are classified:
 *   READ        — no gate (search, get, list)
 *   WRITE       — logged, no block (create draft, label, upload)
 *   DESTRUCTIVE — blocked unless SafetyContext.confirm() returns true
 *                 (send email, share file externally, delete event with attendees)
 *
 * Usage:
 *   // Set up context at startup (gateway or agent)
 *   setSafetyContext({
 *     confirm: async (op) => {
 *       console.log(`⚠️  ${op.description}`);
 *       return promptUser('Proceed? (y/n)') === 'y';
 *     }
 *   });
 *
 *   // Inside library functions
 *   await guardOperation({
 *     name: 'gmail.send',
 *     level: 'DESTRUCTIVE',
 *     description: 'Send email to client@example.com',
 *     details: { to: 'client@example.com', subject: 'Invoice' }
 *   });
 */

import { SafetyError } from './errors.js';

export type SafetyLevel = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export interface OperationInfo {
  /** Function name, e.g. 'gmail.send' */
  name: string;
  /** Safety classification */
  level: SafetyLevel;
  /** Human-readable description of what will happen */
  description: string;
  /** Structured details for logging */
  details?: Record<string, unknown>;
}

export interface SafetyContext {
  /**
   * Called for DESTRUCTIVE operations.
   * Return true to proceed, false to block.
   */
  confirm: (op: OperationInfo) => Promise<boolean>;
}

/** Default context: block all destructive operations */
const defaultContext: SafetyContext = {
  confirm: async () => false,
};

let currentContext: SafetyContext = defaultContext;

/** Set the safety context. Call once at startup. */
export function setSafetyContext(ctx: SafetyContext): void {
  currentContext = ctx;
}

/** Reset to default (block-all) context. Useful for tests. */
export function resetSafetyContext(): void {
  currentContext = defaultContext;
}

/** Get the current safety context. */
export function getSafetyContext(): SafetyContext {
  return currentContext;
}

/**
 * Guard an operation. READ and WRITE pass through.
 * DESTRUCTIVE operations require confirmation from the safety context.
 *
 * @throws SafetyError if destructive and not confirmed
 */
export async function guardOperation(op: OperationInfo): Promise<void> {
  if (op.level === 'READ' || op.level === 'WRITE') {
    return;
  }

  // DESTRUCTIVE — require confirmation
  const confirmed = await currentContext.confirm(op);
  if (!confirmed) {
    throw new SafetyError(op.name);
  }
}
