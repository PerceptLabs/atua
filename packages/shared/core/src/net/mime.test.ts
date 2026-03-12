/**
 * MIME type mapping tests (Node — pure logic)
 */
import { describe, it, expect } from 'vitest';
import { getMimeType, getMimeMap } from './mime.js';

describe('getMimeType', () => {
  it('should return text/html for .html', () => {
    expect(getMimeType('/index.html')).toBe('text/html');
  });

  it('should return application/javascript for .js', () => {
    expect(getMimeType('/app.js')).toBe('application/javascript');
  });

  it('should return application/javascript for .mjs', () => {
    expect(getMimeType('/module.mjs')).toBe('application/javascript');
  });

  it('should return text/css for .css', () => {
    expect(getMimeType('/style.css')).toBe('text/css');
  });

  it('should return application/json for .json', () => {
    expect(getMimeType('/data.json')).toBe('application/json');
  });

  it('should return image types correctly', () => {
    expect(getMimeType('/logo.png')).toBe('image/png');
    expect(getMimeType('/photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('/icon.svg')).toBe('image/svg+xml');
    expect(getMimeType('/favicon.ico')).toBe('image/x-icon');
  });

  it('should return font types correctly', () => {
    expect(getMimeType('/font.woff')).toBe('font/woff');
    expect(getMimeType('/font.woff2')).toBe('font/woff2');
  });

  it('should return application/wasm for .wasm', () => {
    expect(getMimeType('/module.wasm')).toBe('application/wasm');
  });

  it('should return application/json for .map (source maps)', () => {
    expect(getMimeType('/app.js.map')).toBe('application/json');
  });

  it('should return application/octet-stream for unknown extensions', () => {
    expect(getMimeType('/file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('/noext')).toBe('application/octet-stream');
  });

  it('should be case-insensitive for extensions', () => {
    expect(getMimeType('/FILE.HTML')).toBe('text/html');
    expect(getMimeType('/app.JS')).toBe('application/javascript');
  });

  it('should handle nested paths', () => {
    expect(getMimeType('/dist/assets/app.js')).toBe('application/javascript');
    expect(getMimeType('/public/images/logo.png')).toBe('image/png');
  });
});

describe('getMimeMap', () => {
  it('should return at least 30 entries', () => {
    const map = getMimeMap();
    expect(Object.keys(map).length).toBeGreaterThanOrEqual(30);
  });
});
