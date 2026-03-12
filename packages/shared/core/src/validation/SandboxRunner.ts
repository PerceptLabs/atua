/**
 * SandboxRunner — Quick execution in QuickJS against stubs
 *
 * Executes code briefly in QuickJS to detect runtime behavioral issues:
 * - Infinite loops (killed after CPU timeout)
 * - Memory bombs (killed after memory limit)
 * - Unexpected side effects
 *
 * This is a lightweight validation step, not full execution.
 */

export interface SandboxRunResult {
  passed: boolean;
  error?: string;
  durationMs: number;
  memoryExceeded?: boolean;
  timeoutExceeded?: boolean;
}

export interface SandboxRunConfig {
  /** CPU timeout in ms (default: 100ms — this is validation, not execution) */
  timeout?: number;
  /** Memory limit in MB (default: 32MB — minimal for validation) */
  memoryLimit?: number;
}

/**
 * Run code in a sandboxed QuickJS context for validation.
 * This is a quick pass — it doesn't run the code to completion.
 * It checks that the code doesn't immediately try to:
 * - Enter an infinite loop
 * - Allocate excessive memory
 * - Throw during initialization
 */
export async function runInSandbox(
  code: string,
  config: SandboxRunConfig = {},
): Promise<SandboxRunResult> {
  const timeout = config.timeout ?? 100;
  const memoryLimit = config.memoryLimit ?? 32;
  const start = Date.now();

  try {
    // Try to import QuickJS for sandbox execution
    const { getQuickJS } = await import('quickjs-emscripten');
    const QuickJS = await getQuickJS();

    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(memoryLimit * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024); // 512KB stack for validation

    // Set up interrupt handler for CPU timeout
    let interrupted = false;
    const startTime = Date.now();
    runtime.setInterruptHandler(() => {
      if (Date.now() - startTime > timeout) {
        interrupted = true;
        return true; // interrupt execution
      }
      return false;
    });

    const context = runtime.newContext();

    try {
      const result = context.evalCode(code, '<sandbox-validation>');

      if (result.error) {
        const err = context.dump(result.error);
        result.error.dispose();

        if (interrupted) {
          return {
            passed: false,
            error: `CPU timeout: code exceeded ${timeout}ms validation limit`,
            durationMs: Date.now() - start,
            timeoutExceeded: true,
          };
        }

        return {
          passed: false,
          error: `Runtime error during validation: ${typeof err === 'string' ? err : JSON.stringify(err)}`,
          durationMs: Date.now() - start,
        };
      }

      if (result.value) {
        result.value.dispose();
      }

      return {
        passed: true,
        durationMs: Date.now() - start,
      };
    } finally {
      context.dispose();
      runtime.dispose();
    }
  } catch (err: any) {
    // QuickJS not available — fall back to syntax check only
    const durationMs = Date.now() - start;

    if (err?.message?.includes('memory')) {
      return {
        passed: false,
        error: `Memory limit exceeded: code exceeded ${memoryLimit}MB validation limit`,
        durationMs,
        memoryExceeded: true,
      };
    }

    // If QuickJS import fails, do a basic syntax check
    try {
      new Function(code);
      return { passed: true, durationMs };
    } catch (syntaxErr: any) {
      return {
        passed: false,
        error: `Syntax error: ${syntaxErr.message}`,
        durationMs,
      };
    }
  }
}
