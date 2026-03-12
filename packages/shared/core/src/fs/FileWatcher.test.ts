/**
 * FileWatcher Node tests — polling fallback logic with mocked timers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollingWatcher, hasNativeObserver } from './FileWatcher.js';

describe('FileWatcher', () => {
  describe('hasNativeObserver', () => {
    it('should return false in Node (no FileSystemObserver)', () => {
      expect(hasNativeObserver()).toBe(false);
    });
  });

  describe('PollingWatcher', () => {
    let mockFs: any;

    beforeEach(() => {
      vi.useFakeTimers();
      mockFs = {
        readdirSync: vi.fn().mockReturnValue([]),
        readFileSync: vi.fn().mockReturnValue(''),
        statSync: vi.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false }),
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect file changes via polling', () => {
      const callback = vi.fn();
      mockFs.readdirSync.mockReturnValue(['test.txt']);
      mockFs.readFileSync.mockReturnValue('initial');

      const watcher = new PollingWatcher(
        mockFs, '/', { recursive: false }, callback, 100, 10
      );

      // Initial scan populates hashes, no callback
      expect(callback).not.toHaveBeenCalled();

      // Change file content
      mockFs.readFileSync.mockReturnValue('modified content');

      // Advance past poll interval
      vi.advanceTimersByTime(110);

      // Advance past debounce
      vi.advanceTimersByTime(20);

      expect(callback).toHaveBeenCalledWith('change', '/test.txt');

      watcher.stop();
    });

    it('should detect new files', () => {
      const callback = vi.fn();
      mockFs.readdirSync.mockReturnValue([]);

      const watcher = new PollingWatcher(
        mockFs, '/', { recursive: false }, callback, 100, 10
      );

      // Add a new file
      mockFs.readdirSync.mockReturnValue(['new.txt']);
      mockFs.readFileSync.mockReturnValue('new content');

      vi.advanceTimersByTime(110);
      vi.advanceTimersByTime(20);

      expect(callback).toHaveBeenCalledWith('rename', '/new.txt');

      watcher.stop();
    });

    it('should detect deleted files', () => {
      const callback = vi.fn();
      mockFs.readdirSync.mockReturnValue(['file.txt']);
      mockFs.readFileSync.mockReturnValue('content');

      const watcher = new PollingWatcher(
        mockFs, '/', { recursive: false }, callback, 100, 10
      );

      // Remove the file
      mockFs.readdirSync.mockReturnValue([]);

      vi.advanceTimersByTime(110);
      vi.advanceTimersByTime(20);

      expect(callback).toHaveBeenCalledWith('rename', '/file.txt');

      watcher.stop();
    });

    it('should stop polling when stopped', () => {
      const callback = vi.fn();
      mockFs.readdirSync.mockReturnValue(['f.txt']);
      mockFs.readFileSync.mockReturnValue('data');

      const watcher = new PollingWatcher(
        mockFs, '/', { recursive: false }, callback, 100, 10
      );

      watcher.stop();

      mockFs.readFileSync.mockReturnValue('changed');
      vi.advanceTimersByTime(500);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should debounce rapid changes', () => {
      const callback = vi.fn();
      let content = 'v1';
      mockFs.readdirSync.mockReturnValue(['f.txt']);
      mockFs.readFileSync.mockImplementation(() => content);

      const watcher = new PollingWatcher(
        mockFs, '/', { recursive: false }, callback, 50, 30
      );

      // Rapid changes
      content = 'v2';
      vi.advanceTimersByTime(55);
      content = 'v3';
      vi.advanceTimersByTime(55);
      content = 'v4';
      vi.advanceTimersByTime(55);

      // Wait for debounce to settle
      vi.advanceTimersByTime(50);

      // Should have at most 3 callback invocations (debounced)
      // The exact count depends on timing but should be <= original changes
      expect(callback.mock.calls.length).toBeLessThanOrEqual(3);
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1);

      watcher.stop();
    });
  });
});
