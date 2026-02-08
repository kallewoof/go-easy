import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../src/gmail/markdown.js';

describe('markdownToHtml', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello\n\nThis is **bold**.');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('wraps output in styled div', () => {
    const html = markdownToHtml('text');
    expect(html).toContain('<div style="')
    expect(html).toContain('font-family');
    expect(html).toMatch(/<\/div>$/);
  });

  it('supports GFM tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = markdownToHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('supports GFM strikethrough', () => {
    const html = markdownToHtml('~~deleted~~');
    expect(html).toContain('<del>deleted</del>');
  });

  it('converts line breaks (breaks: true)', () => {
    const html = markdownToHtml('line1\nline2');
    expect(html).toContain('<br');
  });

  it('supports links', () => {
    const html = markdownToHtml('[click](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>click</a>');
  });

  it('supports lists', () => {
    const html = markdownToHtml('- item 1\n- item 2');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item 1</li>');
  });

  it('supports code blocks', () => {
    const html = markdownToHtml('```\nconst x = 1;\n```');
    expect(html).toContain('<code>');
    expect(html).toContain('const x = 1;');
  });

  it('supports inline code', () => {
    const html = markdownToHtml('use `npm install`');
    expect(html).toContain('<code>npm install</code>');
  });

  it('handles empty string', () => {
    const html = markdownToHtml('');
    expect(html).toContain('<div');
  });
});
