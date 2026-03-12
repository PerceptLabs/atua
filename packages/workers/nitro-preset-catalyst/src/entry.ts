/**
 * Nitro entry point for Catalyst runtime.
 *
 * This file is bundled by Nitro's build pipeline (rollup), NOT by our build.
 * The imports (#nitro-internal-pollyfills, nitropack/runtime) are resolved
 * by Nitro's virtual module system at build time.
 *
 * At runtime, this wraps nitroApp.localFetch() in the Workers module format:
 *   export default { async fetch(request, env, ctx) { ... } }
 *
 * Bindings are made accessible to route handlers via event.context.catalyst.env.
 */

// @ts-ignore — resolved by Nitro's build system
import '#nitro-internal-pollyfills';
// @ts-ignore — resolved by Nitro's build system
import { useNitroApp } from 'nitropack/runtime';

const nitroApp = useNitroApp();

export default {
  /**
   * Workers-compatible fetch handler.
   * Called by CatalystWorkers runtime for each matching request.
   */
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx?: { waitUntil?: (p: Promise<unknown>) => void },
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Map browser Request to Nitro's localFetch format
      const response = await nitroApp.localFetch(
        url.pathname + url.search,
        {
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body: request.body,
          // Pass Catalyst bindings via H3 event context
          context: {
            catalyst: {
              env,
              ctx,
            },
          },
        },
      );

      return response;
    } catch (error) {
      // Return 500 on unhandled errors
      const message =
        error instanceof Error ? error.message : 'Internal Server Error';
      return new Response(message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
