/**
 * FetchProxy — Managed fetch for sandboxed environments
 *
 * Features:
 * - Domain allowlist/blocklist filtering
 * - Per-request timeout with AbortController
 * - Request/response serialization (structured clone safe)
 * - Max response size enforcement
 */
import type { FetchProxyConfig } from './types.js';

export interface SerializedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SerializedResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  body: string;
}

export class FetchProxy {
  private config: Required<FetchProxyConfig>;

  constructor(config: FetchProxyConfig = {}) {
    this.config = {
      allowlist: config.allowlist ?? [],
      blocklist: config.blocklist ?? [],
      timeout: config.timeout ?? 30000,
      maxResponseSize: config.maxResponseSize ?? 10 * 1024 * 1024,
    };
  }

  /** Check if a URL's domain is allowed by the allowlist/blocklist */
  isDomainAllowed(url: string): boolean {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return false; // Invalid URL
    }

    // Blocklist takes priority
    if (this.config.blocklist.length > 0) {
      for (const blocked of this.config.blocklist) {
        if (hostname === blocked || hostname.endsWith('.' + blocked)) {
          return false;
        }
      }
    }

    // If allowlist is empty, allow all (that aren't blocked)
    if (this.config.allowlist.length === 0) {
      return true;
    }

    // Check allowlist
    for (const allowed of this.config.allowlist) {
      if (hostname === allowed || hostname.endsWith('.' + allowed)) {
        return true;
      }
    }

    return false;
  }

  /** Serialize a request for structured clone transfer */
  serializeRequest(url: string, init?: RequestInit): SerializedRequest {
    return {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers
        ? Object.fromEntries(
            init.headers instanceof Headers
              ? init.headers.entries()
              : Object.entries(init.headers as Record<string, string>),
          )
        : {},
      body: init?.body != null ? String(init.body) : undefined,
    };
  }

  /** Perform a fetch with domain checking, timeout, and response size limits */
  async fetch(url: string, init?: RequestInit): Promise<SerializedResponse> {
    if (!this.isDomainAllowed(url)) {
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = url;
      }
      throw new FetchBlockedError(`FETCH_BLOCKED: Domain not allowed: ${hostname}`);
    }

    const controller = new AbortController();
    const timeoutMs = this.config.timeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      const body = await response.text();

      if (body.length > this.config.maxResponseSize) {
        throw new FetchSizeError(
          `FETCH_SIZE_EXCEEDED: Response size ${body.length} exceeds limit ${this.config.maxResponseSize}`,
        );
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url,
        body,
      };
    } catch (err: any) {
      if (err instanceof FetchBlockedError || err instanceof FetchSizeError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new FetchTimeoutError(`FETCH_TIMEOUT: Request timed out after ${timeoutMs}ms`);
      }
      throw new FetchNetworkError(`FETCH_ERROR: ${err.message || String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Get the current configuration */
  getConfig(): Readonly<Required<FetchProxyConfig>> {
    return { ...this.config };
  }
}

export class FetchBlockedError extends Error {
  readonly code = 'FETCH_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

export class FetchTimeoutError extends Error {
  readonly code = 'FETCH_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

export class FetchSizeError extends Error {
  readonly code = 'FETCH_SIZE_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'FetchSizeError';
  }
}

export class FetchNetworkError extends Error {
  readonly code = 'FETCH_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'FetchNetworkError';
  }
}
