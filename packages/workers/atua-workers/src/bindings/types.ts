/**
 * Shared types for Cloudflare Workers bindings emulation.
 *
 * Type shapes match Cloudflare's published TypeScript types
 * (developers.cloudflare.com) for API compatibility.
 */

// =========================================================================
// KV Types
// =========================================================================

/** Options for KV get operations */
export type KVGetType = 'text' | 'json' | 'arrayBuffer' | 'stream';

/** Options for KV put operations */
export interface KVPutOptions {
  /** Absolute expiration as Unix timestamp in seconds */
  expiration?: number;
  /** Expiration TTL in seconds from now */
  expirationTtl?: number;
  /** Arbitrary JSON metadata stored alongside the value */
  metadata?: Record<string, unknown>;
}

/** Options for KV list operations */
export interface KVListOptions {
  /** Filter keys by prefix */
  prefix?: string;
  /** Maximum number of keys to return (default 1000) */
  limit?: number;
  /** Pagination cursor from a previous list call */
  cursor?: string;
}

/** A single key entry returned by KV list */
export interface KVListKey {
  name: string;
  expiration?: number;
  metadata?: Record<string, unknown>;
}

/** Result of a KV list operation */
export interface KVListResult {
  keys: KVListKey[];
  list_complete: boolean;
  cursor?: string;
}

/** Result of getWithMetadata */
export interface KVValueWithMetadata<T = unknown> {
  value: T | null;
  metadata: Record<string, unknown> | null;
}

// =========================================================================
// R2 Types
// =========================================================================

/** HTTP metadata for R2 objects */
export interface R2HttpMetadata {
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

/** Options for R2 put operations */
export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** Options for R2 list operations */
export interface R2ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  delimiter?: string;
}

/** Metadata stored alongside R2 objects */
export interface R2ObjectMetadata {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** An R2 object with body (returned by get) */
export interface R2ObjectBody extends R2ObjectMetadata {
  body: ReadableStream;
  bodyUsed: boolean;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
}

/** Result of R2 list operation */
export interface R2Objects {
  objects: R2ObjectMetadata[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

// =========================================================================
// D1 Types (for future use in Phase 14a-2)
// =========================================================================

/** Result from D1 queries */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

/** D1 query metadata */
export interface D1Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  served_by?: string;
}

/** Result from D1 exec */
export interface D1ExecResult {
  count: number;
  duration: number;
}
