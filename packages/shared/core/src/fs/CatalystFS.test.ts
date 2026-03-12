/**
 * CatalystFS Node tests — pure logic via ZenFS InMemory backend
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CatalystFS } from './CatalystFS.js';

describe('CatalystFS', () => {
  let fs: CatalystFS;

  beforeEach(async () => {
    fs = await CatalystFS.create('test-' + Math.random().toString(36).slice(2));
  });

  describe('write/read round-trip', () => {
    it('should write and read a string file', () => {
      fs.writeFileSync('/hello.txt', 'hello world');
      const content = fs.readFileSync('/hello.txt', 'utf-8');
      expect(content).toBe('hello world');
    });

    it('should write and read binary data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      fs.writeFileSync('/binary.bin', data);
      const result = fs.readFileSync('/binary.bin');
      expect(new Uint8Array(result as Uint8Array)).toEqual(data);
    });

    it('should async write and read', async () => {
      await fs.writeFile('/async.txt', 'async content');
      const content = await fs.readFile('/async.txt', 'utf-8');
      expect(content).toBe('async content');
    });
  });

  describe('mkdir and readdir', () => {
    it('should create directories recursively', () => {
      fs.mkdirSync('/a/b/c', { recursive: true });
      expect(fs.existsSync('/a/b/c')).toBe(true);
    });

    it('should list directory entries', () => {
      fs.mkdirSync('/dir');
      fs.writeFileSync('/dir/file1.txt', 'one');
      fs.writeFileSync('/dir/file2.txt', 'two');
      const entries = fs.readdirSync('/dir');
      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
    });

    it('should readdir with withFileTypes', () => {
      fs.mkdirSync('/typed');
      fs.writeFileSync('/typed/file.txt', 'data');
      fs.mkdirSync('/typed/subdir');
      const entries = fs.readdirSync('/typed', { withFileTypes: true }) as any[];
      const fileEntry = entries.find((e) => e.name === 'file.txt');
      const dirEntry = entries.find((e) => e.name === 'subdir');
      expect(fileEntry?.isFile()).toBe(true);
      expect(dirEntry?.isDirectory()).toBe(true);
    });

    it('should async mkdir and readdir', async () => {
      await fs.mkdir('/asyncdir/sub', { recursive: true });
      await fs.writeFile('/asyncdir/sub/test.txt', 'data');
      const entries = await fs.readdir('/asyncdir/sub');
      expect(entries).toContain('test.txt');
    });
  });

  describe('stat', () => {
    it('should return file stat with correct type info', () => {
      fs.writeFileSync('/statfile.txt', 'data');
      const stat = fs.statSync('/statfile.txt');
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(4);
    });

    it('should return directory stat', () => {
      fs.mkdirSync('/statdir');
      const stat = fs.statSync('/statdir');
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isFile()).toBe(false);
    });

    it('should async stat', async () => {
      await fs.writeFile('/asyncstat.txt', 'hello');
      const stat = await fs.stat('/asyncstat.txt');
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBe(5);
    });
  });

  describe('rename', () => {
    it('should rename a file', () => {
      fs.writeFileSync('/before.txt', 'content');
      fs.renameSync('/before.txt', '/after.txt');
      expect(fs.existsSync('/before.txt')).toBe(false);
      expect(fs.readFileSync('/after.txt', 'utf-8')).toBe('content');
    });

    it('should async rename', async () => {
      await fs.writeFile('/arename.txt', 'data');
      await fs.rename('/arename.txt', '/arenamed.txt');
      const content = await fs.readFile('/arenamed.txt', 'utf-8');
      expect(content).toBe('data');
    });
  });

  describe('unlink', () => {
    it('should delete a file', () => {
      fs.writeFileSync('/todelete.txt', 'data');
      expect(fs.existsSync('/todelete.txt')).toBe(true);
      fs.unlinkSync('/todelete.txt');
      expect(fs.existsSync('/todelete.txt')).toBe(false);
    });

    it('should async unlink', async () => {
      await fs.writeFile('/adelete.txt', 'data');
      await fs.unlink('/adelete.txt');
      expect(fs.existsSync('/adelete.txt')).toBe(false);
    });
  });

  describe('existsSync', () => {
    it('should return true for existing file', () => {
      fs.writeFileSync('/exists.txt', 'data');
      expect(fs.existsSync('/exists.txt')).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(fs.existsSync('/nope.txt')).toBe(false);
    });

    it('should return true for existing directory', () => {
      fs.mkdirSync('/existsdir');
      expect(fs.existsSync('/existsdir')).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('should copy a file', () => {
      fs.writeFileSync('/source.txt', 'copy me');
      fs.copyFileSync('/source.txt', '/dest.txt');
      expect(fs.readFileSync('/dest.txt', 'utf-8')).toBe('copy me');
      // Source still exists
      expect(fs.existsSync('/source.txt')).toBe(true);
    });

    it('should async copyFile', async () => {
      await fs.writeFile('/asrc.txt', 'async copy');
      await fs.copyFile('/asrc.txt', '/adst.txt');
      const content = await fs.readFile('/adst.txt', 'utf-8');
      expect(content).toBe('async copy');
    });
  });

  describe('error handling', () => {
    it('should throw on reading non-existent file', () => {
      expect(() => fs.readFileSync('/nonexistent.txt')).toThrow();
    });

    it('should throw on stat non-existent path', () => {
      expect(() => fs.statSync('/nosuchfile')).toThrow();
    });
  });

  describe('rawFs getter', () => {
    it('should return a usable fs object', () => {
      const raw = fs.rawFs;
      expect(raw).toBeDefined();
      expect(typeof raw.readFileSync).toBe('function');
      expect(typeof raw.writeFileSync).toBe('function');

      // Write with raw, read with CatalystFS
      raw.writeFileSync('/rawtest.txt', 'raw data');
      expect(fs.readFileSync('/rawtest.txt', 'utf-8')).toBe('raw data');
    });
  });

  describe('appendFile', () => {
    it('should append data to a file', () => {
      fs.writeFileSync('/append.txt', 'hello');
      fs.appendFileSync('/append.txt', ' world');
      expect(fs.readFileSync('/append.txt', 'utf-8')).toBe('hello world');
    });
  });
});
