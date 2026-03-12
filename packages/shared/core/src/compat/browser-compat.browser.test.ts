/**
 * Browser Compatibility Report — Feature detection suite
 *
 * Detects which browser APIs are available for Atua.
 * Reports native availability vs fallback status.
 */
import { describe, it, expect, afterAll } from 'vitest';

interface FeatureResult {
  feature: string;
  status: 'NATIVE' | 'FALLBACK' | 'UNAVAILABLE' | 'OK';
  fallback: string;
}

const features: FeatureResult[] = [];

function detectFeature(
  feature: string,
  check: () => boolean,
  fallback = '—',
): FeatureResult {
  const status = check() ? 'NATIVE' : 'UNAVAILABLE';
  const result: FeatureResult = { feature, status, fallback };
  features.push(result);
  return result;
}

describe('Browser Compatibility — Feature Detection', () => {
  it('OPFS (Origin Private File System)', () => {
    const result = detectFeature(
      'OPFS',
      () => typeof navigator?.storage?.getDirectory === 'function',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('FileSystemObserver', () => {
    const result = detectFeature(
      'FileSystemObserver',
      () => typeof (globalThis as any).FileSystemObserver === 'function',
      'Polling (500ms)',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('JSPI (WebAssembly.Suspending)', () => {
    const result = detectFeature(
      'JSPI (WebAssembly.Suspending)',
      () => typeof (WebAssembly as any).Suspending === 'function',
      'Asyncify (2x binary)',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('Service Worker', () => {
    const result = detectFeature(
      'Service Worker',
      () => 'serviceWorker' in navigator,
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('MessageChannel', () => {
    const result = detectFeature(
      'MessageChannel',
      () => typeof MessageChannel === 'function',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('WebCrypto', () => {
    const result = detectFeature(
      'WebCrypto',
      () => typeof crypto?.subtle?.digest === 'function',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('DecompressionStream', () => {
    const result = detectFeature(
      'DecompressionStream',
      () => typeof DecompressionStream === 'function',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('WebAssembly', () => {
    const result = detectFeature(
      'WebAssembly',
      () => typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('IndexedDB', () => {
    const result = detectFeature(
      'IndexedDB',
      () => typeof indexedDB === 'object',
    );
    expect(['NATIVE', 'UNAVAILABLE']).toContain(result.status);
  });

  it('QuickJS-WASM boot', async () => {
    let status: 'OK' | 'UNAVAILABLE' = 'UNAVAILABLE';
    try {
      const { getQuickJS } = await import('quickjs-emscripten');
      const qjs = await getQuickJS();
      const runtime = qjs.newRuntime();
      const ctx = runtime.newContext();
      const result = ctx.evalCode('1 + 1');
      if ('value' in result && result.value) {
        const val = ctx.dump(result.value);
        result.value.dispose();
        if (val === 2) status = 'OK';
      }
      if ('error' in result && result.error) result.error.dispose();
      ctx.dispose();
      runtime.dispose();
    } catch {}

    features.push({ feature: 'QuickJS-WASM', status, fallback: '—' });
    expect(status).toBe('OK');
  });
});

afterAll(() => {
  console.log('\n=== Atua Browser Compatibility Report ===');
  console.log('Feature'.padEnd(35) + '| Status'.padEnd(15) + '| Fallback');
  console.log('-'.repeat(65));
  for (const f of features) {
    console.log(
      f.feature.padEnd(35) +
        `| ${f.status}`.padEnd(15) +
        `| ${f.fallback}`,
    );
  }
  console.log('');
});
