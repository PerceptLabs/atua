/**
 * CatalystDNS — DNS resolution via DNS-over-HTTPS (DoH)
 *
 * Phase G: Provides dns.lookup(), dns.resolve(), dns.resolve4(), dns.resolve6()
 * backed by real DNS resolution using the browser's fetch API + DoH providers.
 *
 * Default providers:
 * - Cloudflare: https://cloudflare-dns.com/dns-query
 * - Google: https://dns.google/dns-query (fallback)
 */

export interface DNSConfig {
  /** DoH endpoint URL (default: Cloudflare) */
  dohEndpoint?: string;
  /** Fallback DoH endpoint (default: Google) */
  fallbackEndpoint?: string;
  /** Cache TTL in ms (default: 60000) */
  cacheTtl?: number;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
}

export interface DNSRecord {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DNSResponse {
  Status: number;
  Answer?: DNSRecord[];
}

const DEFAULT_DOH = 'https://cloudflare-dns.com/dns-query';
const DEFAULT_FALLBACK = 'https://dns.google/dns-query';
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;
const DNS_TYPE_CNAME = 5;
const DNS_TYPE_MX = 15;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_NS = 2;
const DNS_TYPE_SOA = 6;
const DNS_TYPE_SRV = 33;

export class CatalystDNS {
  private config: Required<DNSConfig>;
  private cache = new Map<string, { data: string[]; expires: number }>();

  constructor(config: DNSConfig = {}) {
    this.config = {
      dohEndpoint: config.dohEndpoint ?? DEFAULT_DOH,
      fallbackEndpoint: config.fallbackEndpoint ?? DEFAULT_FALLBACK,
      cacheTtl: config.cacheTtl ?? 60000,
      timeout: config.timeout ?? 5000,
    };
  }

  /**
   * Resolve hostname to IP addresses (A records).
   * Drop-in replacement for dns.lookup().
   */
  async lookup(
    hostname: string,
    options?: { family?: 4 | 6 },
  ): Promise<{ address: string; family: 4 | 6 }> {
    const family = options?.family ?? 4;
    const type = family === 6 ? DNS_TYPE_AAAA : DNS_TYPE_A;
    const records = await this.query(hostname, type);

    if (records.length === 0) {
      throw new Error(`ENOTFOUND: DNS lookup failed for '${hostname}'`);
    }

    return { address: records[0], family };
  }

  /**
   * Resolve hostname to all A records.
   * Drop-in replacement for dns.resolve4().
   */
  async resolve4(hostname: string): Promise<string[]> {
    return this.query(hostname, DNS_TYPE_A);
  }

  /**
   * Resolve hostname to all AAAA records.
   * Drop-in replacement for dns.resolve6().
   */
  async resolve6(hostname: string): Promise<string[]> {
    return this.query(hostname, DNS_TYPE_AAAA);
  }

  /**
   * General resolver — maps to dns.resolve().
   */
  async resolve(
    hostname: string,
    rrtype: string = 'A',
  ): Promise<string[]> {
    const typeMap: Record<string, number> = {
      A: DNS_TYPE_A,
      AAAA: DNS_TYPE_AAAA,
      CNAME: DNS_TYPE_CNAME,
      MX: DNS_TYPE_MX,
      TXT: DNS_TYPE_TXT,
      NS: DNS_TYPE_NS,
      SOA: DNS_TYPE_SOA,
      SRV: DNS_TYPE_SRV,
    };

    const type = typeMap[rrtype.toUpperCase()];
    if (!type) throw new Error(`Unsupported DNS record type: ${rrtype}`);

    return this.query(hostname, type);
  }

  /**
   * Reverse DNS lookup.
   */
  async reverse(ip: string): Promise<string[]> {
    // Convert IP to PTR domain
    const parts = ip.split('.');
    if (parts.length !== 4) throw new Error('Only IPv4 reverse lookup is supported');
    const ptrDomain = parts.reverse().join('.') + '.in-addr.arpa';
    return this.query(ptrDomain, 12); // PTR = 12
  }

  /** Low-level DoH query */
  private async query(name: string, type: number): Promise<string[]> {
    const cacheKey = `${name}:${type}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    // Try primary endpoint
    try {
      const records = await this.doQuery(this.config.dohEndpoint, name, type);
      this.cache.set(cacheKey, {
        data: records,
        expires: Date.now() + this.config.cacheTtl,
      });
      return records;
    } catch {
      // Fall through to fallback
    }

    // Try fallback endpoint
    try {
      const records = await this.doQuery(this.config.fallbackEndpoint, name, type);
      this.cache.set(cacheKey, {
        data: records,
        expires: Date.now() + this.config.cacheTtl,
      });
      return records;
    } catch (err: any) {
      throw new Error(`DNS query failed for '${name}': ${err.message}`);
    }
  }

  private async doQuery(endpoint: string, name: string, type: number): Promise<string[]> {
    const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`DoH response: ${response.status}`);
      }

      const data: DNSResponse = await response.json();

      if (data.Status !== 0) {
        throw new Error(`DNS error status: ${data.Status}`);
      }

      return (data.Answer ?? [])
        .filter((r) => r.type === type)
        .map((r) => r.data.replace(/^"|"$/g, ''));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Clear the DNS cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get cache stats */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Generate the dns module source for the engine's require() system.
 */
export function getDNSModuleSource(): string {
  return `
(function() {
  // CatalystDNS — DNS resolution stubs
  // Real resolution happens via the host CatalystDNS class via fetch.
  // This module provides the Node.js dns API surface.

  var pendingCallbacks = [];

  function notImplemented(name) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(new Error('dns.' + name + '() requires DoH — use CatalystDNS from the host'));
      } else {
        throw new Error('dns.' + name + '() requires DoH — use CatalystDNS from the host');
      }
    };
  }

  module.exports.lookup = notImplemented('lookup');
  module.exports.resolve = notImplemented('resolve');
  module.exports.resolve4 = notImplemented('resolve4');
  module.exports.resolve6 = notImplemented('resolve6');
  module.exports.reverse = notImplemented('reverse');
  module.exports.resolveMx = notImplemented('resolveMx');
  module.exports.resolveTxt = notImplemented('resolveTxt');
  module.exports.resolveNs = notImplemented('resolveNs');
  module.exports.resolveSrv = notImplemented('resolveSrv');
  module.exports.resolveCname = notImplemented('resolveCname');

  module.exports.promises = {
    lookup: function() { return Promise.reject(new Error('dns.promises.lookup() requires CatalystDNS')); },
    resolve: function() { return Promise.reject(new Error('dns.promises.resolve() requires CatalystDNS')); },
    resolve4: function() { return Promise.reject(new Error('dns.promises.resolve4() requires CatalystDNS')); },
    resolve6: function() { return Promise.reject(new Error('dns.promises.resolve6() requires CatalystDNS')); },
  };

  // Constants
  module.exports.ADDRCONFIG = 0;
  module.exports.V4MAPPED = 0;
  module.exports.NODATA = 'ENODATA';
  module.exports.FORMERR = 'EFORMERR';
  module.exports.SERVFAIL = 'ESERVFAIL';
  module.exports.NOTFOUND = 'ENOTFOUND';
  module.exports.NOTIMP = 'ENOTIMP';
  module.exports.REFUSED = 'EREFUSED';
})();
`;
}
