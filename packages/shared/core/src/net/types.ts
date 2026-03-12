/**
 * AtuaNet type definitions
 */

/** Preview Service Worker configuration */
export interface PreviewConfig {
  /** Prefix for preview routes (default: '/__preview__') */
  prefix?: string;
  /** SPA fallback file (default: '/dist/index.html') */
  spaFallback?: string;
  /** Paths that bypass the SW (pass through to network) */
  passthroughPaths?: string[];
}

/** Fetch proxy configuration */
export interface FetchProxyConfig {
  /** Allowed domains for outbound requests */
  allowlist?: string[];
  /** Blocked domains */
  blocklist?: string[];
  /** Per-request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max response size in bytes (default: 10MB) */
  maxResponseSize?: number;
}
