import { describe, it, expect } from 'vitest';
import type { gmail_v1 } from '@googleapis/gmail';
import {
  getHeader,
  parseAddressList,
  extractAttachments,
  extractBody,
  base64Decode,
  base64UrlEncode,
  rfc2047Encode,
  rfc2047EncodeAddress,
  rfc2047EncodeAddressList,
  parseMessage,
  buildMimeMessage,
  buildForwardMime,
} from '../../src/gmail/helpers.js';

// ─── Fixtures ──────────────────────────────────────────────

const headers: gmail_v1.Schema$MessagePartHeader[] = [
  { name: 'From', value: 'alice@example.com' },
  { name: 'To', value: 'bob@example.com, carol@example.com' },
  { name: 'Subject', value: 'Hello World' },
  { name: 'Date', value: 'Mon, 3 Feb 2026 10:00:00 +0100' },
  { name: 'Cc', value: '' },
];

/** A realistic multi-part payload with text, html, and attachment */
function makePayload(): gmail_v1.Schema$MessagePart {
  const textBody = Buffer.from('Hello plain text').toString('base64url');
  const htmlBody = Buffer.from('<p>Hello HTML</p>').toString('base64url');

  return {
    mimeType: 'multipart/mixed',
    headers,
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: textBody },
          },
          {
            mimeType: 'text/html',
            body: { data: htmlBody },
          },
        ],
      },
      {
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        body: {
          attachmentId: 'att-001',
          size: 12345,
        },
      },
    ],
  };
}

function makeRawMessage(): gmail_v1.Schema$Message {
  return {
    id: 'msg-123',
    threadId: 'thread-456',
    snippet: 'Hello plain...',
    labelIds: ['INBOX', 'UNREAD'],
    payload: makePayload(),
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('getHeader', () => {
  it('finds header by name (exact case)', () => {
    expect(getHeader(headers, 'From')).toBe('alice@example.com');
  });

  it('finds header case-insensitively', () => {
    expect(getHeader(headers, 'from')).toBe('alice@example.com');
    expect(getHeader(headers, 'SUBJECT')).toBe('Hello World');
  });

  it('returns empty string for missing header', () => {
    expect(getHeader(headers, 'X-Custom')).toBe('');
  });

  it('returns empty string for undefined headers', () => {
    expect(getHeader(undefined, 'From')).toBe('');
  });
});

describe('parseAddressList', () => {
  it('splits comma-separated addresses', () => {
    expect(parseAddressList('a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com']);
  });

  it('trims whitespace', () => {
    expect(parseAddressList('  a@b.com ,  c@d.com  ')).toEqual(['a@b.com', 'c@d.com']);
  });

  it('returns empty array for empty string', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('handles single address', () => {
    expect(parseAddressList('only@one.com')).toEqual(['only@one.com']);
  });

  it('filters out empty entries', () => {
    expect(parseAddressList('a@b.com,,c@d.com,')).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('extractAttachments', () => {
  it('finds attachments in nested MIME parts', () => {
    const atts = extractAttachments(makePayload());
    expect(atts).toHaveLength(1);
    expect(atts[0]).toEqual({
      id: 'att-001',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 12345,
    });
  });

  it('returns empty for payload without attachments', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/plain',
      body: { data: 'aGVsbG8' },
    };
    expect(extractAttachments(payload)).toEqual([]);
  });

  it('returns empty for undefined payload', () => {
    expect(extractAttachments(undefined)).toEqual([]);
  });

  it('skips parts with filename but no attachmentId', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'application/pdf',
      filename: 'test.pdf',
      body: { size: 100 }, // no attachmentId
    };
    expect(extractAttachments(payload)).toEqual([]);
  });

  it('handles multiple attachments', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/pdf',
          filename: 'a.pdf',
          body: { attachmentId: 'att-1', size: 100 },
        },
        {
          mimeType: 'image/png',
          filename: 'b.png',
          body: { attachmentId: 'att-2', size: 200 },
        },
      ],
    };
    const atts = extractAttachments(payload);
    expect(atts).toHaveLength(2);
    expect(atts[0].filename).toBe('a.pdf');
    expect(atts[1].filename).toBe('b.png');
  });
});

describe('extractBody', () => {
  it('extracts text and html from multipart message', () => {
    const body = extractBody(makePayload());
    expect(body.text).toBe('Hello plain text');
    expect(body.html).toBe('<p>Hello HTML</p>');
  });

  it('returns empty for undefined payload', () => {
    expect(extractBody(undefined)).toEqual({});
  });

  it('extracts text-only from simple message', () => {
    const textData = Buffer.from('Just text').toString('base64url');
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/plain',
      body: { data: textData },
    };
    const body = extractBody(payload);
    expect(body.text).toBe('Just text');
    expect(body.html).toBeUndefined();
  });

  it('takes first text/plain and first text/html only', () => {
    const text1 = Buffer.from('First').toString('base64url');
    const text2 = Buffer.from('Second').toString('base64url');
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: text1 } },
        { mimeType: 'text/plain', body: { data: text2 } },
      ],
    };
    expect(extractBody(payload).text).toBe('First');
  });
});

describe('base64Decode / base64UrlEncode', () => {
  it('round-trips a string', () => {
    const original = 'Hello, World! 🌍';
    const encoded = base64UrlEncode(original);
    const decoded = base64Decode(encoded);
    expect(decoded).toBe(original);
  });

  it('decodes base64url-encoded data', () => {
    const data = Buffer.from('test data').toString('base64url');
    expect(base64Decode(data)).toBe('test data');
  });

  it('encodes Buffer to base64url', () => {
    const buf = Buffer.from('binary content');
    const encoded = base64UrlEncode(buf);
    expect(Buffer.from(encoded, 'base64url').toString()).toBe('binary content');
  });
});

describe('parseMessage', () => {
  it('parses a full Gmail API message into GmailMessage', () => {
    const msg = parseMessage(makeRawMessage());

    expect(msg.id).toBe('msg-123');
    expect(msg.threadId).toBe('thread-456');
    expect(msg.from).toBe('alice@example.com');
    expect(msg.to).toEqual(['bob@example.com', 'carol@example.com']);
    expect(msg.cc).toEqual([]);
    expect(msg.bcc).toEqual([]);
    expect(msg.subject).toBe('Hello World');
    expect(msg.snippet).toBe('Hello plain...');
    expect(msg.body.text).toBe('Hello plain text');
    expect(msg.body.html).toBe('<p>Hello HTML</p>');
    expect(msg.labelIds).toEqual(['INBOX', 'UNREAD']);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe('invoice.pdf');
  });

  it('extracts rfc822MessageId when Message-ID header is present', () => {
    const msg = parseMessage({
      id: 'msg-999',
      threadId: 'thread-999',
      payload: {
        headers: [
          { name: 'From', value: 'sender@example.com' },
          { name: 'Message-ID', value: '<CAxxxxxx@mail.gmail.com>' },
        ],
      },
    });
    expect(msg.rfc822MessageId).toBe('<CAxxxxxx@mail.gmail.com>');
  });

  it('omits rfc822MessageId when Message-ID header is absent', () => {
    const msg = parseMessage({
      id: 'msg-999',
      threadId: 'thread-999',
      payload: {
        headers: [
          { name: 'From', value: 'sender@example.com' },
        ],
      },
    });
    expect(msg.rfc822MessageId).toBeUndefined();
  });

  it('handles message with missing fields', () => {
    const msg = parseMessage({});
    expect(msg.id).toBe('');
    expect(msg.threadId).toBe('');
    expect(msg.from).toBe('');
    expect(msg.to).toEqual([]);
    expect(msg.subject).toBe('');
    expect(msg.snippet).toBe('');
    expect(msg.body).toEqual({});
    expect(msg.labelIds).toEqual([]);
    expect(msg.attachments).toEqual([]);
  });
});

describe('rfc2047Encode', () => {
  it('returns ASCII strings unchanged', () => {
    expect(rfc2047Encode('Hello World')).toBe('Hello World');
    expect(rfc2047Encode('RE: Invoice #1234')).toBe('RE: Invoice #1234');
  });

  it('encodes non-ASCII characters using RFC 2047 Base64', () => {
    const encoded = rfc2047Encode('RE: Solicitud NIF-N para inversión en España');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    // Decode the base64 part to verify round-trip
    const base64Part = encoded.replace('=?UTF-8?B?', '').replace('?=', '');
    const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
    expect(decoded).toBe('RE: Solicitud NIF-N para inversión en España');
  });

  it('encodes Japanese characters', () => {
    const encoded = rfc2047Encode('テスト件名');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const base64Part = encoded.replace('=?UTF-8?B?', '').replace('?=', '');
    expect(Buffer.from(base64Part, 'base64').toString('utf-8')).toBe('テスト件名');
  });
});

describe('rfc2047EncodeAddress', () => {
  it('returns plain email addresses unchanged', () => {
    expect(rfc2047EncodeAddress('julia@example.com')).toBe('julia@example.com');
  });

  it('returns ASCII display names unchanged', () => {
    expect(rfc2047EncodeAddress('John Smith <john@example.com>')).toBe(
      'John Smith <john@example.com>'
    );
  });

  it('encodes non-ASCII display names', () => {
    const result = rfc2047EncodeAddress('Júlia Fargas Esteve <juliaf@blegal.eu>');
    expect(result).toMatch(/^=\?UTF-8\?B\?.+\?= <juliaf@blegal\.eu>$/);
    // Decode and verify the display name
    const base64Part = result.match(/=\?UTF-8\?B\?(.+)\?=/)![1];
    expect(Buffer.from(base64Part, 'base64').toString('utf-8')).toBe('Júlia Fargas Esteve');
  });

  it('handles quoted display names with non-ASCII', () => {
    const result = rfc2047EncodeAddress('"José García" <jose@example.com>');
    expect(result).toMatch(/^=\?UTF-8\?B\?.+\?= <jose@example\.com>$/);
    const base64Part = result.match(/=\?UTF-8\?B\?(.+)\?=/)![1];
    expect(Buffer.from(base64Part, 'base64').toString('utf-8')).toBe('José García');
  });

  it('handles trimming whitespace', () => {
    expect(rfc2047EncodeAddress('  alice@example.com  ')).toBe('alice@example.com');
  });
});

describe('rfc2047EncodeAddressList', () => {
  it('encodes a comma-separated list of addresses', () => {
    const result = rfc2047EncodeAddressList(
      'Júlia Fargas <juliaf@blegal.eu>, Marc Test <marc@blegal.eu>'
    );
    expect(result).toMatch(/=\?UTF-8\?B\?.+\?= <juliaf@blegal\.eu>/);
    expect(result).toContain('Marc Test <marc@blegal.eu>');
  });

  it('returns empty string unchanged', () => {
    expect(rfc2047EncodeAddressList('')).toBe('');
  });

  it('handles single address', () => {
    const result = rfc2047EncodeAddressList('Júlia <j@test.com>');
    expect(result).toMatch(/^=\?UTF-8\?B\?.+\?= <j@test\.com>$/);
  });
});

describe('buildMimeMessage', () => {
  it('builds a plain text message', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'you@test.com',
      subject: 'Test',
      body: 'Hello',
    });

    expect(mime).toContain('From: me@test.com');
    expect(mime).toContain('To: you@test.com');
    expect(mime).toContain('Subject: Test');
    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).toContain('Hello');
  });

  it('builds a multipart/alternative message with HTML', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'you@test.com',
      subject: 'Test',
      body: 'Plain text',
      html: '<p>HTML</p>',
    });

    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('text/plain');
    expect(mime).toContain('text/html');
    expect(mime).toContain('Plain text');
    expect(mime).toContain('<p>HTML</p>');
  });

  it('includes CC and BCC headers', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'a@test.com',
      cc: 'b@test.com',
      bcc: 'c@test.com',
      subject: 'Test',
      body: 'Hi',
    });

    expect(mime).toContain('Cc: b@test.com');
    expect(mime).toContain('Bcc: c@test.com');
  });

  it('handles array recipients', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: ['a@test.com', 'b@test.com'],
      cc: ['c@test.com', 'd@test.com'],
      subject: 'Multi',
      body: 'Hi',
    });

    expect(mime).toContain('To: a@test.com, b@test.com');
    expect(mime).toContain('Cc: c@test.com, d@test.com');
  });

  it('includes extra headers', async () => {
    const mime = await buildMimeMessage(
      'me@test.com',
      { to: 'you@test.com', subject: 'Re: Thread', body: 'Reply' },
      { 'In-Reply-To': '<msg-id@example.com>', References: '<msg-id@example.com>' }
    );

    expect(mime).toContain('In-Reply-To: <msg-id@example.com>');
    expect(mime).toContain('References: <msg-id@example.com>');
  });

  it('includes MIME-Version header', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'you@test.com',
      subject: 'Test',
      body: 'Hi',
    });

    expect(mime).toContain('MIME-Version: 1.0');
  });

  it('RFC 2047 encodes non-ASCII subject', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'you@test.com',
      subject: 'RE: Solicitud NIF-N para inversión en España',
      body: 'Hola',
    });

    // Should NOT contain raw UTF-8 in Subject header
    expect(mime).not.toContain('Subject: RE: Solicitud NIF-N para inversión');
    // Should contain RFC 2047 encoded subject
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
    // Body can contain raw UTF-8 (it's in a charset=utf-8 content part)
    expect(mime).toContain('Hola');
  });

  it('leaves ASCII subject unencoded', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'you@test.com',
      subject: 'RE: Invoice #1234',
      body: 'Thanks',
    });

    expect(mime).toContain('Subject: RE: Invoice #1234');
  });

  it('RFC 2047 encodes non-ASCII display names in To header', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'Júlia Fargas Esteve <juliaf@blegal.eu>',
      subject: 'Test',
      body: 'Hello',
    });

    // Should NOT contain raw non-ASCII in the To header
    expect(mime).not.toContain('To: Júlia');
    // Should contain RFC 2047 encoded display name
    expect(mime).toMatch(/To: =\?UTF-8\?B\?.+\?= <juliaf@blegal\.eu>/);
  });

  it('RFC 2047 encodes non-ASCII display names in Cc header', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'a@test.com',
      cc: 'José García <jose@test.com>',
      subject: 'Test',
      body: 'Hello',
    });

    expect(mime).not.toContain('Cc: José');
    expect(mime).toMatch(/Cc: =\?UTF-8\?B\?.+\?= <jose@test\.com>/);
  });

  it('leaves ASCII display names in To header unencoded', async () => {
    const mime = await buildMimeMessage('me@test.com', {
      to: 'John Smith <john@test.com>',
      subject: 'Test',
      body: 'Hello',
    });

    expect(mime).toContain('To: John Smith <john@test.com>');
  });
});

describe('buildForwardMime', () => {
  it('builds plain text forward without attachments', async () => {
    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: Original',
      'Check this out',
      { text: 'Original body text' },
      []
    );

    expect(mime).toContain('From: me@test.com');
    expect(mime).toContain('To: you@test.com');
    expect(mime).toContain('Subject: Fwd: Original');
    expect(mime).toContain('Content-Type: text/plain');
    expect(mime).toContain('Check this out');
    expect(mime).toContain('---------- Forwarded message ----------');
    expect(mime).toContain('Original body text');
  });

  it('builds multipart/alternative when original has HTML', async () => {
    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: HTML',
      undefined,
      { text: 'plain', html: '<p>html</p>' },
      []
    );

    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('text/plain');
    expect(mime).toContain('text/html');
    expect(mime).toContain('<p>html</p>');
  });

  it('includes buffer attachments in multipart/mixed', async () => {
    const attachment = {
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('fake pdf content'),
    };

    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: With Attachment',
      'FYI',
      { text: 'See attached' },
      [attachment]
    );

    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(mime).toContain('Content-Type: application/pdf; name="report.pdf"');
    expect(mime).toContain(Buffer.from('fake pdf content').toString('base64'));
  });

  it('includes multiple buffer attachments', async () => {
    const attachments = [
      { filename: 'a.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') },
      { filename: 'b.png', mimeType: 'image/png', data: Buffer.from('png') },
    ];

    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: Multi',
      undefined,
      { text: 'body' },
      attachments
    );

    expect(mime).toContain('filename="a.pdf"');
    expect(mime).toContain('filename="b.png"');
  });

  it('RFC 2047 encodes non-ASCII subject in forward', async () => {
    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: Factura nº 42 — información',
      'FYI',
      { text: 'Original' },
      []
    );

    expect(mime).not.toContain('Subject: Fwd: Factura nº');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
  });

  it('leaves ASCII subject unencoded in forward', async () => {
    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: Invoice #42',
      'FYI',
      { text: 'Original' },
      []
    );

    expect(mime).toContain('Subject: Fwd: Invoice #42');
  });

  it('builds forward without user body', async () => {
    const mime = await buildForwardMime(
      'me@test.com',
      'you@test.com',
      'Fwd: No Body',
      undefined,
      { text: 'original text' },
      []
    );

    expect(mime).toContain('---------- Forwarded message ----------');
    expect(mime).toContain('original text');
    // Should NOT have user body text before the forward marker
    const lines = mime.split('\r\n');
    const fwdIndex = lines.findIndex((l) => l.includes('Forwarded message'));
    // The line before the forward marker should be empty (the header/body separator area)
    expect(fwdIndex).toBeGreaterThan(0);
  });
});
