/**
 * Transaction log — circular buffer for MCP call history.
 *
 * Every hub.callTool() is recorded with timing, caller, provider, and result.
 * Fixed-size buffer evicts oldest entries when full.
 */
import type { Transaction, LogFilter } from './types.js';

const DEFAULT_CAPACITY = 10_000;

export class TransactionLog {
  private _buffer: (Transaction | undefined)[];
  private _head = 0;
  private _count = 0;
  private readonly _capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this._capacity = capacity;
    this._buffer = new Array(capacity);
  }

  get size(): number {
    return this._count;
  }

  append(entry: Transaction): void {
    this._buffer[this._head] = entry;
    this._head = (this._head + 1) % this._capacity;
    if (this._count < this._capacity) this._count++;
  }

  query(filter?: LogFilter): Transaction[] {
    const entries: Transaction[] = [];
    const start = this._count < this._capacity
      ? 0
      : this._head;

    for (let i = 0; i < this._count; i++) {
      const idx = (start + i) % this._capacity;
      const entry = this._buffer[idx];
      if (!entry) continue;

      if (filter) {
        if (filter.caller && entry.caller !== filter.caller) continue;
        if (filter.provider && entry.provider !== filter.provider) continue;
        if (filter.tool && entry.tool !== filter.tool) continue;
        if (filter.since && entry.timestamp < filter.since) continue;
      }

      entries.push(entry);
    }

    if (filter?.limit && entries.length > filter.limit) {
      return entries.slice(entries.length - filter.limit);
    }

    return entries;
  }

  clear(): void {
    this._buffer = new Array(this._capacity);
    this._head = 0;
    this._count = 0;
  }
}
