/**
 * @aspect/atua-sveltekit — SvelteKit adapter for Atua runtime.
 *
 * Mirrors @sveltejs/adapter-cloudflare. Builds SvelteKit apps for the
 * browser-based AtuaWorkers runtime.
 *
 * Usage:
 *   // svelte.config.js
 *   import adapter from '@aspect/atua-sveltekit';
 *   export default {
 *     kit: {
 *       adapter: adapter(),
 *     },
 *   };
 *
 * Bindings accessible via platform.atua.env in:
 *   - +server.ts: event.platform.atua.env
 *   - +page.server.ts: event.platform.atua.env
 *   - hooks.server.ts: event.platform.atua.env
 */

/** SvelteKit adapter configuration (matches @sveltejs/kit Adapter shape) */
export interface AtuaSvelteKitAdapter {
  name: string;
  adapt: (builder: SvelteKitBuilder) => Promise<void>;
}

/** Minimal SvelteKit Builder interface (subset of @sveltejs/kit Builder) */
export interface SvelteKitBuilder {
  writeClient: (dest: string) => void;
  writeServer: (dest: string) => void;
  writePrerendered: (dest: string) => void;
  generateManifest: (options: { relativePath: string }) => string;
  getBuildDirectory: (name: string) => string;
  getServerDirectory: () => string;
  log: {
    minor: (msg: string) => void;
    info: (msg: string) => void;
  };
  rimraf: (dir: string) => void;
  mkdirp: (dir: string) => void;
  copy: (from: string, to: string) => void;
  writeFile: (file: string, data: string) => void;
}

/** Options for the Atua SvelteKit adapter */
export interface AtuaSvelteKitOptions {
  /** Output directory (default: '.atua-sveltekit') */
  out?: string;
}

/**
 * Create the Atua SvelteKit adapter.
 *
 * Configures SvelteKit to output a Workers-compatible fetch handler bundle.
 * The output is a single ES module with `export default { fetch }`.
 */
export default function adapter(
  options?: AtuaSvelteKitOptions,
): AtuaSvelteKitAdapter {
  const out = options?.out ?? '.atua-sveltekit';

  return {
    name: '@aspect/atua-sveltekit',

    async adapt(builder: SvelteKitBuilder) {
      builder.log.minor('Building for Atua runtime...');

      const serverDir = `${out}/server`;
      const clientDir = `${out}/client`;

      // Clean output
      builder.rimraf(out);
      builder.mkdirp(serverDir);
      builder.mkdirp(clientDir);

      // Write SvelteKit server code
      builder.writeServer(serverDir);

      // Write client assets
      builder.writeClient(clientDir);

      // Write prerendered pages
      builder.writePrerendered(clientDir);

      // Generate the manifest
      const manifest = builder.generateManifest({
        relativePath: './server',
      });

      // Write the Workers fetch handler entry point
      const entryCode = `
import { Server } from './server/index.js';

const manifest = ${manifest};

const server = new Server(manifest);

let initialized = false;

export default {
  async fetch(request, env, ctx) {
    if (!initialized) {
      await server.init({ env: {} });
      initialized = true;
    }

    return server.respond(request, {
      platform: {
        atua: {
          env: env || {},
          ctx: ctx,
        },
      },
      getClientAddress() {
        return '127.0.0.1';
      },
    });
  },
};
`.trim();

      builder.writeFile(`${out}/index.js`, entryCode);

      builder.log.info(
        `Atua adapter output written to ${out}/. ` +
          'Load index.js into AtuaWorkers.',
      );
    },
  };
}
