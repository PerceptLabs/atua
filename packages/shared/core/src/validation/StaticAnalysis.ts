/**
 * StaticAnalysis — Lightweight code analysis replacing QuickJS sandbox validation.
 *
 * Zero-download, <1ms syntax check via new Function() + optional pattern scan.
 * Does NOT execute code. Does NOT catch infinite loops (Worker.terminate() does that).
 * Does NOT enforce security boundaries (the execution context does that).
 *
 * Replaces: SandboxRunner.ts, CodeValidator.ts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  estimatedRisk: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface PatternMatch {
  pattern: RegExp;
  warning: string;
  risk: 'medium' | 'high';
}

const SUSPICIOUS_PATTERNS: PatternMatch[] = [
  { pattern: /\beval\s*\(/, warning: 'Uses eval() — dynamic code execution', risk: 'high' },
  { pattern: /\bnew\s+Function\s*\(/, warning: 'Uses Function() constructor', risk: 'high' },
  { pattern: /__proto__/, warning: 'Accesses __proto__', risk: 'medium' },
  { pattern: /Object\s*\.\s*prototype/, warning: 'Accesses Object.prototype', risk: 'medium' },
  { pattern: /process\s*\.\s*env/, warning: 'Accesses process.env', risk: 'medium' },
  { pattern: /require\s*\(\s*['"]fs['"]/, warning: 'Requires fs module', risk: 'medium' },
  { pattern: /require\s*\(\s*['"]child_process['"]/, warning: 'Requires child_process module', risk: 'high' },
  { pattern: /require\s*\(\s*['"]net['"]/, warning: 'Requires net module', risk: 'medium' },
  { pattern: /require\s*\(\s*['"]dgram['"]/, warning: 'Requires dgram module', risk: 'medium' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze code for syntax errors and suspicious patterns.
 *
 * 1. Syntax check — fastest possible path via new Function(code)
 * 2. Pattern scan — regex-based detection of suspicious patterns (advisory)
 * 3. Risk estimation — informs routing, not blocking
 */
export function analyzeCode(code: string): AnalysisResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Syntax check
  try {
    new Function(code);
  } catch (e) {
    return {
      valid: false,
      errors: [(e as Error).message],
      warnings: [],
      estimatedRisk: 'low',
    };
  }

  // 2. Pattern scan
  let highRisk = false;
  let mediumRisk = false;

  for (const { pattern, warning, risk } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(code)) {
      warnings.push(warning);
      if (risk === 'high') highRisk = true;
      if (risk === 'medium') mediumRisk = true;
    }
  }

  // 3. Risk estimation
  const estimatedRisk = highRisk ? 'high' : mediumRisk ? 'medium' : 'low';

  return { valid: true, errors, warnings, estimatedRisk };
}
