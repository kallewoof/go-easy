/**
 * Markdown → HTML conversion for email bodies.
 *
 * Wraps the `marked` library with email-safe defaults:
 * - GitHub-flavored markdown (tables, strikethrough, etc.)
 * - Inline HTML wrapper with basic email-safe styling
 */

import { marked } from 'marked';

/**
 * Convert a Markdown string to HTML suitable for email.
 *
 * Returns a complete HTML fragment with minimal inline styling
 * for consistent rendering across email clients.
 *
 * @example
 * ```ts
 * import { markdownToHtml } from 'go-easy/gmail';
 *
 * const html = markdownToHtml('# Hello\n\nThis is **bold** and _italic_.');
 * ```
 */
export function markdownToHtml(md: string): string {
  const body = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;

  return [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #222;">',
    body,
    '</div>',
  ].join('\n');
}
