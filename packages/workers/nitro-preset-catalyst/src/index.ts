/**
 * @aspect/nitro-preset-catalyst — Nitro preset for Catalyst runtime
 *
 * Enables Nitro-based frameworks (Nuxt, SolidStart, Analog, H3) to run
 * in the browser via CatalystWorkers.
 */
export { default as preset, type CatalystNitroPreset } from './preset.js';
export {
  catalystKVDriver,
  type CatalystKVDriverOptions,
  type StorageDriver,
} from './storage-driver.js';
