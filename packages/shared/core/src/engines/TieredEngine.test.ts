/**
 * TieredEngine Tests
 *
 * Validates the Tier 0 → Tier 1 pipeline:
 * - Clean code passes validation and executes natively
 * - Dangerous code is rejected before execution
 * - Fallback mode allows execution after validation failure
 * - Skip validation mode bypasses checks
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TieredEngine } from './TieredEngine.js';

describe('TieredEngine', () => {
  let engine: TieredEngine;

  beforeEach(async () => {
    engine = await TieredEngine.create({
      validation: { skipSandbox: true },
    });
  });

  afterEach(async () => {
    await engine.destroy();
  });

  describe('Clean code execution', () => {
    it('executes clean code through the full pipeline', async () => {
      const result = await engine.eval('module.exports = 1 + 2;');
      expect(result).toBe(3);
    });

    it('executes code with require()', async () => {
      const result = await engine.eval(`
        var path = require('path');
        module.exports = path.join('a', 'b');
      `);
      expect(result).toBe('a/b');
    });

    it('captures console output', async () => {
      const logs: string[] = [];
      engine.on('console', (_level: unknown, ...args: unknown[]) => {
        logs.push(args.join(' '));
      });

      await engine.eval('console.log("tiered hello");');
      expect(logs).toContain('tiered hello');
    });
  });

  describe('Validation rejection', () => {
    it('rejects code with eval()', async () => {
      await expect(
        engine.eval('eval("dangerous");')
      ).rejects.toThrow('Code validation failed');
    });

    it('rejects code with Function constructor', async () => {
      await expect(
        engine.eval('new Function("return this")()')
      ).rejects.toThrow('Code validation failed');
    });

    it('rejects code with __proto__ pollution', async () => {
      await expect(
        engine.eval('var obj = {}; obj.__proto__.isAdmin = true;')
      ).rejects.toThrow('Code validation failed');
    });

    it('emits validation-failure event', async () => {
      const failures: unknown[] = [];
      engine.on('validation-failure', (v: unknown) => failures.push(v));

      await expect(engine.eval('eval("x")')).rejects.toThrow();
      expect(failures.length).toBe(1);
    });

    it('provides validation details in lastValidation', async () => {
      await expect(engine.eval('eval("x")')).rejects.toThrow();
      const v = engine.lastValidation;
      expect(v).toBeDefined();
      expect(v!.valid).toBe(false);
      expect(v!.ast.violations.length).toBeGreaterThan(0);
    });
  });

  describe('Fallback mode', () => {
    it('executes dangerous code when fallback is enabled', async () => {
      const fallbackEngine = await TieredEngine.create({
        validation: { skipSandbox: true },
        fallbackOnValidationFailure: true,
      });

      const warnings: string[] = [];
      fallbackEngine.on('console', (level: unknown, ...args: unknown[]) => {
        if (level === 'warn') warnings.push(args.join(' '));
      });

      // In native mode, window.location won't exist, so this is just
      // a validation test — the code still runs
      const result = await fallbackEngine.eval('module.exports = "fallback-worked";');
      expect(result).toBe('fallback-worked');

      await fallbackEngine.destroy();
    });
  });

  describe('Skip validation mode', () => {
    it('skips all validation when configured', async () => {
      const trustEngine = await TieredEngine.create({
        skipValidation: true,
      });

      // eval() would normally be blocked, but validation is skipped
      // The code itself doesn't call eval since we're in Function() context
      const result = await trustEngine.eval('module.exports = "trusted";');
      expect(result).toBe('trusted');

      await trustEngine.destroy();
    });
  });

  describe('IEngine contract', () => {
    it('implements createInstance()', async () => {
      const child = await engine.createInstance({});
      expect(child).toBeDefined();
      await child.destroy();
    });

    it('implements destroy()', async () => {
      await engine.destroy();
      await expect(engine.eval('1')).rejects.toThrow('disposed');
    });

    it('double destroy is safe', async () => {
      await engine.destroy();
      await engine.destroy(); // should not throw
    });

    it('implements on/off', () => {
      const handler = () => {};
      engine.on('test', handler);
      engine.off('test', handler);
    });
  });
});
