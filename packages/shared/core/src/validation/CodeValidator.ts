/**
 * CodeValidator — Orchestrates Tier 0 security checks
 *
 * Validates user code before it runs on the native engine (Tier 1).
 * Three-stage validation:
 * 1. AST check — detect dangerous patterns (eval, prototype pollution, etc.)
 * 2. Import graph — validate require/import targets
 * 3. Sandbox run — brief execution in QuickJS to catch runtime bombs
 *
 * Fast: validation should complete in under 50ms for standard code.
 */

import { checkCode, type ASTCheckResult, type ASTViolation } from './ASTChecker.js';
import { validateImports, type ImportValidationResult, type BlockedImport } from './ImportGraphValidator.js';
import { runInSandbox, type SandboxRunResult, type SandboxRunConfig } from './SandboxRunner.js';

export interface ValidationResult {
  valid: boolean;
  durationMs: number;
  ast: ASTCheckResult;
  imports: ImportValidationResult;
  sandbox?: SandboxRunResult;
  /** Human-readable summary of all violations */
  summary: string[];
}

export interface ValidatorConfig {
  /** Skip AST checks (default: false) */
  skipAST?: boolean;
  /** Skip import validation (default: false) */
  skipImports?: boolean;
  /** Skip sandbox execution (default: false) */
  skipSandbox?: boolean;
  /** Sandbox execution config */
  sandbox?: SandboxRunConfig;
  /** Allowed npm packages (if undefined, allow all) */
  allowedPackages?: Set<string>;
  /** Allow relative imports (default: true) */
  allowRelativeImports?: boolean;
}

export class CodeValidator {
  private config: ValidatorConfig;

  constructor(config: ValidatorConfig = {}) {
    this.config = config;
  }

  /**
   * Validate code through all three stages.
   * Returns immediately on first stage failure (fail-fast).
   */
  async validate(code: string): Promise<ValidationResult> {
    const start = Date.now();
    const summary: string[] = [];

    // Stage 1: AST check
    let ast: ASTCheckResult = { safe: true, violations: [] };
    if (!this.config.skipAST) {
      ast = checkCode(code);
      if (!ast.safe) {
        for (const v of ast.violations) {
          summary.push(`[AST] Line ${v.line ?? '?'}: ${v.message}`);
        }
      }
    }

    // Stage 2: Import graph validation
    let imports: ImportValidationResult = { valid: true, blockedImports: [] };
    if (!this.config.skipImports) {
      imports = validateImports(code, {
        allowedPackages: this.config.allowedPackages,
        allowRelative: this.config.allowRelativeImports ?? true,
      });
      if (!imports.valid) {
        for (const b of imports.blockedImports) {
          summary.push(`[Import] Line ${b.line ?? '?'}: ${b.reason}`);
        }
      }
    }

    // Stage 3: Sandbox execution (only if previous stages passed)
    let sandbox: SandboxRunResult | undefined;
    if (!this.config.skipSandbox && ast.safe && imports.valid) {
      sandbox = await runInSandbox(code, this.config.sandbox);
      if (!sandbox.passed) {
        summary.push(`[Sandbox] ${sandbox.error}`);
      }
    }

    const valid = ast.safe && imports.valid && (sandbox?.passed ?? true);

    return {
      valid,
      durationMs: Date.now() - start,
      ast,
      imports,
      sandbox,
      summary,
    };
  }

  /**
   * Quick validation — AST + imports only, skip sandbox.
   * For user-edited code where speed matters more than depth.
   */
  async quickValidate(code: string): Promise<ValidationResult> {
    const tempConfig = this.config;
    this.config = { ...this.config, skipSandbox: true };
    const result = await this.validate(code);
    this.config = tempConfig;
    return result;
  }
}
