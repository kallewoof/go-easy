import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// These files are declared as type-only. This test enforces that no executable
// JavaScript can be hidden inside them: no functions, classes, variable
// declarations, or non-type imports may appear.

const TYPE_FILES = [
  'src/gmail/types.ts',
  'src/drive/types.ts',
  'src/calendar/types.ts',
  'src/tasks/types.ts',
];

// Patterns that indicate executable (runtime) statements.
const EXECUTABLE_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*(export\s+)?(const|let|var)\s+/, 'variable declaration'],
  [/^\s*(export\s+)?(async\s+)?function\s+\w/, 'function declaration'],
  [/^\s*(export\s+)?class\s+\w/, 'class declaration'],
  [/^\s*export\s+default\s+/, 'export default'],
  [/^\s*import\s+(?!type)[\w{*]/, 'value import (use "import type")'],
];

describe('types.ts purity', () => {
  for (const relPath of TYPE_FILES) {
    it(`${relPath} contains only type-level declarations`, () => {
      const src = readFileSync(join(process.cwd(), relPath), 'utf-8');

      // Strip block comments to avoid false positives inside /* ... */
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');

      for (const line of stripped.split('\n')) {
        // Skip blank lines and single-line comments
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        for (const [pattern, label] of EXECUTABLE_PATTERNS) {
          expect(
            pattern.test(line),
            `${relPath}: found ${label} on line: ${line.trim()}`
          ).toBe(false);
        }
      }
    });
  }
});
