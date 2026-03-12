/**
 * Nitro preset for Atua — build-time configuration.
 *
 * Targets browser-based AtuaWorkers runtime:
 * - No Node.js builtins (node: false)
 * - ESM output with inlined dynamic imports (single file)
 * - Entry wraps nitroApp.localFetch in Workers-compatible fetch handler
 *
 * Usage:
 *   // nuxt.config.ts
 *   export default defineNuxtConfig({ nitro: { preset: '@aspect/nitro-preset-atua' } })
 *
 *   // nitro.config.ts
 *   export default defineNitroConfig({ preset: '@aspect/nitro-preset-atua' })
 */

/** NitroPreset-compatible configuration */
export interface AtuaNitroPreset {
  entry: string;
  node: boolean;
  rollupConfig: {
    output: {
      format: string;
      inlineDynamicImports: boolean;
    };
  };
  wasm: {
    lazy: boolean;
  };
}

const preset: AtuaNitroPreset = {
  // Runtime entry point — wraps nitroApp.localFetch in { fetch }
  entry: '@aspect/nitro-preset-atua/entry',

  // No Node.js builtins — browser target
  node: false,

  // Rollup output config
  rollupConfig: {
    output: {
      // ES module output
      format: 'esm',
      // Single file — no code splitting (SW can't load chunks)
      inlineDynamicImports: true,
    },
  },

  // WASM handling
  wasm: {
    lazy: true,
  },
};

export default preset;
