/**
 * Fetch host binding for QuickJS
 *
 * Injects a fetch() function into the QuickJS context that delegates
 * to the host FetchProxy. Uses QuickJS deferred promises to handle
 * the async fetch operation.
 *
 * Architecture:
 * 1. __catalyst_fetch(url, initJson) host function creates a deferred promise
 * 2. Starts real fetch via FetchProxy asynchronously
 * 3. When fetch completes, resolves/rejects the deferred promise
 * 4. Calls runtime.executePendingJobs() to process promise callbacks
 * 5. fetch() JS wrapper converts the serialized response into a Response-like object
 */

import type { FetchProxy } from './FetchProxy.js';

/**
 * Inject fetch() into a QuickJS context with FetchProxy delegation.
 *
 * @param ctx The QuickJS context
 * @param runtime The QuickJS runtime (for executePendingJobs)
 * @param fetchProxy The FetchProxy instance
 */
export function injectFetchBinding(
  ctx: any,
  runtime: any,
  fetchProxy: FetchProxy,
): void {
  // Track pending deferred promises for cleanup
  const pendingDeferreds: Array<{ deferred: any; settled: boolean }> = [];

  // Host function: starts a fetch and returns a QuickJS Promise
  const fetchFn = ctx.newFunction(
    '__catalyst_fetch',
    (urlHandle: any, initJsonHandle: any) => {
      const url = ctx.getString(urlHandle);
      let init: RequestInit = {};
      try {
        const initJson = ctx.getString(initJsonHandle);
        if (initJson && initJson !== '{}') {
          init = JSON.parse(initJson);
        }
      } catch {
        // Ignore parse errors, use default empty init
      }

      // Create QuickJS deferred promise
      const deferred = ctx.newPromise();
      const entry = { deferred, settled: false };
      pendingDeferreds.push(entry);

      // Start real fetch asynchronously
      fetchProxy
        .fetch(url, init)
        .then((response) => {
          if (entry.settled) return;
          entry.settled = true;

          const resultStr = ctx.newString(JSON.stringify(response));
          deferred.resolve(resultStr);
          resultStr.dispose();
          deferred.dispose();

          runtime.executePendingJobs();
        })
        .catch((err: any) => {
          if (entry.settled) return;
          entry.settled = true;

          const errHandle = ctx.newError(err.message || String(err));
          deferred.reject(errHandle);
          errHandle.dispose();
          deferred.dispose();

          runtime.executePendingJobs();
        });

      return deferred.handle;
    },
  );

  ctx.setProp(ctx.global, '__catalyst_fetch', fetchFn);
  fetchFn.dispose();

  // Install fetch() as a pure JS wrapper inside QuickJS
  const fetchCode = `
globalThis.fetch = function fetch(url, init) {
  var urlStr = typeof url === 'string' ? url : String(url);
  var initJson = JSON.stringify(init || {});

  return globalThis.__catalyst_fetch(urlStr, initJson).then(function(responseJson) {
    var resp = JSON.parse(responseJson);
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
      url: resp.url,
      body: resp.body,
      json: function() {
        try {
          return Promise.resolve(JSON.parse(resp.body));
        } catch(e) {
          return Promise.reject(e);
        }
      },
      text: function() {
        return Promise.resolve(resp.body);
      },
      clone: function() {
        return this;
      }
    };
  });
};
`;
  const r = ctx.evalCode(fetchCode, '<fetch-binding>');
  if (r.value) r.value.dispose();
  if (r.error) {
    const err = ctx.dump(r.error);
    r.error.dispose();
    console.error('[FetchProxy] Failed to inject fetch():', err);
  }

  // Store pending list on context for external access
  (ctx as any).__catalyst_pending_fetches = pendingDeferreds;
}

/**
 * Check if there are unsettled fetch operations.
 */
export function hasPendingFetches(ctx: any): boolean {
  const pending: Array<{ settled: boolean }> = (ctx as any).__catalyst_pending_fetches;
  if (!pending) return false;
  return pending.some((p) => !p.settled);
}

/**
 * Clean up settled fetch entries.
 */
export function cleanupSettledFetches(ctx: any): void {
  const pending: Array<{ settled: boolean }> = (ctx as any).__catalyst_pending_fetches;
  if (!pending) return;
  (ctx as any).__catalyst_pending_fetches = pending.filter((p) => !p.settled);
}
