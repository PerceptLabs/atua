/**
 * @aspect/atua-astro — Astro integration for Atua runtime.
 *
 * Mirrors @astrojs/cloudflare. Configures Astro to build for the browser-based
 * AtuaWorkers runtime with webworker SSR target.
 *
 * Usage:
 *   // astro.config.mjs
 *   import catalyst from '@aspect/atua-astro';
 *   export default defineConfig({
 *     output: 'server',
 *     adapter: atua(),
 *   });
 */

/** Astro adapter configuration (matches Astro's AstroAdapter shape) */
export interface AtuaAstroAdapter {
  name: string;
  serverEntrypoint: string;
  exports: string[];
}

/** Astro integration configuration (matches Astro's AstroIntegration shape) */
export interface AtuaAstroIntegration {
  name: string;
  hooks: {
    'astro:config:setup'?: (options: {
      config: Record<string, unknown>;
      updateConfig: (config: Record<string, unknown>) => void;
    }) => void;
    'astro:config:done'?: (options: {
      setAdapter: (adapter: AtuaAstroAdapter) => void;
    }) => void;
  };
}

/**
 * Create the Atua Astro integration.
 *
 * Configures:
 * - SSR target: webworker (browser-compatible output)
 * - Server entry: @aspect/atua-astro/server (wraps Astro App in fetch)
 * - Output: single ES module bundle
 */
export default function createIntegration(): AtuaAstroIntegration {
  return {
    name: '@aspect/atua-astro',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          build: {
            // Output directories
            client: './dist/client/',
            server: './dist/server/',
          },
          vite: {
            ssr: {
              // Target webworker for browser-compatible output
              target: 'webworker',
              // No Node.js externals
              noExternal: true,
            },
            build: {
              // Single file output
              rollupOptions: {
                output: {
                  format: 'esm',
                  inlineDynamicImports: true,
                },
              },
            },
          },
        });
      },
      'astro:config:done': ({ setAdapter }) => {
        setAdapter({
          name: '@aspect/atua-astro',
          serverEntrypoint: '@aspect/atua-astro/server',
          exports: ['default'],
        });
      },
    },
  };
}
