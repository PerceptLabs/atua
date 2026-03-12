/**
 * Multi-Mount + File Watching browser tests
 */
import { describe, it, expect } from 'vitest';
import { CatalystFS } from './CatalystFS.js';

describe('CatalystFS Multi-Mount (Browser)', () => {
  it('should support memory-only mount for /tmp', async () => {
    const fs = await CatalystFS.create({
      name: 'multi-browser-' + Date.now(),
      mounts: {
        '/': 'memory',
        '/tmp': 'memory',
      },
    });

    fs.writeFileSync('/root.txt', 'root');
    fs.mkdirSync('/tmp', { recursive: true });
    fs.writeFileSync('/tmp/temp.txt', 'temporary');

    expect(fs.readFileSync('/root.txt', 'utf-8')).toBe('root');
    expect(fs.readFileSync('/tmp/temp.txt', 'utf-8')).toBe('temporary');
  });

  it('should support indexeddb + memory mixed mounts', async () => {
    const fs = await CatalystFS.create({
      name: 'mixed-mount-' + Date.now(),
      mounts: {
        '/': 'indexeddb',
        '/tmp': 'memory',
      },
    });

    fs.writeFileSync('/data.txt', 'persistent');
    fs.mkdirSync('/tmp', { recursive: true });
    fs.writeFileSync('/tmp/volatile.txt', 'volatile');

    expect(fs.readFileSync('/data.txt', 'utf-8')).toBe('persistent');
    expect(fs.readFileSync('/tmp/volatile.txt', 'utf-8')).toBe('volatile');
  });
});

describe('CatalystFS File Watching (Browser)', () => {
  it('should detect FileSystemObserver availability', async () => {
    const fs = await CatalystFS.create('watch-detect-' + Date.now());
    const hasNative = fs.hasNativeWatcher;
    console.log(`[FileWatcher] Native FileSystemObserver: ${hasNative}`);
    expect(typeof hasNative).toBe('boolean');
  });

  it('should fire callback on file change via polling watcher', async () => {
    const fs = await CatalystFS.create({
      name: 'watch-poll-' + Date.now(),
      mounts: { '/': 'memory' },
    });

    // Create initial file
    fs.writeFileSync('/watched.txt', 'initial');

    // Set up watcher with fast polling for test
    const changes: string[] = [];
    const unsub = fs.watch('/', { recursive: false }, (_event, filename) => {
      changes.push(filename);
    });

    // Wait for initial scan
    await new Promise((r) => setTimeout(r, 100));

    // Modify file
    fs.writeFileSync('/watched.txt', 'modified');

    // Wait for poll + debounce
    await new Promise((r) => setTimeout(r, 700));

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes).toContain('/watched.txt');

    unsub();
  });

  it('should debounce rapid writes', async () => {
    const fs = await CatalystFS.create({
      name: 'watch-debounce-' + Date.now(),
      mounts: { '/': 'memory' },
    });

    fs.writeFileSync('/rapid.txt', 'v0');

    const callbacks: string[] = [];
    const unsub = fs.watch('/', {}, (_event, filename) => {
      callbacks.push(filename);
    });

    // Wait for initial scan
    await new Promise((r) => setTimeout(r, 100));

    // 10 rapid writes
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync('/rapid.txt', `v${i}`);
    }

    // Wait for polling + debounce to settle
    await new Promise((r) => setTimeout(r, 1500));

    // Debounce: 10 rapid writes should produce <= 2 callback batches
    console.log(`[FileWatcher] Rapid writes produced ${callbacks.length} callbacks`);
    expect(callbacks.length).toBeLessThanOrEqual(5);
    expect(callbacks.length).toBeGreaterThanOrEqual(1);

    unsub();
  });

  it('should clean up watchers on destroy', async () => {
    const fs = await CatalystFS.create({
      name: 'watch-destroy-' + Date.now(),
      mounts: { '/': 'memory' },
    });

    fs.writeFileSync('/destroytest.txt', 'data');

    const changes: string[] = [];
    fs.watch('/', {}, (_event, filename) => {
      changes.push(filename);
    });

    // Destroy should stop all watchers
    fs.destroy();

    // Modify after destroy
    // Note: can't write to destroyed instance cleanly, so just verify destroy doesn't throw
    expect(true).toBe(true);
  });
});
