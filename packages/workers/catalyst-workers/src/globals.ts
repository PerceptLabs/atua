/**
 * Workers compat globals injection.
 *
 * In a browser context, most Web APIs needed by Workers code already exist
 * natively (fetch, Request/Response, crypto.subtle, caches, streams, etc.).
 * This module provides stubs for Workers-specific globals that may be
 * missing or differ in the browser environment.
 */

/**
 * Inject Workers-compatible globals into the given scope.
 * Idempotent — safe to call multiple times.
 */
export function injectWorkersGlobals(scope: typeof globalThis = globalThis): void {
  // navigator — already exists in browsers, but Workers has a minimal stub.
  // We don't override the browser's navigator, just ensure it exists.
  if (typeof scope.navigator === 'undefined') {
    Object.defineProperty(scope, 'navigator', {
      value: { userAgent: 'Catalyst-Workers' },
      configurable: true,
    });
  }

  // The following are already available natively in modern browsers:
  // - caches (Cache API)
  // - crypto.subtle (Web Crypto)
  // - performance.now()
  // - fetch, Request, Response, Headers
  // - URL, URLSearchParams
  // - ReadableStream, WritableStream, TransformStream
  // - TextEncoder, TextDecoder
  // - AbortController, AbortSignal
  // - setTimeout, setInterval, queueMicrotask
  // - atob, btoa
  // - structuredClone
  // - Blob, File, FormData
  // - WebSocket
  // - EventTarget, Event, CustomEvent

  // ScheduledEvent stub (for Cron Triggers, not yet implemented)
  if (!(scope as any).ScheduledEvent) {
    Object.defineProperty(scope, 'ScheduledEvent', {
      value: class ScheduledEvent extends Event {
        readonly scheduledTime: number;
        readonly cron: string;
        constructor(type: string, init?: { scheduledTime?: number; cron?: string }) {
          super(type);
          this.scheduledTime = init?.scheduledTime ?? Date.now();
          this.cron = init?.cron ?? '';
        }
      },
      configurable: true,
    });
  }
}
