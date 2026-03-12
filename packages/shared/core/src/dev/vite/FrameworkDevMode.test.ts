/**
 * FrameworkDevMode — Unit tests
 * Validates framework detection, dev server lifecycle, and configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FrameworkDevMode } from './FrameworkDevMode.js';
import { AtuaFS } from '../../fs/AtuaFS.js';

let fs: AtuaFS;
let mode: FrameworkDevMode;

beforeEach(async () => {
  fs = await AtuaFS.create(`fw-test-${Date.now()}`);
  fs.mkdirSync('/project', { recursive: true });
  fs.mkdirSync('/project/src', { recursive: true });
  mode = new FrameworkDevMode({ fs, root: '/project' });
});

afterEach(() => {
  mode.destroy();
  fs.destroy();
});

describe('FrameworkDevMode — Detection', () => {
  it('detects Nuxt project', () => {
    fs.writeFileSync('/project/nuxt.config.ts', 'export default defineNuxtConfig({})');
    const result = mode.detect();
    expect(result.framework).toBe('nuxt');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects Astro project', () => {
    fs.writeFileSync('/project/astro.config.mjs', 'export default {}');
    const result = mode.detect();
    expect(result.framework).toBe('astro');
  });

  it('detects SvelteKit project', () => {
    fs.writeFileSync('/project/svelte.config.js', 'export default {}');
    const result = mode.detect();
    expect(result.framework).toBe('sveltekit');
  });

  it('detects Vue project', () => {
    fs.writeFileSync('/project/src/App.vue', '<template><div>Hello</div></template>');
    const result = mode.detect();
    expect(result.framework).toBe('vue');
  });

  it('detects React project', () => {
    fs.writeFileSync('/project/src/App.tsx', 'export default function App() { return <div/>; }');
    const result = mode.detect();
    // Could be react or solid — both use App.tsx
    expect(['react', 'solid']).toContain(result.framework);
  });

  it('detects vanilla Vite with index.html', () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    const result = mode.detect();
    expect(result.framework).toBe('vanilla');
    expect(result.entryPoint).toBe('index.html');
  });

  it('returns vanilla with low confidence for empty project', () => {
    const result = mode.detect();
    expect(result.framework).toBe('vanilla');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('finds config file', () => {
    fs.writeFileSync('/project/nuxt.config.ts', 'export default {}');
    const result = mode.detect();
    expect(result.configFile).toBe('/project/nuxt.config.ts');
  });
});

describe('FrameworkDevMode — Start/Stop', () => {
  it('start creates and runs ViteRunner', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    const info = await mode.start();
    expect(mode.running).toBe(true);
    expect(info.status).toBe('running');
  });

  it('stop shuts down runner', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    await mode.start();
    await mode.stop();
    expect(mode.running).toBe(false);
  });

  it('restart cycles the server', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    await mode.start();
    const info = await mode.restart();
    expect(info.status).toBe('running');
  });

  it('start after destroy throws', async () => {
    mode.destroy();
    await expect(mode.start()).rejects.toThrow('destroyed');
  });

  it('emits start event', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    const events: string[] = [];
    mode.on('start', () => events.push('started'));
    await mode.start();
    expect(events).toEqual(['started']);
  });

  it('emits stop event', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    const events: string[] = [];
    mode.on('stop', () => events.push('stopped'));
    await mode.start();
    await mode.stop();
    expect(events).toEqual(['stopped']);
  });
});

describe('FrameworkDevMode — Framework Override', () => {
  it('respects framework override', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    const m = new FrameworkDevMode({ fs, root: '/project', framework: 'react' });
    const info = await m.start();
    expect(info.framework).toBe('react');
    m.destroy();
  });
});

describe('FrameworkDevMode — Runner Access', () => {
  it('getRunner returns null before start', () => {
    expect(mode.getRunner()).toBeNull();
  });

  it('getRunner returns runner after start', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    await mode.start();
    expect(mode.getRunner()).not.toBeNull();
  });

  it('getRunner returns null after stop', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    await mode.start();
    await mode.stop();
    expect(mode.getRunner()).toBeNull();
  });
});

describe('FrameworkDevMode — Destroy', () => {
  it('destroy stops and cleans up', async () => {
    fs.writeFileSync('/project/index.html', '<html></html>');
    await mode.start();
    mode.destroy();
    expect(mode.destroyed).toBe(true);
    expect(mode.running).toBe(false);
  });

  it('double destroy is safe', () => {
    mode.destroy();
    mode.destroy();
  });
});
