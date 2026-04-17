import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlags, positional, main } from '../../src/bin/drive.js';
import * as driveModule from '../../src/drive/index.js';
import { setSafetyContext } from '../../src/safety.js';

vi.mock('node:fs/promises', () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/auth.js', () => ({ getAuth: vi.fn().mockResolvedValue('fake-auth') }));
vi.mock('../../src/safety.js', () => ({ setSafetyContext: vi.fn() }));
vi.mock('../../src/drive/index.js', () => ({
  listFiles: vi.fn().mockResolvedValue({ items: [] }),
  searchFiles: vi.fn().mockResolvedValue({ items: [] }),
  getFile: vi.fn().mockResolvedValue({ id: 'file1', name: 'doc.pdf' }),
  downloadFile: vi.fn().mockResolvedValue({ name: 'doc.pdf', data: Buffer.from('pdf'), mimeType: 'application/pdf' }),
  exportFile: vi.fn().mockResolvedValue({ name: 'doc.docx', data: Buffer.from('docx'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  uploadFile: vi.fn().mockResolvedValue({ ok: true, id: 'file1' }),
  createFolder: vi.fn().mockResolvedValue({ ok: true, id: 'folder1' }),
  moveFile: vi.fn().mockResolvedValue({ ok: true }),
  renameFile: vi.fn().mockResolvedValue({ ok: true }),
  copyFile: vi.fn().mockResolvedValue({ ok: true, id: 'file2' }),
  trashFile: vi.fn().mockResolvedValue({ ok: true }),
  listPermissions: vi.fn().mockResolvedValue([]),
  shareFile: vi.fn().mockResolvedValue({ ok: true }),
  unshareFile: vi.fn().mockResolvedValue({ ok: true }),
}));

const ACC = 'user@example.com';

// ─── Utilities ─────────────────────────────────────────────

describe('parseFlags', () => {
  it('parses --key=value pairs', () => {
    expect(parseFlags(['--folder=abc123', '--name=file.pdf'])).toEqual({ folder: 'abc123', name: 'file.pdf' });
  });

  it('sets bare flags to "true"', () => {
    expect(parseFlags(['--confirm'])).toEqual({ confirm: 'true' });
  });
});

describe('positional', () => {
  it('returns non-flag args only', () => {
    expect(positional(['file-id', 'dest/path', '--confirm'])).toEqual(['file-id', 'dest/path']);
  });

  it('returns empty array when all args are flags', () => {
    expect(positional(['--confirm', '--max=10'])).toEqual([]);
  });
});

// ─── main() commands ───────────────────────────────────────

describe('main()', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });
  afterEach(() => { logSpy?.mockRestore(); errSpy?.mockRestore(); exitSpy?.mockRestore(); });

  it('ls — lists files', async () => {
    await main([ACC, 'ls', '--max=5']);
    expect(vi.mocked(driveModule.listFiles)).toHaveBeenCalledWith(
      'fake-auth', expect.objectContaining({ maxResults: 5 }),
    );
  });

  it('ls with folder — passes folderId', async () => {
    await main([ACC, 'ls', 'folder1']);
    expect(vi.mocked(driveModule.listFiles)).toHaveBeenCalledWith(
      'fake-auth', expect.objectContaining({ folderId: 'folder1' }),
    );
  });

  it('search — passes query to searchFiles', async () => {
    await main([ACC, 'search', 'quarterly report']);
    expect(vi.mocked(driveModule.searchFiles)).toHaveBeenCalledWith(
      'fake-auth', expect.objectContaining({ query: 'quarterly report' }),
    );
  });

  it('get — fetches file metadata', async () => {
    await main([ACC, 'get', 'file1']);
    expect(vi.mocked(driveModule.getFile)).toHaveBeenCalledWith('fake-auth', 'file1');
  });

  it('download — writes file to disk', async () => {
    const { writeFile } = await import('node:fs/promises');
    await main([ACC, 'download', 'file1']);
    expect(vi.mocked(driveModule.downloadFile)).toHaveBeenCalledWith('fake-auth', 'file1');
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out.ok).toBe(true);
  });

  it('download with dest path — uses provided path', async () => {
    const { writeFile } = await import('node:fs/promises');
    await main([ACC, 'download', 'file1', '/tmp/out.pdf']);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith('/tmp/out.pdf', expect.any(Buffer));
  });

  it('export — exports file and writes to disk', async () => {
    const { writeFile } = await import('node:fs/promises');
    await main([ACC, 'export', 'file1', 'docx']);
    expect(vi.mocked(driveModule.exportFile)).toHaveBeenCalledWith('fake-auth', 'file1', 'docx');
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
  });

  it('upload — uploads file', async () => {
    await main([ACC, 'upload', './file.pdf', '--folder=folder1']);
    expect(vi.mocked(driveModule.uploadFile)).toHaveBeenCalledWith(
      'fake-auth', './file.pdf', expect.objectContaining({ folderId: 'folder1' }),
    );
  });

  it('mkdir — creates folder', async () => {
    await main([ACC, 'mkdir', 'My Folder', '--parent=root']);
    expect(vi.mocked(driveModule.createFolder)).toHaveBeenCalledWith('fake-auth', 'My Folder', 'root');
  });

  it('move — moves file to new parent', async () => {
    await main([ACC, 'move', 'file1', 'folder2']);
    expect(vi.mocked(driveModule.moveFile)).toHaveBeenCalledWith('fake-auth', 'file1', 'folder2');
  });

  it('rename — renames file', async () => {
    await main([ACC, 'rename', 'file1', 'new-name.pdf']);
    expect(vi.mocked(driveModule.renameFile)).toHaveBeenCalledWith('fake-auth', 'file1', 'new-name.pdf');
  });

  it('copy — copies file', async () => {
    await main([ACC, 'copy', 'file1', '--name=copy.pdf', '--parent=folder2']);
    expect(vi.mocked(driveModule.copyFile)).toHaveBeenCalledWith('fake-auth', 'file1', 'copy.pdf', 'folder2');
  });

  it('trash --confirm — trashes file', async () => {
    await main([ACC, 'trash', 'file1', '--confirm']);
    expect(vi.mocked(driveModule.trashFile)).toHaveBeenCalledWith('fake-auth', 'file1');
  });

  it('permissions — lists permissions', async () => {
    await main([ACC, 'permissions', 'file1']);
    expect(vi.mocked(driveModule.listPermissions)).toHaveBeenCalledWith('fake-auth', 'file1');
  });

  it('share --confirm — shares file with parsed options', async () => {
    await main([ACC, 'share', 'file1', '--type=user', '--role=reader', '--email=x@y.com', '--confirm']);
    expect(vi.mocked(driveModule.shareFile)).toHaveBeenCalledWith(
      'fake-auth', 'file1',
      expect.objectContaining({ type: 'user', role: 'reader', emailAddress: 'x@y.com' }),
    );
  });

  it('unshare --confirm — removes permission', async () => {
    await main([ACC, 'unshare', 'file1', 'perm1', '--confirm']);
    expect(vi.mocked(driveModule.unshareFile)).toHaveBeenCalledWith('fake-auth', 'file1', 'perm1');
  });

  it('unknown command — exits with usage', async () => {
    await expect(main([ACC, 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('safety context — blocks without --confirm', async () => {
    await main([ACC, 'trash', 'file1']);
    logSpy.mockClear();
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    await expect(
      ctx.confirm({ name: 'drive.trash', description: 'Trash file', details: {} }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(JSON.parse(logSpy.mock.calls[0][0]).blocked).toBe(true);
  });

  it('safety context — allows with --confirm', async () => {
    await main([ACC, 'trash', 'file1', '--confirm']);
    const ctx = vi.mocked(setSafetyContext).mock.calls[0][0];
    expect(await ctx.confirm({ name: 'op', description: 'op', details: {} })).toBe(true);
  });

  it('outputs error JSON and exits 1 when service throws', async () => {
    vi.mocked(driveModule.listFiles).mockRejectedValueOnce(
      Object.assign(new Error('fail'), { code: 'NOT_FOUND' }),
    );
    await expect(main([ACC, 'ls'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
