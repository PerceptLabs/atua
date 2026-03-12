/**
 * ViteRunner — Unit tests
 * Validates dev server lifecycle, HMR updates, module resolution, and file watching.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ViteRunner } from './ViteRunner.js';
import { AtuaFS } from '../../fs/AtuaFS.js';

let fs: AtuaFS;
let runner: ViteRunner;

beforeEach(async () => {
  fs = await AtuaFS.create(`vite-test-${Date.now()}`);
  // Set up minimal project structure
  fs.mkdirSync('/project', { recursive: true });
  fs.mkdirSync('/project/src', { recursive: true });
  fs.writeFileSync('/project/index.html', '<!DOCTYPE html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>');
  fs.writeFileSync('/project/src/main.ts', 'console.log("hello");');

  runner = new ViteRunner({ fs, root: '/project' });
});

afterEach(() => {
  runner.destroy();
  fs.destroy();
});

describe('ViteRunner — Construction', () => {
  it('starts idle with default port', () => {
    expect(runner.status).toBe('idle');
    expect(runner.port).toBe(5173);
    expect(runner.url).toBe('http://localhost:5173');
    expect(runner.hmrConnected).toBe(false);
  });

  it('accepts custom port', () => {
    const r = new ViteRunner({ fs, root: '/project', port: 3000 });
    expect(r.port).toBe(3000);
    expect(r.url).toBe('http://localhost:3000');
    r.destroy();
  });
});

describe('ViteRunner — Start/Stop', () => {
  it('start transitions to running', async () => {
    const info = await runner.start();
    expect(runner.status).toBe('running');
    expect(info.status).toBe('running');
    expect(info.hmrConnected).toBe(true);
    expect(info.port).toBe(5173);
  });

  it('start emits status and ready events', async () => {
    const events: string[] = [];
    runner.on('status', (s: unknown) => events.push(s as string));
    runner.on('ready', () => events.push('ready'));
    await runner.start();
    expect(events).toContain('starting');
    expect(events).toContain('running');
    expect(events).toContain('ready');
  });

  it('stop transitions to stopped', async () => {
    await runner.start();
    await runner.stop();
    expect(runner.status).toBe('stopped');
    expect(runner.hmrConnected).toBe(false);
  });

  it('start after destroy throws', async () => {
    runner.destroy();
    await expect(runner.start()).rejects.toThrow('destroyed');
  });

  it('start with missing project root throws', async () => {
    const r = new ViteRunner({ fs, root: '/nonexistent' });
    await expect(r.start()).rejects.toThrow('does not exist');
    r.destroy();
  });

  it('start with no entry point throws', async () => {
    fs.mkdirSync('/empty', { recursive: true });
    const r = new ViteRunner({ fs, root: '/empty' });
    await expect(r.start()).rejects.toThrow('No entry point');
    r.destroy();
  });

  it('double start returns existing info', async () => {
    const info1 = await runner.start();
    const info2 = await runner.start();
    expect(info1.port).toBe(info2.port);
  });
});

describe('ViteRunner — HMR Updates', () => {
  it('CSS change produces css-update', async () => {
    await runner.start();
    const update = await runner.handleFileChange('styles.css', 'update');
    expect(update).not.toBeNull();
    expect(update!.type).toBe('css-update');
    expect(update!.path).toBe('styles.css');
  });

  it('JS change produces js-update', async () => {
    await runner.start();
    const update = await runner.handleFileChange('App.tsx', 'update');
    expect(update).not.toBeNull();
    expect(update!.type).toBe('js-update');
  });

  it('TS change produces js-update', async () => {
    await runner.start();
    const update = await runner.handleFileChange('utils.ts', 'update');
    expect(update!.type).toBe('js-update');
  });

  it('Vue SFC produces js-update', async () => {
    await runner.start();
    const update = await runner.handleFileChange('App.vue', 'update');
    expect(update!.type).toBe('js-update');
  });

  it('Svelte file produces js-update', async () => {
    await runner.start();
    const update = await runner.handleFileChange('App.svelte', 'update');
    expect(update!.type).toBe('js-update');
  });

  it('HTML change produces full-reload', async () => {
    await runner.start();
    const update = await runner.handleFileChange('index.html', 'update');
    expect(update!.type).toBe('full-reload');
  });

  it('vite.config change produces full-reload', async () => {
    await runner.start();
    const update = await runner.handleFileChange('vite.config.ts', 'update');
    expect(update!.type).toBe('full-reload');
  });

  it('unknown file type produces null', async () => {
    await runner.start();
    const update = await runner.handleFileChange('image.png', 'update');
    expect(update).toBeNull();
  });

  it('emits hmr-update event', async () => {
    await runner.start();
    const updates: unknown[] = [];
    runner.on('hmr-update', (u: unknown) => updates.push(u));
    await runner.handleFileChange('app.css', 'update');
    expect(updates.length).toBe(1);
  });

  it('tracks pending updates', async () => {
    await runner.start();
    await runner.handleFileChange('a.ts', 'update');
    await runner.handleFileChange('b.css', 'update');
    expect(runner.getPendingUpdates().length).toBe(2);
    runner.clearPendingUpdates();
    expect(runner.getPendingUpdates().length).toBe(0);
  });

  it('no updates when not running', async () => {
    const update = await runner.handleFileChange('app.ts', 'update');
    expect(update).toBeNull();
  });
});

describe('ViteRunner — Module Resolution', () => {
  it('resolves existing file', async () => {
    const path = runner.resolveModulePath('/src/main.ts');
    expect(path).toBe('/project/src/main.ts');
  });

  it('resolves with extension probing', async () => {
    fs.writeFileSync('/project/src/utils.ts', 'export const x = 1;');
    const path = runner.resolveModulePath('/src/utils');
    expect(path).toBe('/project/src/utils.ts');
  });

  it('resolves index files', async () => {
    fs.mkdirSync('/project/src/components', { recursive: true });
    fs.writeFileSync('/project/src/components/index.ts', 'export {}');
    const path = runner.resolveModulePath('/src/components');
    expect(path).toBe('/project/src/components/index.ts');
  });

  it('returns null for missing file', () => {
    const path = runner.resolveModulePath('/nonexistent');
    expect(path).toBeNull();
  });

  it('strips query params', () => {
    const path = runner.resolveModulePath('/src/main.ts?t=123');
    expect(path).toBe('/project/src/main.ts');
  });
});

describe('ViteRunner — Module Graph', () => {
  it('tracks module dependencies', () => {
    runner.addModuleEdge('/src/utils.ts', '/src/App.tsx');
    runner.addModuleEdge('/src/utils.ts', '/src/main.ts');
    const importers = runner.getImporters('/src/utils.ts');
    expect(importers).toContain('/src/App.tsx');
    expect(importers).toContain('/src/main.ts');
    expect(importers.length).toBe(2);
  });

  it('returns empty for unknown module', () => {
    expect(runner.getImporters('/unknown')).toEqual([]);
  });
});

describe('ViteRunner — Destroy', () => {
  it('destroy stops runner', async () => {
    await runner.start();
    runner.destroy();
    expect(runner.status).not.toBe('running');
  });

  it('double destroy is safe', () => {
    runner.destroy();
    runner.destroy(); // should not throw
  });
});

describe('ViteRunner — Framework Mode', () => {
  it('accepts framework mode', () => {
    const r = new ViteRunner({ fs, root: '/project', framework: 'react' });
    const info = r.getServerInfo();
    expect(info.framework).toBe('react');
    r.destroy();
  });

  it('defaults to vanilla', () => {
    const info = runner.getServerInfo();
    expect(info.framework).toBe('vanilla');
  });
});
