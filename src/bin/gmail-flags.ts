import { readFileSync } from 'node:fs';

/** Parse --key=value and --key value flags from args */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/s);
    if (!match) continue;
    if (match[2] !== undefined) {
      flags[match[1]] = match[2];
    } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[match[1]] = args[++i];
    } else {
      flags[match[1]] = 'true';
    }
  }
  return flags;
}

/**
 * Read body content from file flags.
 * Returns { body?, html?, markdown? } for SendOptions.
 */
export function readBodyFlags(flags: Record<string, string>): {
  body?: string;
  html?: string;
  markdown?: string;
} {
  const result: { body?: string; html?: string; markdown?: string } = {};

  if (flags['body-text-file']) {
    result.body = readFileSync(flags['body-text-file'], 'utf-8');
  }
  if (flags['body-html-file']) {
    result.html = readFileSync(flags['body-html-file'], 'utf-8');
  }
  if (flags['body-md-file']) {
    result.markdown = readFileSync(flags['body-md-file'], 'utf-8');
  }

  return result;
}
