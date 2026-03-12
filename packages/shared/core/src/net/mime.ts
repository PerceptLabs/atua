/**
 * MIME type mapping — extension to Content-Type
 */
const MIME_MAP: Record<string, string> = {
  // HTML
  '.html': 'text/html',
  '.htm': 'text/html',

  // JavaScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.jsx': 'application/javascript',

  // TypeScript (served as JS when compiled)
  '.ts': 'application/javascript',
  '.tsx': 'application/javascript',

  // CSS
  '.css': 'text/css',

  // JSON
  '.json': 'application/json',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Media
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',

  // Data
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',

  // Archives / Binary
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.pdf': 'application/pdf',

  // Source maps
  '.map': 'application/json',

  // Manifest
  '.webmanifest': 'application/manifest+json',
  '.manifest': 'text/cache-manifest',
};

/**
 * Get MIME type for a file path based on extension.
 * Returns 'application/octet-stream' for unknown types.
 */
export function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Get the extension-to-MIME map (for testing)
 */
export function getMimeMap(): Readonly<Record<string, string>> {
  return MIME_MAP;
}
