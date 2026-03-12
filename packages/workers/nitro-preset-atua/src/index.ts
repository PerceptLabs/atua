/**
 * @aspect/nitro-preset-atua — Nitro preset for Atua runtime
 *
 * Enables Nitro-based frameworks (Nuxt, SolidStart, Analog, H3) to run
 * in the browser vian AtuaWorkers.
 */
export { default as preset, type AtuaNitroPreset } from './preset.js';
export {
  atuaKVDriver,
  type AtuaKVDriverOptions,
  type StorageDriver,
} from './storage-driver.js';
