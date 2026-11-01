import { describe, expect, it } from 'vitest';
import { folderOf, updateLines } from './update';

describe('the folder of the page', () => {
  it('is the Windows folder of a file address, escapes read', () => {
    expect(folderOf('file:///E:/repos/tasks-web/tasks.html')).toBe('E:\\repos\\tasks-web');
    expect(folderOf('file:///C:/My%20Repos/tasks%23web/tasks.html#task=a/b')).toBe('C:\\My Repos\\tasks#web');
  });

  it('keeps the host of a network path', () => {
    expect(folderOf('file://server/share/tasks-web/tasks.html')).toBe('\\\\server\\share\\tasks-web');
  });

  it('keeps a path without a drive as it is', () => {
    expect(folderOf('file:///home/me/tasks-web/tasks.html')).toBe('/home/me/tasks-web');
  });

  it('is null for a served page, a broken escape or no address', () => {
    expect(folderOf('http://127.0.0.1:7342/')).toBeNull();
    expect(folderOf('file:///E:/repos/%E0%A4%A/tasks.html')).toBeNull();
    expect(folderOf('not an address')).toBeNull();
    expect(folderOf('file:///tasks.html')).toBeNull();
  });
});

describe('the lines that update it', () => {
  it('quote the folder for the script and for git', () => {
    expect(updateLines('C:\\My Repos\\tasks-web')).toEqual({
      script: '"C:\\My Repos\\tasks-web\\start-tasks.cmd" /update',
      git: 'git -C "C:\\My Repos\\tasks-web" pull --ff-only',
    });
    expect(updateLines('/home/me/tasks-web').script).toBe('"/home/me/tasks-web/start-tasks.cmd" /update');
  });
});
