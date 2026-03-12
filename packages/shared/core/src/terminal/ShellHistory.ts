/**
 * ShellHistory — Command history with persistence
 *
 * Supports up/down arrow navigation, search, and optional OPFS persistence.
 */

export interface ShellHistoryConfig {
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number;
  /** Persistence key for OPFS storage */
  persistKey?: string;
  /** Filesystem for persistence (AtuaFS) */
  fs?: unknown;
}

export class ShellHistory {
  private entries: string[] = [];
  private cursor = -1;
  private maxEntries: number;
  private persistKey: string | null;
  private fs: unknown;

  constructor(config: ShellHistoryConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1000;
    this.persistKey = config.persistKey ?? null;
    this.fs = config.fs ?? null;
  }

  /**
   * Add a command to history.
   * Ignores empty strings and duplicates of the last entry.
   */
  push(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    // Don't add duplicate of last entry
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.resetCursor();
  }

  /**
   * Navigate up (older) in history. Returns the command or null.
   */
  up(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor < 0) {
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    }
    return this.entries[this.cursor] ?? null;
  }

  /**
   * Navigate down (newer) in history. Returns the command or null.
   */
  down(): string | null {
    if (this.cursor < 0) return null;
    this.cursor++;
    if (this.cursor >= this.entries.length) {
      this.cursor = -1;
      return null; // past the newest — clear input
    }
    return this.entries[this.cursor] ?? null;
  }

  /**
   * Reset cursor to "end" position (no selection).
   */
  resetCursor(): void {
    this.cursor = -1;
  }

  /**
   * Get all entries.
   */
  getEntries(): string[] {
    return [...this.entries];
  }

  /**
   * Get the number of entries.
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Search history for entries matching a prefix.
   */
  search(prefix: string): string[] {
    return this.entries.filter((e) => e.startsWith(prefix));
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }

  /**
   * Persist history to filesystem.
   */
  async save(): Promise<void> {
    if (!this.persistKey || !this.fs) return;
    const fs = this.fs as any;
    try {
      const data = JSON.stringify(this.entries);
      if (fs.writeFileSync) {
        fs.writeFileSync(this.persistKey, data);
      } else if (fs.writeFile) {
        await fs.writeFile(this.persistKey, data);
      }
    } catch {
      // Persistence is best-effort
    }
  }

  /**
   * Load history from filesystem.
   */
  async load(): Promise<void> {
    if (!this.persistKey || !this.fs) return;
    const fs = this.fs as any;
    try {
      let data: string;
      if (fs.readFileSync) {
        data = fs.readFileSync(this.persistKey, 'utf-8');
      } else if (fs.readFile) {
        data = await fs.readFile(this.persistKey, 'utf-8');
      } else {
        return;
      }
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.entries = parsed.slice(-this.maxEntries);
      }
    } catch {
      // File doesn't exist yet, start fresh
    }
  }
}
