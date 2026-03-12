/**
 * Preview Service Worker browser tests
 *
 * Note: Service Worker registration requires a same-origin script URL.
 * Blob URLs can be used for SW registration in some browsers.
 * These tests validate the SW source generation and MIME mapping logic
 * in the browser environment.
 */
import { describe, it, expect } from 'vitest';
import { getPreviewSWSource } from './PreviewSW.js';
import { getMimeType } from './mime.js';

describe('Preview Service Worker (Browser)', () => {
  it('should generate valid SW source code', () => {
    const source = getPreviewSWSource();
    expect(source).toContain('addEventListener');
    expect(source).toContain('fetch');
    expect(source).toContain('catalyst-fs-port');
    expect(source).toContain('MIME_MAP');
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(100);
  });

  it('should include proper MIME types in SW source', () => {
    const source = getPreviewSWSource();
    expect(source).toContain('text/html');
    expect(source).toContain('application/javascript');
    expect(source).toContain('text/css');
    expect(source).toContain('application/json');
  });

  it('should include SPA fallback logic', () => {
    const source = getPreviewSWSource();
    expect(source).toContain('/dist/index.html');
    expect(source).toContain('Not Found');
    expect(source).toContain('404');
  });

  it('should include /api/* passthrough', () => {
    const source = getPreviewSWSource();
    expect(source).toContain('/api/');
  });

  it('MIME types should work correctly in browser', () => {
    expect(getMimeType('/index.html')).toBe('text/html');
    expect(getMimeType('/app.js')).toBe('application/javascript');
    expect(getMimeType('/style.css')).toBe('text/css');
    expect(getMimeType('/data.json')).toBe('application/json');
    expect(getMimeType('/image.png')).toBe('image/png');
    expect(getMimeType('/font.woff2')).toBe('font/woff2');
  });

  it('should have MessageChannel available for fs port communication', () => {
    const channel = new MessageChannel();
    expect(channel.port1).toBeDefined();
    expect(channel.port2).toBeDefined();
    channel.port1.close();
    channel.port2.close();
  });

  it('should have Service Worker API available', () => {
    expect('serviceWorker' in navigator).toBe(true);
  });
});
