/**
 * @aspect/catalyst-astro — Astro integration for Catalyst runtime.
 *
 * Mirrors @astrojs/cloudflare. Configures Astro to build for the browser-based
 * CatalystWorkers runtime with webworker SSR target.
 *
 * Usage:
 *   // astro.config.mjs
 *   import catalyst from '@aspect/catalyst-astro';
 *   export default defineConfig({
 *     output: 'server',
 *     adapter: catalyst(),
 *   });
 */

/** Astro adapter configuration (matches Astro's AstroAdapter shape) */
export interface CatalystAstroAdapter {
  name: string;
  serverEntrypoint: string;
  exports: string[];
}

/** Astro integration configuration (matches Astro's AstroIntegration shape) */
export interface CatalystAstroIntegration {
  name: string;
  hooks: {
    'astro:config:setup'?: (options: {
      config: Record<string, unknown>;
      updateConfig: (config: Record<string, unknown>) => void;
    }) => void;
    'astro:config:done'?: (options: {
      setAdapter: (adapter: CatalystAstroAdapter) => void;
    }) => void;
  };
}

/**
 * Create the Catalyst Astro integration.
 *
 * Configures:
 * - SSR target: webworker (browser-compatible output)
 * - Server entry: @aspect/catalyst-astro/server (wraps Astro App in fetch)
 * - Output: single ES module bundle
 */
export default function createIntegration(): CatalystAstroIntegration {
  return {
    name: '@aspect/catalyst-astro',
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
          name: '@aspect/catalyst-astro',
          serverEntrypoint: '@aspect/catalyst-astro/server',
          exports: ['default'],
        });
      },
    },
  };
}
