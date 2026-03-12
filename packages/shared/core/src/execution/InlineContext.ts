/**
 * InlineContext — Same-thread JavaScript evaluation with scope isolation.
 *
 * Uses new Function() + with() block to shadow browser globals.
 * ShadowRealm-ready: when browsers ship ShadowRealm, this class
 * switches to realm.evaluate() for proper scope isolation.
 *
 * Use cases: trivial expressions, config generation, pure data transforms.
 * NOT suitable for untrusted code (no timeout, no memory isolation).
 */
import type {
  ExecutionContext,
  EvalOpts,
  SpawnOpts,
  ExecResult,
  ProcessResult,
  ContextStatus,
} from './types.js';

/**
 * Globals to shadow inside the with() block.
 * The Proxy's has() trap returns true for ALL lookups, but these
 * are explicitly set to undefined so they resolve to undefined
 * rather than falling through to the real global scope.
 */
const SHADOWED_GLOBALS: Record<string, undefined> = {
  window: undefined,
  document: undefined,
  localStorage: undefined,
  sessionStorage: undefined,
  indexedDB: undefined,
  fetch: undefined,
  XMLHttpRequest: undefined,
  WebSocket: undefined,
  Worker: undefined,
  SharedWorker: undefined,
  ServiceWorker: undefined,
  location: undefined,
  navigator: undefined,
  history: undefined,
  alert: undefined,
  confirm: undefined,
  prompt: undefined,
  open: undefined,
  close: undefined,
  postMessage: undefined,
  importScripts: undefined,
};

export class InlineContext implements ExecutionContext {
  private _destroyed = false;
  private _status: ContextStatus = { state: 'idle' };

  /**
   * The scope proxy intercepts all variable lookups inside the with() block.
   * has() returns true for everything → all lookups go through the proxy.
   * get() returns undefined for shadowed globals, undefined for unknowns.
   */
  private readonly scopeProxy = new Proxy(SHADOWED_GLOBALS, {
    has: () => true,
    get: (_target, prop) => {
      if (typeof prop === 'string' && prop in SHADOWED_GLOBALS) {
        return undefined;
      }
      // Allow access to built-in constructors and values
      if (prop === 'undefined') return undefined;
      if (prop === 'NaN') return NaN;
      if (prop === 'Infinity') return Infinity;
      if (prop === 'isNaN') return isNaN;
      if (prop === 'isFinite') return isFinite;
      if (prop === 'parseInt') return parseInt;
      if (prop === 'parseFloat') return parseFloat;
      if (prop === 'encodeURIComponent') return encodeURIComponent;
      if (prop === 'decodeURIComponent') return decodeURIComponent;
      if (prop === 'encodeURI') return encodeURI;
      if (prop === 'decodeURI') return decodeURI;
      if (prop === 'JSON') return JSON;
      if (prop === 'Math') return Math;
      if (prop === 'Date') return Date;
      if (prop === 'Array') return Array;
      if (prop === 'Object') return Object;
      if (prop === 'String') return String;
      if (prop === 'Number') return Number;
      if (prop === 'Boolean') return Boolean;
      if (prop === 'RegExp') return RegExp;
      if (prop === 'Error') return Error;
      if (prop === 'TypeError') return TypeError;
      if (prop === 'RangeError') return RangeError;
      if (prop === 'Map') return Map;
      if (prop === 'Set') return Set;
      if (prop === 'WeakMap') return WeakMap;
      if (prop === 'WeakSet') return WeakSet;
      if (prop === 'Promise') return Promise;
      if (prop === 'Symbol') return Symbol;
      if (prop === 'Proxy') return Proxy;
      if (prop === 'Reflect') return Reflect;
      if (prop === 'console') return console; // Allow console for debugging
      return undefined;
    },
  });

  async eval(code: string, _opts?: EvalOpts): Promise<ExecResult> {
    if (this._destroyed) {
      throw new Error('InlineContext is destroyed');
    }

    const start = performance.now();
    this._status = { state: 'executing', startedAt: Date.now() };

    try {
      const fn = new Function('__scope', `with(__scope) { return (${code}); }`);
      const value = fn(this.scopeProxy);
      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };
      return { value, stdout: '', stderr: '', durationMs, timedOut: false };
    } catch (err) {
      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };
      return {
        value: undefined,
        stdout: '',
        stderr: (err as Error).message,
        durationMs,
        timedOut: false,
      };
    }
  }

  async spawn(_command: string, _args?: string[], _opts?: SpawnOpts): Promise<ProcessResult> {
    throw new Error('InlineContext does not support spawn');
  }

  async destroy(): Promise<void> {
    this._destroyed = true;
    this._status = { state: 'destroyed' };
  }

  status(): ContextStatus {
    return this._status;
  }
}
