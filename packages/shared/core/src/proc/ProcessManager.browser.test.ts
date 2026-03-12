/**
 * ProcessManager — Browser tests
 * Tests process execution, isolation, stdio streaming, and signal handling
 * in real Chromium via Vitest browser mode.
 */
import { describe, it, expect } from 'vitest';
import { ProcessManager } from './ProcessManager.js';
import { AtuaFS } from '../fs/AtuaFS.js';

describe('ProcessManager — exec()', () => {
  it('should exec code and return stdout', async () => {
    const pm = new ProcessManager();
    const result = await pm.exec('console.log("hello from child")');

    expect(result.stdout).toContain('hello from child');
    expect(result.exitCode).toBe(0);
    expect(result.pid).toBeGreaterThan(0);
  });

  it('should capture multiple console.log outputs', async () => {
    const pm = new ProcessManager();
    const result = await pm.exec('console.log("line1"); console.log("line2"); console.log("line3")');

    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
    expect(result.stdout).toContain('line3');
    expect(result.exitCode).toBe(0);
  });

  it('should capture stderr from console.error', async () => {
    const pm = new ProcessManager();
    const result = await pm.exec('console.error("error output")');

    expect(result.stderr).toContain('error output');
    expect(result.exitCode).toBe(0);
  });

  it('should return exit code 1 on error', async () => {
    const pm = new ProcessManager();
    const result = await pm.exec('throw new Error("crash")');

    expect(result.exitCode).toBe(1);
  });

  it('should return exit code 0 for successful code', async () => {
    const pm = new ProcessManager();
    const result = await pm.exec('var x = 1 + 1');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('ProcessManager — spawn() + streaming', () => {
  it('should spawn a process and stream stdout', async () => {
    const pm = new ProcessManager();
    const proc = pm.spawn('console.log("chunk1"); console.log("chunk2")');

    const chunks: string[] = [];
    proc.on('stdout', (data: string) => chunks.push(data));

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(proc.stdout).toContain('chunk1');
    expect(proc.stdout).toContain('chunk2');
  });

  it('should report exit code via event', async () => {
    const pm = new ProcessManager();
    const proc = pm.spawn('console.log("done")');

    const exitCode = await new Promise<number>((resolve) => {
      proc.on('exit', (code: number) => resolve(code));
    });

    expect(exitCode).toBe(0);
  });

  it('should report error exit code', async () => {
    const pm = new ProcessManager();
    const proc = pm.spawn('undefinedVar.prop');

    const exitCode = await new Promise<number>((resolve) => {
      proc.on('exit', (code: number) => resolve(code));
    });

    expect(exitCode).toBe(1);
  });
});

describe('ProcessManager — Process Isolation', () => {
  it('should isolate variables between processes', async () => {
    const pm = new ProcessManager();

    // Process 1: set a global variable
    const result1 = await pm.exec('globalThis.myVar = 42; console.log("set")');
    expect(result1.stdout).toContain('set');

    // Process 2: try to access the variable — should not exist
    const result2 = await pm.exec('console.log(typeof globalThis.myVar)');
    expect(result2.stdout).toContain('undefined');
  });

  it('should assign unique PIDs', async () => {
    const pm = new ProcessManager();
    const proc1 = pm.spawn('console.log("a")');
    const proc2 = pm.spawn('console.log("b")');

    expect(proc1.pid).not.toBe(proc2.pid);

    // Wait for both to finish
    await Promise.all([
      new Promise((r) => proc1.on('exit', r)),
      new Promise((r) => proc2.on('exit', r)),
    ]);
  });
});

describe('ProcessManager — kill()', () => {
  it('kill(SIGTERM) should terminate gracefully', async () => {
    const pm = new ProcessManager();
    // Spawn a process — kill immediately before async engine boot starts
    const proc = pm.spawn('var i = 0; while(i < 1000000) { i++; }');

    // Kill immediately (process is in 'starting' state, before async eval)
    const killed = pm.kill(proc.pid, 'SIGTERM');
    expect(killed).toBe(true);

    // Wait for exit
    await new Promise<void>((resolve) => {
      if (proc.state === 'killed' || proc.state === 'exited') {
        resolve();
      } else {
        proc.on('exit', () => resolve());
      }
    });

    expect(proc.state).toBe('killed');
    expect(proc.exitCode).toBe(143); // 128 + 15
  });

  it('kill(SIGKILL) should terminate immediately', async () => {
    const pm = new ProcessManager();
    const proc = pm.spawn('var i = 0; while(i < 1000000) { i++; }');

    // Kill immediately
    pm.kill(proc.pid, 'SIGKILL');

    await new Promise<void>((resolve) => {
      if (proc.state === 'killed' || proc.state === 'exited') {
        resolve();
      } else {
        proc.on('exit', () => resolve());
      }
    });

    expect(proc.state).toBe('killed');
    expect(proc.exitCode).toBe(137); // 128 + 9
  });

  it('should return false for non-existent PID', () => {
    const pm = new ProcessManager();
    expect(pm.kill(999)).toBe(false);
  });
});

describe('ProcessManager — AtuaFS Access', () => {
  it('should give child processes AtuaFS access', async () => {
    const fs = await AtuaFS.create({
      name: 'proc-fs-test-' + Date.now(),
      mounts: { '/': 'memory' },
    });

    // Write a file from the parent
    fs.writeFileSync('/shared.txt', 'hello from parent');

    const pm = new ProcessManager({ fs });

    // Child process reads the file
    const result = await pm.exec(`
      var fs = require("fs");
      var content = fs.readFileSync("/shared.txt", "utf-8");
      console.log(content);
    `);

    expect(result.stdout).toContain('hello from parent');
    expect(result.exitCode).toBe(0);
  });

  it('should allow child to write files visible to parent', async () => {
    const fs = await AtuaFS.create({
      name: 'proc-fs-write-' + Date.now(),
      mounts: { '/': 'memory' },
    });

    const pm = new ProcessManager({ fs });

    await pm.exec(`
      var fs = require("fs");
      fs.writeFileSync("/child-output.txt", "written by child");
    `);

    // Parent reads the file written by child
    const content = fs.readFileSync('/child-output.txt', 'utf-8');
    expect(content).toBe('written by child');
  });
});

describe('ProcessManager — Process List', () => {
  it('should track running processes', async () => {
    const pm = new ProcessManager();
    const proc = pm.spawn('console.log("test")');

    expect(pm.processCount).toBeGreaterThanOrEqual(1);
    expect(pm.getProcess(proc.pid)).toBe(proc);

    // Wait for exit
    await new Promise((r) => proc.on('exit', r));
  });

  it('should list all processes', async () => {
    const pm = new ProcessManager();
    const proc1 = pm.spawn('console.log("a")');
    const proc2 = pm.spawn('console.log("b")');

    const all = pm.listProcesses();
    expect(all.length).toBeGreaterThanOrEqual(2);

    await Promise.all([
      new Promise((r) => proc1.on('exit', r)),
      new Promise((r) => proc2.on('exit', r)),
    ]);
  });

  it('killAll() should terminate all running processes', async () => {
    const pm = new ProcessManager();
    const proc1 = pm.spawn('var i = 0; while(i < 1000000) i++;');
    const proc2 = pm.spawn('var i = 0; while(i < 1000000) i++;');

    await new Promise((r) => setTimeout(r, 50));
    pm.killAll('SIGKILL');

    await Promise.all([
      new Promise<void>((r) => {
        if (proc1.state !== 'running') r();
        else proc1.on('exit', () => r());
      }),
      new Promise<void>((r) => {
        if (proc2.state !== 'running') r();
        else proc2.on('exit', () => r());
      }),
    ]);

    expect(pm.runningCount).toBe(0);
  });
});
