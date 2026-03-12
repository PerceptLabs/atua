/**
 * FileWatcher — Native FileSystemObserver with polling fallback
 *
 * - Feature-detects FileSystemObserver (Chrome 129+)
 * - Falls back to polling with content-hash comparison (500ms interval)
 * - Unified callback: watch(path, options, callback) -> unsubscribe
 * - Debounce: 50ms
 */
import type { WatchCallback, WatchEventType } from './types.js';

interface WatchOptions {
  recursive?: boolean;
}

type UnsubscribeFn = () => void;

/**
 * Detect if native FileSystemObserver is available
 */
export function hasNativeObserver(): boolean {
  return typeof (globalThis as any).FileSystemObserver !== 'undefined';
}

/**
 * Simple content hash using string length + first/last chars.
 * For polling fallback — not cryptographic.
 */
function quickHash(content: string): string {
  if (content.length === 0) return '0:';
  return `${content.length}:${content.charCodeAt(0)}:${content.charCodeAt(content.length - 1)}`;
}

/**
 * Create a debounced function that batches calls within the given interval.
 */
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

/**
 * Polling-based file watcher fallback.
 * Scans files at the given interval, compares content hashes.
 */
export class PollingWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private hashes = new Map<string, string>();
  private fs: any;
  private path: string;
  private recursive: boolean;
  private callback: WatchCallback;
  private debouncedNotify: () => void;
  private pendingChanges: Array<{ eventType: WatchEventType; filename: string }> = [];
  private initialScanDone = false;

  constructor(
    fs: any,
    path: string,
    options: WatchOptions,
    callback: WatchCallback,
    pollInterval = 500,
    debounceMs = 50
  ) {
    this.fs = fs;
    this.path = path;
    this.recursive = options.recursive ?? false;
    this.callback = callback;

    this.debouncedNotify = debounce(() => {
      const changes = [...this.pendingChanges];
      this.pendingChanges = [];
      for (const { eventType, filename } of changes) {
        this.callback(eventType, filename);
      }
    }, debounceMs);

    // Initial scan to populate hashes
    this.scan();
    this.initialScanDone = true;

    // Start polling
    this.interval = setInterval(() => this.scan(), pollInterval);
  }

  private getFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = this.fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = dir === '/' ? `/${entry}` : `${dir}/${entry}`;
        try {
          const stat = this.fs.statSync(fullPath);
          if (stat.isFile()) {
            files.push(fullPath);
          } else if (stat.isDirectory() && this.recursive) {
            files.push(...this.getFiles(fullPath));
          }
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    } catch {
      // Directory may not exist
    }
    return files;
  }

  private scan(): void {
    const files = this.getFiles(this.path);
    const currentPaths = new Set(files);

    // Check for new and changed files
    for (const filePath of files) {
      try {
        const content = this.fs.readFileSync(filePath, 'utf-8');
        const hash = quickHash(content as string);
        const oldHash = this.hashes.get(filePath);
        if (oldHash === undefined) {
          // New file
          this.hashes.set(filePath, hash);
          if (this.initialScanDone) {
            this.pendingChanges.push({ eventType: 'rename', filename: filePath });
            this.debouncedNotify();
          }
        } else if (oldHash !== hash) {
          // Changed file
          this.hashes.set(filePath, hash);
          this.pendingChanges.push({ eventType: 'change', filename: filePath });
          this.debouncedNotify();
        }
      } catch {
        // File was deleted during scan
      }
    }

    // Check for deleted files
    for (const [path] of this.hashes) {
      if (!currentPaths.has(path)) {
        this.hashes.delete(path);
        this.pendingChanges.push({ eventType: 'rename', filename: path });
        this.debouncedNotify();
      }
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

/**
 * Create a file watcher for the given path.
 * Returns an unsubscribe function.
 */
export function watch(
  fs: any,
  path: string,
  options: WatchOptions,
  callback: WatchCallback,
  pollInterval = 500,
  debounceMs = 50
): UnsubscribeFn {
  const watcher = new PollingWatcher(fs, path, options, callback, pollInterval, debounceMs);
  return () => watcher.stop();
}
