/**
 * InlineContext tests — same-thread eval with scope isolation
 */
import { describe, it, expect } from 'vitest';
import { InlineContext } from './InlineContext.js';

describe('InlineContext', () => {
  describe('eval', () => {
    it('should evaluate simple expressions', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('1 + 2');
      expect(result.value).toBe(3);
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should evaluate string expressions', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('"hello" + " " + "world"');
      expect(result.value).toBe('hello world');
    });

    it('should evaluate object expressions', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('({ a: 1, b: 2 })');
      expect(result.value).toEqual({ a: 1, b: 2 });
    });

    it('should evaluate array expressions', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('[1, 2, 3].map(x => x * 2)');
      expect(result.value).toEqual([2, 4, 6]);
    });

    it('should allow JSON access', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('JSON.stringify({ x: 1 })');
      expect(result.value).toBe('{"x":1}');
    });

    it('should allow Math access', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('Math.max(1, 5, 3)');
      expect(result.value).toBe(5);
    });

    it('should return error in stderr for invalid expressions', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('undeclaredVar.foo');
      expect(result.stderr).toBeTruthy();
      expect(result.value).toBeUndefined();
    });
  });

  describe('scope isolation', () => {
    it('should shadow window', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof window');
      expect(result.value).toBe('undefined');
    });

    it('should shadow document', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof document');
      expect(result.value).toBe('undefined');
    });

    it('should shadow localStorage', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof localStorage');
      expect(result.value).toBe('undefined');
    });

    it('should shadow fetch', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof fetch');
      expect(result.value).toBe('undefined');
    });

    it('should shadow Worker', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof Worker');
      expect(result.value).toBe('undefined');
    });

    it('should allow console access', async () => {
      const ctx = new InlineContext();
      const result = await ctx.eval('typeof console');
      expect(result.value).toBe('object');
    });
  });

  describe('spawn', () => {
    it('should throw — not supported', async () => {
      const ctx = new InlineContext();
      await expect(ctx.spawn('node', ['-v'])).rejects.toThrow('does not support spawn');
    });
  });

  describe('lifecycle', () => {
    it('should track idle status', () => {
      const ctx = new InlineContext();
      expect(ctx.status()).toEqual({ state: 'idle' });
    });

    it('should track destroyed status', async () => {
      const ctx = new InlineContext();
      await ctx.destroy();
      expect(ctx.status()).toEqual({ state: 'destroyed' });
    });

    it('should reject eval after destroy', async () => {
      const ctx = new InlineContext();
      await ctx.destroy();
      await expect(ctx.eval('1')).rejects.toThrow('destroyed');
    });
  });
});
