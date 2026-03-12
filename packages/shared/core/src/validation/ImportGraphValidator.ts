/**
 * ImportGraphValidator — Validate require/import targets against allowlist
 *
 * Ensures code only imports known-good modules:
 * - Node.js builtins (path, fs, crypto, etc.)
 * - Installed packages (/node_modules/*)
 * - Relative paths (./*, ../*)
 * - Blocks filesystem traversal attacks (/etc/passwd, etc.)
 */

export interface ImportValidationResult {
  valid: boolean;
  blockedImports: BlockedImport[];
}

export interface BlockedImport {
  specifier: string;
  reason: string;
  line?: number;
}

/** Known safe Node.js builtin modules */
const ALLOWED_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib',
]);

/** Patterns that indicate dangerous filesystem access */
const DANGEROUS_PATH_PATTERNS = [
  /^\/etc\//,
  /^\/proc\//,
  /^\/sys\//,
  /^\/dev\//,
  /^\/var\/log\//,
  /^\/root\//,
  /^\/home\//,
  /^~\//,
  /^[A-Za-z]:\\/,    // Windows absolute paths
  /\.\.[\/\\]/,       // Directory traversal
  /\0/,              // Null byte injection
];

/**
 * Extract all require() and import specifiers from code.
 */
function extractImports(code: string): Array<{ specifier: string; line: number }> {
  const imports: Array<{ specifier: string; line: number }> = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Match require('...') and require("...")
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = requireRegex.exec(line)) !== null) {
      imports.push({ specifier: match[1], line: lineNum });
    }

    // Match import ... from '...' and import ... from "..."
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(line)) !== null) {
      imports.push({ specifier: match[1], line: lineNum });
    }

    // Match import('...') - static string imports
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(line)) !== null) {
      imports.push({ specifier: match[1], line: lineNum });
    }
  }

  return imports;
}

/**
 * Validate all imports in code against the allowlist.
 */
export function validateImports(
  code: string,
  options: {
    allowedPackages?: Set<string>;
    allowRelative?: boolean;
  } = {},
): ImportValidationResult {
  const { allowRelative = true } = options;
  const imports = extractImports(code);
  const blockedImports: BlockedImport[] = [];

  for (const imp of imports) {
    const specifier = imp.specifier;

    // Strip node: prefix
    const normalizedSpec = specifier.startsWith('node:') ? specifier.slice(5) : specifier;

    // Allow Node.js builtins
    if (ALLOWED_BUILTINS.has(normalizedSpec)) continue;

    // Allow relative paths (with safety check)
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      if (!allowRelative) {
        blockedImports.push({
          specifier,
          reason: 'Relative imports are not allowed in this context',
          line: imp.line,
        });
        continue;
      }

      // Check for directory traversal attacks
      const isDangerous = DANGEROUS_PATH_PATTERNS.some((p) => p.test(specifier));
      if (isDangerous) {
        blockedImports.push({
          specifier,
          reason: 'Dangerous path detected — potential filesystem traversal attack',
          line: imp.line,
        });
      }
      continue;
    }

    // Check for dangerous absolute paths
    const isDangerous = DANGEROUS_PATH_PATTERNS.some((p) => p.test(specifier));
    if (isDangerous) {
      blockedImports.push({
        specifier,
        reason: `Blocked: '${specifier}' — filesystem access outside project scope`,
        line: imp.line,
      });
      continue;
    }

    // URL imports — check before npm package name test (URLs start with lowercase too)
    if (specifier.startsWith('https://') || specifier.startsWith('http://')) {
      // Allow known CDN URLs
      try {
        const url = new URL(specifier);
        const allowed = [
          'esm.sh', 'cdn.esm.sh',
          'deno.land', 'cdn.deno.land',
          'unpkg.com', 'cdn.jsdelivr.net',
          'npm.jsr.io',
        ];
        if (!allowed.some((d) => url.hostname === d || url.hostname.endsWith('.' + d))) {
          blockedImports.push({
            specifier,
            reason: `URL import from '${url.hostname}' is not from an allowed CDN`,
            line: imp.line,
          });
        }
      } catch {
        blockedImports.push({
          specifier,
          reason: 'Invalid URL in import specifier',
          line: imp.line,
        });
      }
      continue;
    }

    // Allow npm packages (anything that looks like a package name)
    if (/^@?[a-z0-9]/.test(specifier)) {
      if (options.allowedPackages && !options.allowedPackages.has(specifier.split('/')[0])) {
        blockedImports.push({
          specifier,
          reason: `Package '${specifier}' is not in the allowed packages list`,
          line: imp.line,
        });
      }
      continue;
    }

    // Anything else is blocked
    blockedImports.push({
      specifier,
      reason: `Unrecognized import specifier: '${specifier}'`,
      line: imp.line,
    });
  }

  return {
    valid: blockedImports.length === 0,
    blockedImports,
  };
}
