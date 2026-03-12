/**
 * WorkerBridge — Protocol between main thread and Worker process
 *
 * Wraps the raw MessageChannel communication into a typed, promise-based API.
 * Handles:
 * - Waiting for Worker 'ready' signal
 * - Sending 'exec' and receiving stdout/stderr/exit
 * - Forwarding CatalystFS operations
 * - Timeout enforcement
 *
 * The bridge unpacks StdioBatcher batches ('stdout-batch'/'stderr-batch')
 * and calls onStdout/onStderr per chunk for API compatibility. The batching
 * is invisible to CatalystProcess consumers.
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import type { WorkerHandle } from './WorkerPool.js';

interface FsProxyRequest {
  id: number;
  method: string;
  args: any[];
}

export class WorkerBridge {
  private readonly handle: WorkerHandle;
  private readonly fs?: CatalystFS;
  private readyPromise: Promise<void>;

  constructor(handle: WorkerHandle, fs?: CatalystFS) {
    this.handle = handle;
    this.fs = fs;

    // Wire up CatalystFS proxy on the fs MessagePort
    if (fs) {
      this.handle.fsPort.onmessage = (event: MessageEvent) => {
        this.handleFsRequest(event.data);
      };
    }

    // Wait for Worker to boot QuickJS and signal ready
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Worker boot timeout (10s)')),
        10000,
      );

      this.handle.worker.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'ready') {
          clearTimeout(timeout);
          this.handle.state = 'ready';
          resolve();
        } else if (event.data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(event.data.data));
        }
      };
    });
  }

  /** Wait for the Worker to finish booting QuickJS */
  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Execute code in the Worker, streaming stdio back via callbacks */
  exec(
    code: string,
    callbacks: {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    } = {},
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve) => {
      // Listen for stdio and exit on the stdio port
      this.handle.stdioPort.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        switch (msg.type) {
          // Batched messages from StdioBatcher (primary path)
          case 'stdout-batch':
            if (callbacks.onStdout) {
              for (const chunk of msg.chunks) callbacks.onStdout(chunk);
            }
            break;
          case 'stderr-batch':
            if (callbacks.onStderr) {
              for (const chunk of msg.chunks) callbacks.onStderr(chunk);
            }
            break;
          // Single messages (fallback compat)
          case 'stdout':
            callbacks.onStdout?.(msg.data);
            break;
          case 'stderr':
            callbacks.onStderr?.(msg.data);
            break;
          case 'exit':
            this.handle.state = 'terminated';
            resolve({ exitCode: msg.code ?? 0 });
            break;
        }
      };

      // Send exec command via control port
      this.handle.controlPort.postMessage({ type: 'exec', code });
      this.handle.state = 'running';
    });
  }

  /** Handle CatalystFS proxy requests from the Worker */
  private async handleFsRequest(request: FsProxyRequest): Promise<void> {
    if (!this.fs) {
      this.handle.fsPort.postMessage({
        id: request.id,
        error: 'No CatalystFS available',
      });
      return;
    }

    try {
      let result: any;

      switch (request.method) {
        case 'readFileSync':
          result = this.fs.readFileSync(request.args[0], request.args[1]);
          break;
        case 'writeFileSync':
          this.fs.writeFileSync(
            request.args[0],
            request.args[1],
            request.args[2],
          );
          result = undefined;
          break;
        case 'existsSync':
          result = this.fs.existsSync(request.args[0]);
          break;
        case 'mkdirSync':
          this.fs.mkdirSync(request.args[0], request.args[1]);
          result = undefined;
          break;
        case 'readdirSync':
          result = this.fs.readdirSync(request.args[0]);
          break;
        case 'statSync': {
          const stat = this.fs.statSync(request.args[0]);
          // Serialize stat to transferable form
          result = {
            size: stat.size,
            isFile: stat.isFile(),
            isDirectory: stat.isDirectory(),
            mtime: stat.mtimeMs,
          };
          break;
        }
        case 'unlinkSync':
          this.fs.unlinkSync(request.args[0]);
          result = undefined;
          break;
        default:
          throw new Error(`Unknown fs method: ${request.method}`);
      }

      this.handle.fsPort.postMessage({ id: request.id, result });
    } catch (err: any) {
      this.handle.fsPort.postMessage({
        id: request.id,
        error: err?.message ?? String(err),
      });
    }
  }
}
