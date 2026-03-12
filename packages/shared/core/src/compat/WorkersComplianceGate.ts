/**
 * WorkersComplianceGate — Cloudflare Workers compatibility checker
 *
 * Phase E: Validates that code is compatible with Cloudflare Workers
 * constraints before deployment.
 *
 * Workers restrictions:
 * - No file system access
 * - No child_process/cluster
 * - No raw TCP/UDP sockets
 * - Limited globals (no window, document)
 * - CPU time limits (10ms for free, 50ms paid)
 * - Memory limits (128MB)
 * - No eval() or Function() constructor
 * - Must use ES modules
 */

export interface ComplianceResult {
  compliant: boolean;
  errors: ComplianceError[];
  warnings: ComplianceWarning[];
  tier: 'workers' | 'full';
}

export interface ComplianceError {
  type: string;
  message: string;
  line?: number;
  severity: 'error';
}

export interface ComplianceWarning {
  type: string;
  message: string;
  line?: number;
  severity: 'warning';
}

/** APIs not available in Cloudflare Workers */
const BLOCKED_APIS = [
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/g, api: 'fs', message: 'File system access is not available in Workers' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/g, api: 'child_process', message: 'Child process spawning is not available in Workers' },
  { pattern: /require\s*\(\s*['"]cluster['"]\s*\)/g, api: 'cluster', message: 'Cluster module is not available in Workers' },
  { pattern: /require\s*\(\s*['"]dgram['"]\s*\)/g, api: 'dgram', message: 'UDP sockets are not available in Workers' },
  { pattern: /require\s*\(\s*['"]worker_threads['"]\s*\)/g, api: 'worker_threads', message: 'Worker threads are not available in Workers' },
  { pattern: /require\s*\(\s*['"]vm['"]\s*\)/g, api: 'vm', message: 'VM module is not available in Workers' },
  { pattern: /require\s*\(\s*['"]v8['"]\s*\)/g, api: 'v8', message: 'V8 module is not available in Workers' },
];

/** Patterns that trigger warnings (may work with polyfills) */
const WARNING_PATTERNS = [
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/g, api: 'net', message: 'TCP requires Workers TCP connect() API' },
  { pattern: /require\s*\(\s*['"]tls['"]\s*\)/g, api: 'tls', message: 'TLS requires Workers TCP connect() with TLS' },
  { pattern: /require\s*\(\s*['"]dns['"]\s*\)/g, api: 'dns', message: 'DNS requires DoH — consider using fetch-based resolution' },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/g, api: 'http', message: 'HTTP server uses Workers fetch handler instead of http.createServer()' },
  { pattern: /process\.env\b/g, api: 'process.env', message: 'Use Workers environment bindings instead of process.env' },
  { pattern: /setTimeout\s*\(/g, api: 'setTimeout', message: 'setTimeout may not work as expected in Workers (short CPU limits)' },
];

/** Dangerous patterns that are strictly forbidden */
const FORBIDDEN_PATTERNS = [
  { pattern: /\beval\s*\(/g, api: 'eval', message: 'eval() is not allowed in Workers' },
  { pattern: /\bnew\s+Function\s*\(/g, api: 'Function', message: 'new Function() is not allowed in Workers' },
  { pattern: /\bwindow\b/g, api: 'window', message: 'window global does not exist in Workers' },
  { pattern: /\bdocument\b/g, api: 'document', message: 'document global does not exist in Workers' },
  { pattern: /\blocalStorage\b/g, api: 'localStorage', message: 'localStorage is not available in Workers — use KV or DO' },
  { pattern: /\bsessionStorage\b/g, api: 'sessionStorage', message: 'sessionStorage is not available in Workers' },
];

export class WorkersComplianceGate {
  /**
   * Check code for Workers compliance.
   */
  check(code: string): ComplianceResult {
    const errors: ComplianceError[] = [];
    const warnings: ComplianceWarning[] = [];

    // Check blocked APIs
    for (const rule of BLOCKED_APIS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(code)) {
        errors.push({
          type: rule.api,
          message: rule.message,
          severity: 'error',
        });
      }
    }

    // Check forbidden patterns
    for (const rule of FORBIDDEN_PATTERNS) {
      rule.pattern.lastIndex = 0;
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(lines[i])) {
          // Skip if in comment or string
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

          errors.push({
            type: rule.api,
            message: rule.message,
            line: i + 1,
            severity: 'error',
          });
          break; // Only report once per pattern
        }
      }
    }

    // Check warning patterns
    for (const rule of WARNING_PATTERNS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(code)) {
        warnings.push({
          type: rule.api,
          message: rule.message,
          severity: 'warning',
        });
      }
    }

    const compliant = errors.length === 0;

    return {
      compliant,
      errors,
      warnings,
      tier: compliant ? 'workers' : 'full',
    };
  }

  /**
   * Generate a human-readable compliance report.
   */
  generateReport(result: ComplianceResult): string {
    const lines: string[] = [];

    lines.push(`Workers Compliance: ${result.compliant ? 'PASS' : 'FAIL'}`);
    lines.push(`Target Tier: ${result.tier}`);
    lines.push('');

    if (result.errors.length > 0) {
      lines.push(`Errors (${result.errors.length}):`);
      for (const err of result.errors) {
        const loc = err.line ? ` (line ${err.line})` : '';
        lines.push(`  [${err.type}] ${err.message}${loc}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push(`Warnings (${result.warnings.length}):`);
      for (const warn of result.warnings) {
        lines.push(`  [${warn.type}] ${warn.message}`);
      }
    }

    return lines.join('\n');
  }
}
