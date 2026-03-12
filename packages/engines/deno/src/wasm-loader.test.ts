/**
 * DenoWasmLoader — Unit tests
 * Validates WASM loader lifecycle, singleton pattern, and status transitions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DenoWasmLoader } from './wasm-loader.js';
import type { WasmLoaderStatus } from './wasm-loader.js';

beforeEach(() => {
  DenoWasmLoader.reset();
});

afterEach(() => {
  DenoWasmLoader.reset();
});

describe('DenoWasmLoader — Singleton', () => {
  it('returns the same instance', () => {
    const a = DenoWasmLoader.getInstance();
    const b = DenoWasmLoader.getInstance();
    expect(a).toBe(b);
  });

  it('reset creates fresh instance', () => {
    const a = DenoWasmLoader.getInstance();
    DenoWasmLoader.reset();
    const b = DenoWasmLoader.getInstance();
    expect(a).not.toBe(b);
  });
});

describe('DenoWasmLoader — Status Lifecycle', () => {
  it('starts uninitialized', () => {
    const loader = DenoWasmLoader.getInstance();
    expect(loader.getStatus()).toBe('uninitialized');
    expect(loader.getCapabilities()).toBeNull();
    expect(loader.getError()).toBeNull();
  });

  it('becomes unavailable when no WASM binary', async () => {
    const loader = DenoWasmLoader.getInstance();
    await loader.initialize();
    expect(loader.getStatus()).toBe('unavailable');
    expect(loader.getError()).toBeDefined();
    expect(loader.getError()!.message).toContain('WASM binary not available');
  });

  it('stays unavailable on repeated initialize', async () => {
    const loader = DenoWasmLoader.getInstance();
    await loader.initialize();
    expect(loader.getStatus()).toBe('unavailable');
    await loader.initialize(); // should return immediately
    expect(loader.getStatus()).toBe('unavailable');
  });
});

describe('DenoWasmLoader — Error Handling', () => {
  it('error status when WASM URL fails', async () => {
    const loader = DenoWasmLoader.getInstance({
      wasmUrl: 'http://localhost:99999/nonexistent.wasm',
    });
    await loader.initialize();
    // Either 'error' or 'unavailable' depending on fetch behavior
    const status = loader.getStatus() as WasmLoaderStatus;
    expect(['error', 'unavailable']).toContain(status);
  });

  it('createInstance throws when not ready', async () => {
    const loader = DenoWasmLoader.getInstance();
    await expect(loader.createInstance(() => {}))
      .rejects.toThrow();
  });

  it('createInstance throws after unavailable init', async () => {
    const loader = DenoWasmLoader.getInstance();
    await loader.initialize();
    await expect(loader.createInstance(() => {}))
      .rejects.toThrow('unavailable');
  });
});

describe('DenoWasmLoader — Config', () => {
  it('accepts custom config', () => {
    const loader = DenoWasmLoader.getInstance({
      cache: true,
      memoryLimit: 512,
    });
    expect(loader.getStatus()).toBe('uninitialized');
  });
});
