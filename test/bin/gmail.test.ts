import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRawOutput, positional, main } from '../../src/bin/gmail.js';
import * as gmailModule from '../../src/gmail/index.js';
import { setSafetyContext } from '../../src/safety.js';

vi.mock('node:fs', () => ({ writeFileSync: vi.fn(), realpathSync: (p: string) => p }));
vi.mock('../../src/auth.js', () => ({
  getAuth: vi.fn().mockResolvedValue('fake-auth'),
}));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/gmail/index.js', () => ({
  getProfile: vi.fn().mockResolvedValue('user@example.com'),
  search: vi.fn().mockResolvedValue({ items: [] }),
  getMessage: vi.fn().mockResolvedValue({
    id: 'msg1', threadId: 'th1', rfc822MessageId: '<msg1@mail>',
    body: { text: 'hello', html: '<p>hello</p>' },
  }),
  getMessageRaw: vi.fn().mockResolvedValue(Buffer.from('raw email bytes')),
  getThread: vi.fn().mockResolvedValue({ id: 'th1', messages: [] }),
  getThreadMbox: vi.fn().mockResolvedValue(Buffer.from('mbox content')),
  listLabels: vi.fn().mockResolvedValue([{ id: 'INBOX', name: 'INBOX' }]),
  send: vi.fn().mockResolvedValue({ ok: true, id: 'msg1' }),
  reply: vi.fn().mockResolvedValue({ ok: true, id: 'msg2' }),
  forward: vi.fn().mockResolvedValue({ ok: true, id: 'draft1' }),
  createDraft: vi.fn().mockResolvedValue({ ok: true, id: 'draft1' }),
  sendDraft: vi.fn().mockResolvedValue({ ok: true, id: 'msg3' }),
  listDrafts: vi.fn().mockResolvedValue({ items: [] }),
  batchModifyLabels: vi.fn().mockResolvedValue({ ok: true }),
  getAttachmentContent: vi.fn().mockResolvedValue(Buffer.from('attach')),
  sanitizeEmailHtml: vi.fn((html: string) => `sanitized:${html}`),
}));
vi.mock('../../src/bin/gmail-flags.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/bin/gmail-flags.js')>();
  return { parseFlags: orig.parseFlags, readBodyFlags: vi.fn().mockReturnValue({}) };
});

const ACC = 'user@example.com';

// ─── Utilities ─────────────────────────────────────────────

describe('positional', () => {
  it('filters out flag arguments', () => {
    expect(positional(['msg-id', '--format=eml', '--b64encode'])).toEqual(['msg-id']);
  });

  it('returns all args when none are flags', () => {
    expect(positional(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('handleRawOutput', () => {
  const buf = Buffer.from('raw content');

  it('writes to file and returns result object when --output is set', async () => {
    const { writeFileSync } = await import('node:fs');
    const result = handleRawOutput(buf, 'eml', { output: '/tmp/out.eml' });
    expect(result).toMatchObject({ ok: true, format: 'eml', path: '/tmp/out.eml', bytes: buf.length });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith('/tmp/out.eml', buf);
  });

  it('returns base64 result when --b64encode is set', () => {
    const result = handleRawOutput(buf, 'eml', { b64encode: 'true' });
    expect(result).toMatchObject({ format: 'eml', data: buf.toString('base64'), bytes: buf.length });
  });

  it('writes raw bytes to stdout and returns undefined when neither flag is set', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = handleRawOutput(buf, 'eml', {});
    expect(result).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledWith(buf);
    writeSpy.mockRestore();
  });
});

// ─── main() commands ───────────────────────────────────────

describe('main()', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => { logSpy?.mockRestore(); errSpy?.mockRestore(); exitSpy?.mockRestore(); stdoutSpy?.mockRestore(); });

  it('profile — calls getProfile and outputs JSON', async () => {
    await main([ACC, 'profile']);
    expect(vi.mocked(gmailModule.getProfile)).toHaveBeenCalledWith('fake-auth');
    expect(JSON.parse(logSpy.mock.calls[0][0])).toHaveProperty('email');
  });

  it('search — passes query and max to search()', async () => {
    await main([ACC, 'search', 'is:unread', '--max=5']);
    expect(vi.mocked(gmailModule.search)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ query: 'is:unread', maxResults: 5 }),
    );
  });

  it('get — fetches message and outputs JSON', async () => {
    await main([ACC, 'get', 'msg1']);
    expect(vi.mocked(gmailModule.getMessage)).toHaveBeenCalledWith('fake-auth', 'msg1');
    expect(logSpy).toHaveBeenCalled();
  });

  it('get --format=eml — calls getMessageRaw and streams to stdout', async () => {
    await main([ACC, 'get', 'msg1', '--format=eml']);
    expect(vi.mocked(gmailModule.getMessageRaw)).toHaveBeenCalledWith('fake-auth', 'msg1');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('get --format=eml --b64encode — outputs base64 JSON', async () => {
    await main([ACC, 'get', 'msg1', '--format=eml', '--b64encode']);
    expect(vi.mocked(gmailModule.getMessageRaw)).toHaveBeenCalled();
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out).toHaveProperty('data');
  });

  it('get --format=text — streams text body to stdout', async () => {
    await main([ACC, 'get', 'msg1', '--format=text']);
    expect(vi.mocked(gmailModule.getMessage)).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('get --format=html — streams html body to stdout', async () => {
    await main([ACC, 'get', 'msg1', '--format=html']);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('get --format=sane-html — sanitizes before streaming', async () => {
    await main([ACC, 'get', 'msg1', '--format=sane-html']);
    expect(vi.mocked(gmailModule.sanitizeEmailHtml)).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('thread — fetches thread and outputs JSON', async () => {
    await main([ACC, 'thread', 'th1']);
    expect(vi.mocked(gmailModule.getThread)).toHaveBeenCalledWith('fake-auth', 'th1');
    expect(logSpy).toHaveBeenCalled();
  });

  it('thread --format=mbox — streams mbox to stdout', async () => {
    await main([ACC, 'thread', 'th1', '--format=mbox']);
    expect(vi.mocked(gmailModule.getProfile)).toHaveBeenCalled();
    expect(vi.mocked(gmailModule.getThreadMbox)).toHaveBeenCalledWith('fake-auth', 'th1', expect.any(String));
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('labels — lists and outputs JSON', async () => {
    await main([ACC, 'labels']);
    expect(vi.mocked(gmailModule.listLabels)).toHaveBeenCalledWith('fake-auth');
    expect(logSpy).toHaveBeenCalled();
  });

  it('send — calls gmail.send with parsed flags', async () => {
    await main([ACC, 'send', '--to=x@y.com', '--subject=Hi', '--confirm']);
    expect(vi.mocked(gmailModule.send)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ to: 'x@y.com', subject: 'Hi' }),
    );
  });

  it('reply — fetches original then calls gmail.reply', async () => {
    await main([ACC, 'reply', 'msg1', '--confirm']);
    expect(vi.mocked(gmailModule.getMessage)).toHaveBeenCalledWith('fake-auth', 'msg1');
    expect(vi.mocked(gmailModule.reply)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ messageId: 'msg1', threadId: 'th1' }),
    );
  });

  it('reply --reply-all — sets replyAll flag', async () => {
    await main([ACC, 'reply', 'msg1', '--reply-all', '--confirm']);
    expect(vi.mocked(gmailModule.reply)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ replyAll: true }),
    );
  });

  it('forward — calls gmail.forward with correct args', async () => {
    await main([ACC, 'forward', 'msg1', '--to=z@y.com', '--send-now', '--confirm']);
    expect(vi.mocked(gmailModule.forward)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ messageId: 'msg1', to: 'z@y.com', sendNow: true }),
    );
  });

  it('draft — creates draft with parsed flags', async () => {
    await main([ACC, 'draft', '--to=x@y.com', '--subject=Draft']);
    expect(vi.mocked(gmailModule.createDraft)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ to: 'x@y.com', subject: 'Draft' }),
    );
  });

  it('draft --in-reply-to — fetches original and threads the draft', async () => {
    await main([ACC, 'draft', '--to=x@y.com', '--subject=Re', '--in-reply-to=msg1']);
    expect(vi.mocked(gmailModule.getMessage)).toHaveBeenCalledWith('fake-auth', 'msg1');
    expect(vi.mocked(gmailModule.createDraft)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ threadId: 'th1' }),
    );
  });

  it('send-draft — calls gmail.sendDraft', async () => {
    await main([ACC, 'send-draft', 'draft1', '--confirm']);
    expect(vi.mocked(gmailModule.sendDraft)).toHaveBeenCalledWith('fake-auth', 'draft1');
  });

  it('drafts — lists drafts and outputs JSON', async () => {
    await main([ACC, 'drafts', '--max=10']);
    expect(vi.mocked(gmailModule.listDrafts)).toHaveBeenCalledWith('fake-auth', 10, undefined);
  });

  it('batch-label — calls batchModifyLabels with parsed ids', async () => {
    await main([ACC, 'batch-label', '--ids=msg1,msg2', '--add=INBOX', '--remove=UNREAD']);
    expect(vi.mocked(gmailModule.batchModifyLabels)).toHaveBeenCalledWith(
      'fake-auth',
      expect.objectContaining({ messageIds: ['msg1', 'msg2'] }),
    );
  });

  it('attachment — outputs base64 content', async () => {
    await main([ACC, 'attachment', 'msg1', 'att1']);
    expect(vi.mocked(gmailModule.getAttachmentContent)).toHaveBeenCalledWith('fake-auth', 'msg1', 'att1');
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('size');
  });

  it('unknown command — exits with usage', async () => {
    await expect(main([ACC, 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('safety context — blocks destructive op when --confirm is absent', async () => {
    await main([ACC, 'send', '--to=x@y.com', '--subject=Hi']);
    logSpy.mockClear();
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    await expect(
      ctx.confirm({ name: 'gmail.send', description: 'Send email', details: {} }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(JSON.parse(logSpy.mock.calls[0][0]).blocked).toBe(true);
  });

  it('safety context — allows op when --confirm is present', async () => {
    await main([ACC, 'send', '--to=x@y.com', '--subject=Hi', '--confirm']);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    const allowed = await ctx.confirm({ name: 'gmail.send', description: 'Send', details: {} });
    expect(allowed).toBe(true);
  });

  it('outputs error JSON and exits 1 when service throws', async () => {
    vi.mocked(gmailModule.search).mockRejectedValueOnce(
      Object.assign(new Error('quota'), { code: 'QUOTA_EXCEEDED' }),
    );
    await expect(main([ACC, 'search', 'q'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
