/**
 * WorkerPool — Manages the lifecycle of Worker-based processes
 *
 * Responsibilities:
 * - Create Workers from Blob URL (generated from worker-template.ts)
 * - Track active Workers against maxWorkers limit
 * - Clean up: revoke Blob URLs, terminate orphaned Workers
 * - Provide fallback detection (can Workers be created?)
 */
import { getEnhancedWorkerSource } from './worker-template.js';

export interface WorkerHandle {
  pid: number;
  worker: Worker;
  controlPort: MessagePort;
  fsPort: MessagePort;
  stdioPort: MessagePort;
  state: 'initializing' | 'ready' | 'running' | 'terminated';
}

export interface WorkerPoolConfig {
  maxWorkers?: number; // default 8
}

export class WorkerPool {
  private activeWorkers = new Map<number, WorkerHandle>();
  private blobUrl: string | null = null;
  private workerSupported: boolean | null = null;
  private readonly maxWorkers: number;

  constructor(config: WorkerPoolConfig = {}) {
    this.maxWorkers = config.maxWorkers ?? 8;
  }

  /** Detect if Blob URL Workers are supported in this environment */
  async isWorkerSupported(): Promise<boolean> {
    if (this.workerSupported !== null) return this.workerSupported;

    // Node.js or environments without Worker constructor
    if (typeof Worker === 'undefined') {
      this.workerSupported = false;
      return false;
    }

    try {
      const testSource = 'self.postMessage("ok"); self.close();';
      const blob = new Blob([testSource], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      const result = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        worker.onmessage = () => {
          clearTimeout(timer);
          resolve(true);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });

      worker.terminate();
      URL.revokeObjectURL(url);
      this.workerSupported = result;
      return result;
    } catch {
      this.workerSupported = false;
      return false;
    }
  }

  /** Get or create the Worker Blob URL (shared across all Workers) */
  private getWorkerBlobUrl(): string {
    if (!this.blobUrl) {
      const source = getEnhancedWorkerSource();
      const blob = new Blob([source], { type: 'application/javascript' });
      this.blobUrl = URL.createObjectURL(blob);
    }
    return this.blobUrl;
  }

  /** Spawn a new Worker for a process */
  spawn(pid: number): WorkerHandle {
    if (this.activeWorkers.size >= this.maxWorkers) {
      throw new Error(
        `Worker pool limit reached (${this.maxWorkers}). ` +
          `Kill existing processes before spawning new ones.`,
      );
    }

    const url = this.getWorkerBlobUrl();
    const worker = new Worker(url);

    // Create MessageChannels for different concerns
    const controlChannel = new MessageChannel();
    const fsChannel = new MessageChannel();
    const stdioChannel = new MessageChannel();

    const handle: WorkerHandle = {
      pid,
      worker,
      controlPort: controlChannel.port1,
      fsPort: fsChannel.port1,
      stdioPort: stdioChannel.port1,
      state: 'initializing',
    };

    // Send init message with ports transferred to the Worker
    worker.postMessage(
      {
        type: 'init',
        pid,
        config: {
          memoryLimit: 256 * 1024 * 1024,
          stackSize: 1024 * 1024,
        },
      },
      [controlChannel.port2, fsChannel.port2, stdioChannel.port2],
    );

    this.activeWorkers.set(pid, handle);
    return handle;
  }

  /** Terminate a Worker immediately (SIGKILL) */
  terminate(pid: number): boolean {
    const handle = this.activeWorkers.get(pid);
    if (!handle) return false;

    handle.worker.terminate();
    handle.state = 'terminated';
    this.activeWorkers.delete(pid);
    return true;
  }

  /** Send graceful kill signal (SIGTERM) via control port */
  signal(pid: number, signalNum: number): boolean {
    const handle = this.activeWorkers.get(pid);
    if (!handle || handle.state !== 'running') return false;

    handle.controlPort.postMessage({ type: 'kill', signal: signalNum });
    return true;
  }

  /** Clean up a completed Worker */
  release(pid: number): void {
    const handle = this.activeWorkers.get(pid);
    if (handle) {
      handle.controlPort.close();
      handle.fsPort.close();
      handle.stdioPort.close();
      this.activeWorkers.delete(pid);
    }
  }

  /** Terminate all Workers */
  terminateAll(): void {
    for (const [pid] of this.activeWorkers) {
      this.terminate(pid);
    }
  }

  /** Clean up the shared Blob URL (call on ProcessManager dispose) */
  dispose(): void {
    this.terminateAll();
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  get activeCount(): number {
    return this.activeWorkers.size;
  }

  get limit(): number {
    return this.maxWorkers;
  }
}
