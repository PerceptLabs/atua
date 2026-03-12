/**
 * ExecutionContext — Unified interface for all execution environments.
 *
 * Replaces the old IEngine + TieredEngine model. Three implementations:
 * - WorkerContext: V8 Worker + Worker.terminate() for timeout
 * - InlineContext: Same-thread eval via new Function() + with() proxy
 * - AtuaBoxContext: v86 Linux sandbox (future)
 *
 * The agent and ContextRouter decide which context to use based on
 * trust level and code requirements.
 */

// ---------------------------------------------------------------------------
// Execution options
// ---------------------------------------------------------------------------

export interface EvalOpts {
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
  /** Host functions callable from inside the execution context */
  functions?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

export interface SpawnOpts {
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  /** Stream stdout/stderr as they arrive */
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ExecResult {
  value: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ProcessResult extends ExecResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Context status
// ---------------------------------------------------------------------------

export type ContextStatus =
  | { state: 'idle' }
  | { state: 'executing'; startedAt: number }
  | { state: 'destroyed' };

// ---------------------------------------------------------------------------
// ExecutionContext interface
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  /** Execute JavaScript code, return result */
  eval(code: string, opts?: EvalOpts): Promise<ExecResult>;

  /** Spawn a command (node, npx, shell, etc.) */
  spawn(command: string, args?: string[], opts?: SpawnOpts): Promise<ProcessResult>;

  /** Hard-kill the execution environment */
  destroy(): Promise<void>;

  /** Current status */
  status(): ContextStatus;
}
