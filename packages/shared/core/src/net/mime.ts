/**
 * MIME type mapping — extension to Content-Type
 *
 * Uses @std/media-types as the primary database with overrides
 * for web development extensions (.ts, .tsx, .jsx, .cjs).
 */
import { typeByExtension } from '@jsr/std__media-types';

/** Overrides for extensions where @std/media-types returns non-web-dev values */
const OVERRIDES: Record<string, string> = {
  '.ts': 'application/javascript',
  '.tsx': 'application/javascript',
  '.jsx': 'application/javascript',
  '.cjs': 'application/javascript',
};

/**
 * Get MIME type for a file path based on extension.
 * Returns 'application/octet-stream' for unknown types.
 */
export function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  if (OVERRIDES[ext]) return OVERRIDES[ext];
  return typeByExtension(ext) ?? 'application/octet-stream';
}

/**
 * Get the full extension-to-MIME map (for testing).
 * Returns a merged view of @std/media-types + overrides.
 */
export function getMimeMap(): Readonly<Record<string, string>> {
  // Build a map matching the old static shape for test compatibility
  const staticExts = [
    '.html', '.htm', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.xml', '.csv', '.txt',
    '.md', '.wasm', '.zip', '.gz', '.tar', '.pdf', '.map',
    '.webmanifest', '.manifest',
  ];
  const map: Record<string, string> = {};
  for (const ext of staticExts) {
    if (OVERRIDES[ext]) {
      map[ext] = OVERRIDES[ext];
    } else {
      map[ext] = typeByExtension(ext) ?? 'application/octet-stream';
    }
  }
  return map;
}
