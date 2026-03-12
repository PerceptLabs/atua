/**
 * AddonRegistry Tests — native addon WASM replacement registry
 */
import { describe, it, expect } from 'vitest';
import { AddonRegistry, type AddonEntry } from './AddonRegistry.js';

describe('AddonRegistry', () => {
  describe('default addons', () => {
    it('loads pre-configured addon mappings', () => {
      const registry = new AddonRegistry();
      expect(registry.listAddons().length).toBeGreaterThan(0);
    });

    it('knows about better-sqlite3 → sql.js', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('better-sqlite3')).toBe(true);
      expect(registry.getAlternative('better-sqlite3')).toBe('sql.js');
    });

    it('knows about bcrypt → bcryptjs', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('bcrypt')).toBe(true);
      expect(registry.getAlternative('bcrypt')).toBe('bcryptjs');
    });

    it('knows about esbuild → esbuild-wasm', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('esbuild')).toBe(true);
      expect(registry.getAlternative('esbuild')).toBe('esbuild-wasm');
    });
  });

  describe('hasAddon', () => {
    it('returns true for registered addons', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('sharp')).toBe(true);
    });

    it('returns false for unknown packages', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('express')).toBe(false);
    });
  });

  describe('getAddon', () => {
    it('returns full addon entry', () => {
      const registry = new AddonRegistry();
      const addon = registry.getAddon('bcrypt');
      expect(addon).toBeDefined();
      expect(addon!.jsAlternative).toBe('bcryptjs');
      expect(addon!.available).toBe(true);
      expect(addon!.coverage).toBe('full');
    });

    it('returns undefined for unknown packages', () => {
      const registry = new AddonRegistry();
      expect(registry.getAddon('nonexistent')).toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('returns true for available addons', () => {
      const registry = new AddonRegistry();
      expect(registry.isAvailable('bcrypt')).toBe(true);
    });

    it('returns false for unavailable addons', () => {
      const registry = new AddonRegistry();
      expect(registry.isAvailable('sharp')).toBe(false);
    });

    it('returns false for unknown packages', () => {
      const registry = new AddonRegistry();
      expect(registry.isAvailable('nonexistent')).toBe(false);
    });
  });

  describe('register / unregister', () => {
    it('registers a new addon mapping', () => {
      const registry = new AddonRegistry();
      registry.register({
        packageName: 'my-addon',
        jsAlternative: 'my-addon-js',
        description: 'Custom addon',
        available: true,
        coverage: 'full',
      });

      expect(registry.hasAddon('my-addon')).toBe(true);
      expect(registry.getAlternative('my-addon')).toBe('my-addon-js');
    });

    it('unregisters an addon', () => {
      const registry = new AddonRegistry();
      expect(registry.hasAddon('bcrypt')).toBe(true);
      const result = registry.unregister('bcrypt');
      expect(result).toBe(true);
      expect(registry.hasAddon('bcrypt')).toBe(false);
    });

    it('returns false when unregistering unknown addon', () => {
      const registry = new AddonRegistry();
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('custom addons list', () => {
    it('accepts custom addon list in constructor', () => {
      const custom: AddonEntry[] = [
        { packageName: 'foo', description: 'Foo', available: true, coverage: 'full' },
        { packageName: 'bar', description: 'Bar', available: false, coverage: 'stub' },
      ];
      const registry = new AddonRegistry(custom);
      expect(registry.listAddons().length).toBe(2);
      expect(registry.hasAddon('foo')).toBe(true);
      expect(registry.hasAddon('bcrypt')).toBe(false); // default not loaded
    });
  });

  describe('listAvailable / listUnavailable', () => {
    it('lists only available addons', () => {
      const registry = new AddonRegistry();
      const available = registry.listAvailable();
      expect(available.every((a) => a.available)).toBe(true);
    });

    it('lists only unavailable addons', () => {
      const registry = new AddonRegistry();
      const unavailable = registry.listUnavailable();
      expect(unavailable.every((a) => !a.available)).toBe(true);
    });
  });

  describe('getCompatReport', () => {
    it('generates a compatibility report', () => {
      const registry = new AddonRegistry();
      const report = registry.getCompatReport();
      expect(report.total).toBeGreaterThan(0);
      expect(report.available + report.partial + report.unavailable).toBe(report.total);
      expect(report.coverage).toBeGreaterThan(0);
      expect(report.coverage).toBeLessThanOrEqual(1);
    });

    it('returns 100% coverage for empty registry', () => {
      const registry = new AddonRegistry([]);
      const report = registry.getCompatReport();
      expect(report.total).toBe(0);
      expect(report.coverage).toBe(1);
    });
  });
});
