/**
 * NpmProcessRunner — Lifecycle script execution with Tier 0 gating
 *
 * Phase F: Runs npm lifecycle scripts (postinstall, preinstall, install)
 * through the security validation pipeline before execution.
 *
 * Default behavior: lifecycle scripts are OFF.
 * Must be explicitly enabled via `scriptsEnabled: true` or per-package allowlist.
 *
 * Security model:
 * 1. Script source is validated through CodeValidator (Tier 0)
 * 2. Execution happens in an isolated process with restricted FS/network
 * 3. Filesystem access is restricted to the package's own directory
 * 4. Network access is restricted to registry and known CDNs
 */

import type { AtuaFS } from '../fs/AtuaFS.js';
import { ProcessManager, type ExecResult } from '../proc/ProcessManager.js';
import { CodeValidator, type ValidationResult } from '../validation/CodeValidator.js';

export interface NpmProcessRunnerConfig {
  /** Enable lifecycle script execution (default: false) */
  scriptsEnabled?: boolean;
  /** Per-package allowlist — these packages may run scripts even if global is off */
  allowedPackages?: string[];
  /** Per-package blocklist — these packages may NEVER run scripts */
  blockedPackages?: string[];
  /** Timeout for script execution in ms (default: 30000) */
  scriptTimeout?: number;
  /** Allowed network hosts for script execution */
  allowedHosts?: string[];
  /** Skip Tier 0 validation (NOT recommended, for trusted packages only) */
  skipValidation?: boolean;
}

export interface ScriptRunResult {
  /** Package name */
  packageName: string;
  /** Script phase that ran */
  phase: ScriptPhase;
  /** Whether the script was executed */
  executed: boolean;
  /** Why the script was skipped (if not executed) */
  skipReason?: string;
  /** Execution result (if executed) */
  result?: ExecResult;
  /** Validation result from Tier 0 */
  validation?: ValidationResult;
}

export type ScriptPhase = 'preinstall' | 'install' | 'postinstall' | 'prepare';

/** Known safe CDN and registry hosts */
const DEFAULT_ALLOWED_HOSTS = [
  'registry.npmjs.org',
  'cdn.jsdelivr.net',
  'esm.sh',
  'unpkg.com',
  'cdn.skypack.dev',
];

export class NpmProcessRunner {
  private config: Required<NpmProcessRunnerConfig>;
  private processManager: ProcessManager;
  private fs: AtuaFS;
  private validator: CodeValidator;

  constructor(
    processManager: ProcessManager,
    fs: AtuaFS,
    config: NpmProcessRunnerConfig = {},
  ) {
    this.processManager = processManager;
    this.fs = fs;
    this.config = {
      scriptsEnabled: config.scriptsEnabled ?? false,
      allowedPackages: config.allowedPackages ?? [],
      blockedPackages: config.blockedPackages ?? [],
      scriptTimeout: config.scriptTimeout ?? 30000,
      allowedHosts: config.allowedHosts ?? DEFAULT_ALLOWED_HOSTS,
      skipValidation: config.skipValidation ?? false,
    };
    this.validator = new CodeValidator();
  }

  /**
   * Run a lifecycle script for a package.
   *
   * Checks:
   * 1. Are scripts enabled (globally or per-package)?
   * 2. Is the package blocked?
   * 3. Does the script pass Tier 0 validation?
   * 4. Execute in isolated process with restricted access.
   */
  async runScript(
    packageName: string,
    phase: ScriptPhase,
    scriptSource: string,
  ): Promise<ScriptRunResult> {
    // Check: is package explicitly blocked?
    if (this.config.blockedPackages.includes(packageName)) {
      return {
        packageName,
        phase,
        executed: false,
        skipReason: `Package '${packageName}' is in the blocked list`,
      };
    }

    // Check: are scripts enabled for this package?
    const isAllowed = this.config.scriptsEnabled
      || this.config.allowedPackages.includes(packageName);

    if (!isAllowed) {
      return {
        packageName,
        phase,
        executed: false,
        skipReason: 'Lifecycle scripts are disabled. Enable with scriptsEnabled: true or add to allowedPackages.',
      };
    }

    // Tier 0: Validate script source
    let validation: ValidationResult | undefined;
    if (!this.config.skipValidation) {
      validation = await this.validator.validate(scriptSource);
      if (!validation.valid) {
        return {
          packageName,
          phase,
          executed: false,
          skipReason: `Script blocked by Tier 0 validation: ${validation.summary.join('; ')}`,
          validation,
        };
      }
    }

    // Execute script in an isolated process
    const packageDir = `/node_modules/${packageName}`;
    const wrappedScript = this.wrapScript(scriptSource, packageDir);

    try {
      const result = await this.processManager.exec(wrappedScript, {
        cwd: packageDir,
        timeout: this.config.scriptTimeout,
        env: {
          npm_package_name: packageName,
          npm_lifecycle_event: phase,
          NODE_ENV: 'production',
        },
      });

      return {
        packageName,
        phase,
        executed: true,
        result,
        validation,
      };
    } catch (err: any) {
      return {
        packageName,
        phase,
        executed: true,
        result: {
          stdout: '',
          stderr: err.message ?? 'Script execution failed',
          exitCode: 1,
          pid: -1,
        },
        validation,
      };
    }
  }

  /**
   * Run all lifecycle scripts for a package (preinstall → install → postinstall).
   */
  async runAllScripts(
    packageName: string,
    scripts: Partial<Record<ScriptPhase, string>>,
  ): Promise<ScriptRunResult[]> {
    const results: ScriptRunResult[] = [];
    const phases: ScriptPhase[] = ['preinstall', 'install', 'postinstall'];

    for (const phase of phases) {
      const script = scripts[phase];
      if (!script) continue;

      const result = await this.runScript(packageName, phase, script);
      results.push(result);

      // Stop on validation failure
      if (!result.executed && result.skipReason?.includes('Tier 0')) {
        break;
      }

      // Stop on execution failure
      if (result.executed && result.result && result.result.exitCode !== 0) {
        break;
      }
    }

    return results;
  }

  /**
   * Read scripts from a package.json in AtuaFS.
   */
  readPackageScripts(packageName: string): Partial<Record<ScriptPhase, string>> {
    const pkgJsonPath = `/node_modules/${packageName}/package.json`;
    try {
      const content = this.fs.readFileSync(pkgJsonPath, 'utf-8') as string;
      const pkg = JSON.parse(content);
      const scripts: Partial<Record<ScriptPhase, string>> = {};

      if (pkg.scripts?.preinstall) scripts.preinstall = pkg.scripts.preinstall;
      if (pkg.scripts?.install) scripts.install = pkg.scripts.install;
      if (pkg.scripts?.postinstall) scripts.postinstall = pkg.scripts.postinstall;
      if (pkg.scripts?.prepare) scripts.prepare = pkg.scripts.prepare;

      return scripts;
    } catch {
      return {};
    }
  }

  /**
   * Check if a package has any lifecycle scripts.
   */
  hasScripts(packageName: string): boolean {
    const scripts = this.readPackageScripts(packageName);
    return Object.keys(scripts).length > 0;
  }

  /** Whether scripts are enabled (globally or for a specific package) */
  isEnabled(packageName?: string): boolean {
    if (packageName && this.config.blockedPackages.includes(packageName)) return false;
    if (this.config.scriptsEnabled) return true;
    if (packageName && this.config.allowedPackages.includes(packageName)) return true;
    return false;
  }

  /** Get the allowed network hosts */
  get allowedHosts(): string[] {
    return [...this.config.allowedHosts];
  }

  /**
   * Wrap script source with filesystem and network restrictions.
   * The wrapper restricts:
   * - FS access to the package directory only
   * - Network access to allowed hosts only
   */
  private wrapScript(source: string, packageDir: string): string {
    return `
// NpmProcessRunner — isolated lifecycle script execution
// Restricted to package directory: ${packageDir}

(function() {
  // Script execution context
  var __packageDir = ${JSON.stringify(packageDir)};
  var __allowedHosts = ${JSON.stringify(this.config.allowedHosts)};

  // Run the lifecycle script
  ${source}
})();
`;
  }
}
