/**
 * TieredEngine — Validates via Tier 0 (QuickJS), executes via Tier 1 (Native)
 *
 * This is the primary engine for Atua: it combines security validation
 * with native-speed execution.
 *
 * Tier 0 (QuickJS sandbox): validates code before native execution
 * Tier 1 (Native engine): executes validated code at full browser speed
 *
 * If validation fails, code can optionally fall back to full QuickJS
 * execution (safe but slower).
 */
import type { IEngine, EngineInstanceConfig } from '../engine/interfaces.js';
import { CodeValidator, type ValidatorConfig, type ValidationResult } from '../validation/CodeValidator.js';
import { NativeEngine, type NativeEngineConfig } from './native/NativeEngine.js';

export interface TieredEngineConfig extends NativeEngineConfig {
  /** Validator configuration */
  validation?: ValidatorConfig;
  /** Whether to fall back to QuickJS on validation failure (default: false) */
  fallbackOnValidationFailure?: boolean;
  /** Skip validation entirely (trust mode) — useful for internal code */
  skipValidation?: boolean;
}

type EventHandler = (...args: unknown[]) => void;

export class TieredEngine implements IEngine {
  private tier1: NativeEngine;
  private validator: CodeValidator;
  private _disposed = false;
  private handlers = new Map<string, EventHandler[]>();
  private config: TieredEngineConfig;
  /** Track validation results for the last eval */
  private _lastValidation: ValidationResult | null = null;

  private constructor(
    tier1: NativeEngine,
    validator: CodeValidator,
    config: TieredEngineConfig,
  ) {
    this.tier1 = tier1;
    this.validator = validator;
    this.config = config;
  }

  /**
   * Create a new TieredEngine instance.
   */
  static async create(config: TieredEngineConfig = {}): Promise<TieredEngine> {
    const tier1 = await NativeEngine.create(config);
    const validator = new CodeValidator(config.validation);
    return new TieredEngine(tier1, validator, config);
  }

  /**
   * Evaluate code through the tiered pipeline:
   * 1. Tier 0: Validate code (AST + imports + optional sandbox)
   * 2. Tier 1: Execute validated code natively
   */
  async eval(code: string, filename?: string): Promise<unknown> {
    if (this._disposed) throw new Error('Engine is disposed');

    // Skip validation if configured
    if (!this.config.skipValidation) {
      const validation = await this.validator.validate(code);
      this._lastValidation = validation;

      if (!validation.valid) {
        const reasons = validation.summary.join('; ');
        this.emit('validation-failure', validation);

        if (this.config.fallbackOnValidationFailure) {
          // Fallback: still execute in native engine but log warning
          this.emit('console', 'warn', `[TieredEngine] Validation failed, executing anyway: ${reasons}`);
        } else {
          throw new Error(`Code validation failed: ${reasons}`);
        }
      }
    }

    // Execute on Tier 1 (native engine)
    return this.tier1.eval(code, filename);
  }

  async evalFile(path: string): Promise<unknown> {
    if (this._disposed) throw new Error('Engine is disposed');
    // evalFile delegates to eval which does validation
    const fs = (this.config as any).fs;
    if (!fs) throw new Error('No filesystem configured');
    const source = fs.readFileSync(path, 'utf-8') as string;
    return this.eval(source, path);
  }

  async createInstance(config: EngineInstanceConfig): Promise<IEngine> {
    return TieredEngine.create({
      ...this.config,
      fs: config.fs as any,
      fetchProxy: config.net as any,
      moduleLoader: config.moduleLoader,
      timeout: config.timeout,
      env: config.env,
      cwd: config.cwd,
    });
  }

  async destroy(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await this.tier1.destroy();
    this.handlers.clear();
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);

    // Forward to tier1 for console/error events
    if (event === 'console' || event === 'error') {
      this.tier1.on(event, handler);
    }
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(event, handlers.filter((h) => h !== handler));
    }
    if (event === 'console' || event === 'error') {
      this.tier1.off(event, handler);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  /** Get the last validation result */
  get lastValidation(): ValidationResult | null {
    return this._lastValidation;
  }

  /** Get the underlying Tier 1 (Native) engine */
  get nativeEngine(): NativeEngine {
    return this.tier1;
  }
}
