/**
 * Wrangler config parser — parses wrangler.toml and wrangler.jsonc formats
 * into AtuaWorkers-compatible WorkerConfig.
 *
 * Supports the subset of wrangler configuration used for bindings:
 * kv_namespaces, d1_databases, r2_buckets, vars, secrets, routes.
 */

// =========================================================================
// Public types
// =========================================================================

export interface ParsedWranglerConfig {
  /** Worker name from config */
  name?: string;
  /** Entry point script path */
  script?: string;
  /** Bindings keyed by binding name */
  bindings: Record<string, BindingConfig>;
  /** URL route patterns */
  routes: string[];
}

export interface BindingConfig {
  type: 'kv' | 'd1' | 'r2' | 'queue' | 'secret' | 'var';
  /** KV namespace ID */
  namespace?: string;
  /** D1 database name */
  database?: string;
  /** R2 bucket name */
  bucket?: string;
  /** Plain string value (secret/var) */
  value?: string;
  /** Pre-constructed binding instance (takes precedence over auto-creation) */
  instance?: unknown;
}

// =========================================================================
// Minimal TOML parser (wrangler.toml subset)
// =========================================================================

/**
 * Parse the subset of TOML used by wrangler.toml:
 * - Key = value (string, number, boolean)
 * - [section] tables
 * - [[array_of_tables]]
 * - Inline arrays ["a", "b"]
 * - # comments
 */
function parseTOML(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Array of tables: [[key]]
    const arrayMatch = line.match(/^\[\[([\w.-]+)\]\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      if (!Array.isArray(result[key])) {
        result[key] = [];
      }
      currentSection = {};
      (result[key] as Record<string, unknown>[]).push(currentSection);
      continue;
    }

    // Table: [key]
    const tableMatch = line.match(/^\[([\w.-]+)\]$/);
    if (tableMatch) {
      const key = tableMatch[1];
      if (!result[key]) {
        result[key] = {};
      }
      currentSection = result[key] as Record<string, unknown>;
      continue;
    }

    // Key = value (strip inline comments)
    const kvMatch = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      currentSection[key] = parseTOMLValue(rawValue.trim());
      continue;
    }
  }

  return result;
}

function parseTOMLValue(value: string): unknown {
  // Strip inline comment (not inside quotes)
  let cleaned = value;
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
    } else if (inQuote && ch === quoteChar && cleaned[i - 1] !== '\\') {
      inQuote = false;
    } else if (!inQuote && ch === '#') {
      cleaned = cleaned.slice(0, i).trimEnd();
      break;
    }
  }

  // Inline array
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    const inner = cleaned.slice(1, -1).trim();
    if (!inner) return [];
    return splitArrayItems(inner).map((s) => parseTOMLValue(s.trim()));
  }

  // Double-quoted string
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    return cleaned.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Single-quoted string (literal, no escapes)
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    return cleaned.slice(1, -1);
  }

  // Boolean
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;

  // Integer
  if (/^-?\d+$/.test(cleaned)) return parseInt(cleaned, 10);

  // Float
  if (/^-?\d+\.\d+$/.test(cleaned)) return parseFloat(cleaned);

  return cleaned;
}

/** Split comma-separated array items respecting quoted strings */
function splitArrayItems(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (inQuote && ch === quoteChar && inner[i - 1] !== '\\') {
      inQuote = false;
      current += ch;
    } else if (ch === ',' && !inQuote) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
}

// =========================================================================
// JSONC parser (JSON with comments)
// =========================================================================

/** Parse JSON with // and /* comments and trailing commas */
function parseJSONC(input: string): unknown {
  const stripped = input
    // Remove single-line comments (// ...)
    .replace(/\/\/[^\n]*/g, '')
    // Remove multi-line comments (/* ... */)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove trailing commas before } or ]
    .replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(stripped);
}

// =========================================================================
// Public API
// =========================================================================

/**
 * Parse a wrangler.toml or wrangler.jsonc string into a WorkerConfig.
 * Auto-detects format (TOML vs JSONC) unless explicitly specified.
 */
export function parseWranglerConfig(
  input: string,
  format?: 'toml' | 'jsonc',
): ParsedWranglerConfig {
  const fmt = format ?? (input.trim().startsWith('{') ? 'jsonc' : 'toml');
  const raw =
    fmt === 'toml'
      ? parseTOML(input)
      : (parseJSONC(input) as Record<string, unknown>);

  const config: ParsedWranglerConfig = {
    name: raw.name as string | undefined,
    script: raw.main as string | undefined,
    bindings: {},
    routes: [],
  };

  // Parse vars
  if (raw.vars && typeof raw.vars === 'object' && !Array.isArray(raw.vars)) {
    for (const [key, value] of Object.entries(
      raw.vars as Record<string, string>,
    )) {
      config.bindings[key] = { type: 'var', value: String(value) };
    }
  }

  // Parse kv_namespaces
  if (Array.isArray(raw.kv_namespaces)) {
    for (const kv of raw.kv_namespaces as Record<string, string>[]) {
      config.bindings[kv.binding] = {
        type: 'kv',
        namespace: kv.id ?? kv.binding,
      };
    }
  }

  // Parse d1_databases
  if (Array.isArray(raw.d1_databases)) {
    for (const d1 of raw.d1_databases as Record<string, string>[]) {
      config.bindings[d1.binding] = {
        type: 'd1',
        database: d1.database_name ?? d1.binding,
      };
    }
  }

  // Parse r2_buckets
  if (Array.isArray(raw.r2_buckets)) {
    for (const r2 of raw.r2_buckets as Record<string, string>[]) {
      config.bindings[r2.binding] = {
        type: 'r2',
        bucket: r2.bucket_name ?? r2.binding,
      };
    }
  }

  // Parse routes (array of strings or objects with pattern field)
  if (Array.isArray(raw.routes)) {
    for (const route of raw.routes) {
      if (typeof route === 'string') {
        config.routes.push(route);
      } else if (route && typeof route === 'object' && 'pattern' in route) {
        config.routes.push((route as Record<string, string>).pattern);
      }
    }
  } else if (typeof raw.route === 'string') {
    config.routes.push(raw.route as string);
  }

  return config;
}
