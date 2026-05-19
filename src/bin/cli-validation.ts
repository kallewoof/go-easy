/**
 * Shared argument validation for the gateway binaries (go-gmail, go-drive,
 * go-calendar, go-tasks, go-sheets). All of them take
 * `<account-email> <command> [args...]`, so the same two mistakes — passing a
 * non-email as the account, or passing an unknown command — recur across all
 * five. Catching those early surfaces a useful hint instead of a misleading
 * AUTH_NO_ACCOUNT (when `list` is parsed as an account) or UNKNOWN_FLAG with
 * an empty allow-list (when `list` is parsed as a command).
 */

import { GoEasyError } from '../errors.js';

function emitAndExit(err: GoEasyError): never {
  console.error(JSON.stringify(err.toJSON(), null, 2));
  process.exit(1);
}

export function assertAccountIsEmail(account: string, binName: string): void {
  if (account.includes('@')) return;
  emitAndExit(new GoEasyError(
    `"${account}" is not a valid account email. The first positional argument to ${binName} must be the account email — looks like you swapped it with a flag or command. Usage: ${binName} <account-email> <command> [args...]. Run \`${binName}\` (no args) for the command list, and consult the skill docs.`,
    'INVALID_SYNTAX',
  ));
}

export function assertKnownCommand(
  command: string,
  validCommands: readonly string[],
  binName: string,
): void {
  if (validCommands.includes(command)) return;
  const suggestion = closestMatch(command, validCommands);
  const tail = suggestion ? ` Did you mean "${suggestion}"?` : '';
  emitAndExit(new GoEasyError(
    `Unknown command "${command}" for ${binName}. Valid commands: ${validCommands.join(', ')}.${tail} Run \`${binName}\` (no args) for full usage.`,
    'UNKNOWN_COMMAND',
  ));
}

function closestMatch(input: string, choices: readonly string[]): string | undefined {
  let best: { word: string; dist: number } | undefined;
  for (const c of choices) {
    const d = levenshtein(input, c);
    if (!best || d < best.dist) best = { word: c, dist: d };
  }
  // Only suggest when the edit distance is small relative to the input length.
  if (!best || best.dist > Math.max(2, Math.floor(input.length / 2))) return undefined;
  return best.word;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
