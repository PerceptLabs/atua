/**
 * ProcessManager — Node tests
 *
 * Tests process tree logic, signal handling state machine, stdio buffering,
 * worker template generation, StdioBatcher logic, and new Worker methods.
 */
import { describe, it, expect, vi } from 'vitest';
import { CatalystProcess, type Signal, type ProcessState } from './CatalystProcess.js';
import { getWorkerSource, getEnhancedWorkerSource, SIGNALS } from './worker-template.js';
import { StdioBatcher } from './StdioBatcher.js';

describe('CatalystProcess — State Machine', () => {
  it('should start in "starting" state', () => {
    const proc = new CatalystProcess(1);
    expect(proc.pid).toBe(1);
    expect(proc.state).toBe('starting');
    expect(proc.exitCode).toBeNull();
    expect(proc.stdout).toBe('');
    expect(proc.stderr).toBe('');
  });

  it('should transition to "exited" state', () => {
    const proc = new CatalystProcess(1);
    proc._exit(0);
    expect(proc.state).toBe('exited');
    expect(proc.exitCode).toBe(0);
  });

  it('should transition to "exited" with non-zero code', () => {
    const proc = new CatalystProcess(2);
    proc._exit(1);
    expect(proc.state).toBe('exited');
    expect(proc.exitCode).toBe(1);
  });

  it('should transition to "killed" state on SIGTERM', () => {
    const proc = new CatalystProcess(3);
    proc._setEngine({ on: () => {}, dispose: () => {} } as any);
    proc.kill('SIGTERM');
    expect(proc.state).toBe('killed');
    expect(proc.exitCode).toBe(143); // 128 + 15
  });

  it('should transition to "killed" state on SIGKILL', () => {
    const proc = new CatalystProcess(4);
    proc._setEngine({ on: () => {}, dispose: () => {} } as any);
    proc.kill('SIGKILL');
    expect(proc.state).toBe('killed');
    expect(proc.exitCode).toBe(137); // 128 + 9
  });

  it('should not allow kill on non-running process', () => {
    const proc = new CatalystProcess(5);
    proc._exit(0);
    const result = proc.kill('SIGTERM');
    expect(result).toBe(false);
    expect(proc.state).toBe('exited');
    expect(proc.exitCode).toBe(0);
  });

  it('should not exit twice', () => {
    const proc = new CatalystProcess(6);
    const exitCodes: number[] = [];
    proc.on('exit', (code: number) => exitCodes.push(code));

    proc._exit(0);
    proc._exit(1); // Should be ignored
    expect(proc.exitCode).toBe(0);
    expect(exitCodes).toEqual([0]);
  });
});

describe('CatalystProcess — Events', () => {
  it('should emit exit event', () => {
    const proc = new CatalystProcess(10);
    let exitCode: number | null = null;
    proc.on('exit', (code: number) => {
      exitCode = code;
    });
    proc._exit(42);
    expect(exitCode).toBe(42);
  });

  it('should emit exit event with signal on kill', () => {
    const proc = new CatalystProcess(11);
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    proc.on('exit', (code: number, signal?: string) => {
      exitCode = code;
      exitSignal = signal ?? null;
    });
    proc._setEngine({ on: () => {}, dispose: () => {} } as any);
    proc.kill('SIGKILL');
    expect(exitCode).toBe(137);
    expect(exitSignal).toBe('SIGKILL');
  });

  it('should support once() for one-time listeners', () => {
    const proc = new CatalystProcess(12);
    let count = 0;
    proc.once('exit', () => count++);
    proc._exit(0);
    expect(count).toBe(1);
  });

  it('should support off() to remove listeners', () => {
    const proc = new CatalystProcess(13);
    let count = 0;
    const handler = () => count++;
    proc.on('exit', handler);
    proc.off('exit', handler);
    proc._exit(0);
    expect(count).toBe(0);
  });
});

describe('CatalystProcess — Stdio Buffering', () => {
  it('should collect stdout chunks', () => {
    const proc = new CatalystProcess(20);
    const consoleHandlers: any[] = [];
    proc._setEngine({
      on: (event: string, handler: any) => {
        if (event === 'console') consoleHandlers.push(handler);
      },
      dispose: () => {},
    } as any);

    for (const handler of consoleHandlers) {
      handler('log', 'hello');
      handler('log', 'world');
    }

    expect(proc.stdout).toBe('hello\nworld\n');
    expect(proc.stderr).toBe('');
  });

  it('should collect stderr chunks', () => {
    const proc = new CatalystProcess(21);
    const consoleHandlers: any[] = [];
    proc._setEngine({
      on: (event: string, handler: any) => {
        if (event === 'console') consoleHandlers.push(handler);
      },
      dispose: () => {},
    } as any);

    for (const handler of consoleHandlers) {
      handler('error', 'oops');
    }

    expect(proc.stderr).toBe('oops\n');
    expect(proc.stdout).toBe('');
  });

  it('should stream stdout events in real-time', () => {
    const proc = new CatalystProcess(22);
    const chunks: string[] = [];
    proc.on('stdout', (data: string) => chunks.push(data));

    const consoleHandlers: any[] = [];
    proc._setEngine({
      on: (event: string, handler: any) => {
        if (event === 'console') consoleHandlers.push(handler);
      },
      dispose: () => {},
    } as any);

    for (const handler of consoleHandlers) {
      handler('log', 'chunk1');
      handler('log', 'chunk2');
    }

    expect(chunks).toEqual(['chunk1\n', 'chunk2\n']);
  });
});

describe('CatalystProcess — Worker methods', () => {
  it('_pushStdout should append to stdout', () => {
    const proc = new CatalystProcess(50);
    proc._pushStdout('line 1\n');
    proc._pushStdout('line 2\n');
    expect(proc.stdout).toBe('line 1\nline 2\n');
  });

  it('_pushStderr should append to stderr', () => {
    const proc = new CatalystProcess(51);
    proc._pushStderr('err 1\n');
    proc._pushStderr('err 2\n');
    expect(proc.stderr).toBe('err 1\nerr 2\n');
  });

  it('_pushStdout should emit stdout event', () => {
    const proc = new CatalystProcess(52);
    const chunks: string[] = [];
    proc.on('stdout', (data: string) => chunks.push(data));
    proc._pushStdout('hello\n');
    expect(chunks).toEqual(['hello\n']);
  });

  it('_pushStderr should emit stderr event', () => {
    const proc = new CatalystProcess(53);
    const chunks: string[] = [];
    proc.on('stderr', (data: string) => chunks.push(data));
    proc._pushStderr('error\n');
    expect(chunks).toEqual(['error\n']);
  });

  it('_setState should update state', () => {
    const proc = new CatalystProcess(54);
    expect(proc.state).toBe('starting');
    proc._setState('running');
    expect(proc.state).toBe('running');
  });
});

describe('CatalystProcess — Uptime', () => {
  it('should track uptime', async () => {
    const proc = new CatalystProcess(30);
    await new Promise((r) => setTimeout(r, 50));
    expect(proc.uptime).toBeGreaterThanOrEqual(40);
  });
});

describe('Worker Template', () => {
  it('should generate valid simple worker source', () => {
    const source = getWorkerSource();
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(100);
    expect(source).toContain('quickjs-emscripten');
    expect(source).toContain('self.postMessage');
    expect(source).toContain('self.addEventListener');
  });

  it('should generate valid enhanced worker source', () => {
    const source = getEnhancedWorkerSource();
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(100);
    expect(source).toContain('quickjs-emscripten');
    expect(source).toContain('stdioPort');
    expect(source).toContain('controlPort');
    expect(source).toContain('fsPort');
    expect(source).toContain('flushStdio');
    expect(source).toContain('pushStdout');
    expect(source).toContain('pushStderr');
    expect(source).toContain('BATCH_BYTES');
    expect(source).toContain('BATCH_MS');
    expect(source).toContain('stdout-batch');
    expect(source).toContain('stderr-batch');
  });

  it('should define signal numbers', () => {
    expect(SIGNALS.SIGTERM).toBe(15);
    expect(SIGNALS.SIGKILL).toBe(9);
    expect(SIGNALS.SIGINT).toBe(2);
  });
});

describe('Process States', () => {
  it('should have valid state transitions', () => {
    // starting → running (via _setEngine)
    const proc1 = new CatalystProcess(40);
    expect(proc1.state).toBe('starting');
    proc1._setEngine({ on: () => {}, dispose: () => {} } as any);
    expect(proc1.state).toBe('running');

    // running → exited (via _exit)
    const proc2 = new CatalystProcess(41);
    proc2._setEngine({ on: () => {}, dispose: () => {} } as any);
    proc2._exit(0);
    expect(proc2.state).toBe('exited');

    // running → killed (via kill)
    const proc3 = new CatalystProcess(42);
    proc3._setEngine({ on: () => {}, dispose: () => {} } as any);
    proc3.kill('SIGTERM');
    expect(proc3.state).toBe('killed');

    // starting → running (via _setState for Worker flow)
    const proc4 = new CatalystProcess(43);
    proc4._setState('running');
    expect(proc4.state).toBe('running');
  });
});

describe('StdioBatcher', () => {
  it('should batch stdout chunks', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchMs: 100 }, // long enough that timer won't fire during test
    );

    batcher.pushStdout('line 1\n');
    batcher.pushStdout('line 2\n');

    // Nothing flushed yet (under byte threshold, timer hasn't fired)
    expect(flushes).toHaveLength(0);
    expect(batcher.pendingStdoutChunks).toBe(2);

    // Explicit flush
    batcher.flush();
    expect(flushes).toHaveLength(1);
    expect(flushes[0].stream).toBe('stdout');
    expect(flushes[0].chunks).toEqual(['line 1\n', 'line 2\n']);
    expect(batcher.pendingStdoutChunks).toBe(0);
  });

  it('should batch stderr chunks', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchMs: 100 },
    );

    batcher.pushStderr('err 1\n');
    batcher.pushStderr('err 2\n');
    batcher.flush();

    expect(flushes).toHaveLength(1);
    expect(flushes[0].stream).toBe('stderr');
    expect(flushes[0].chunks).toEqual(['err 1\n', 'err 2\n']);
  });

  it('should flush on byte threshold', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchBytes: 20, batchMs: 10000 },
    );

    // Push enough data to exceed 20 bytes
    batcher.pushStdout('12345678901234567890X'); // 21 bytes
    expect(flushes).toHaveLength(1);
    expect(flushes[0].chunks).toHaveLength(1);
  });

  it('should flush on time threshold', async () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchMs: 10 },
    );

    batcher.pushStdout('hello\n');
    expect(flushes).toHaveLength(0);

    // Wait for timer
    await new Promise((r) => setTimeout(r, 30));
    expect(flushes).toHaveLength(1);
    expect(flushes[0].chunks).toEqual(['hello\n']);
  });

  it('should flush both streams on end()', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchMs: 10000 },
    );

    batcher.pushStdout('out\n');
    batcher.pushStderr('err\n');
    batcher.end();

    expect(flushes).toHaveLength(2);
    expect(flushes[0].stream).toBe('stdout');
    expect(flushes[1].stream).toBe('stderr');
  });

  it('should not lose data on rapid push + end', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchMs: 10000 },
    );

    for (let i = 0; i < 100; i++) {
      batcher.pushStdout(`line ${i}\n`);
    }
    batcher.end();

    const allChunks = flushes
      .filter((f) => f.stream === 'stdout')
      .flatMap((f) => f.chunks);
    expect(allChunks).toHaveLength(100);
    expect(allChunks[0]).toBe('line 0\n');
    expect(allChunks[99]).toBe('line 99\n');
  });

  it('should report pending bytes', () => {
    const batcher = new StdioBatcher(() => {}, { batchMs: 10000 });
    batcher.pushStdout('hello'); // 5 bytes
    batcher.pushStderr('world'); // 5 bytes
    expect(batcher.pendingBytes).toBe(10);
    batcher.flush();
    expect(batcher.pendingBytes).toBe(0);
  });

  it('should batch 200 lines into fewer flushes', () => {
    const flushes: Array<{ stream: string; chunks: string[] }> = [];
    const batcher = new StdioBatcher(
      (stream, chunks) => flushes.push({ stream, chunks }),
      { batchBytes: 4096, batchMs: 10000 },
    );

    // 200 lines of ~20 chars each ≈ 4000 bytes → should trigger ~1 byte-threshold flush
    for (let i = 0; i < 200; i++) {
      batcher.pushStdout(`test line number ${i}\n`);
    }
    batcher.end();

    const totalChunks = flushes
      .filter((f) => f.stream === 'stdout')
      .flatMap((f) => f.chunks);
    expect(totalChunks).toHaveLength(200);
    // Should have far fewer than 200 flush calls
    const stdoutFlushes = flushes.filter((f) => f.stream === 'stdout');
    expect(stdoutFlushes.length).toBeLessThan(20);
  });
});
