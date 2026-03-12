/**
 * CatalystExecutionContext — Cloudflare Workers ExecutionContext emulation.
 *
 * Provides waitUntil() for background promise tracking and
 * passThroughOnException() for fallthrough on error.
 */
export class CatalystExecutionContext {
  private _promises: Promise<unknown>[] = [];
  private _passThrough = false;

  /**
   * Extend the lifetime of the event handler by ensuring the given promise
   * settles before the environment is torn down.
   */
  waitUntil(promise: Promise<unknown>): void {
    this._promises.push(promise);
  }

  /**
   * When called, indicates that on unhandled exception the request should
   * pass through to the origin (static file serving) instead of returning 500.
   */
  passThroughOnException(): void {
    this._passThrough = true;
  }

  /** Internal: whether passthrough mode is active */
  get shouldPassThrough(): boolean {
    return this._passThrough;
  }

  /** Internal: all pending waitUntil promises */
  get pendingPromises(): Promise<unknown>[] {
    return this._promises;
  }

  /** Internal: wait for all pending promises to settle */
  async flush(): Promise<void> {
    await Promise.allSettled(this._promises);
  }
}
