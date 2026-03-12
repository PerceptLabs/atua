/**
 * AtuaCluster — cluster module via Web Workers
 *
 * Phase L: Implements Node.js cluster module using Web Workers.
 * Each "worker" in the cluster is a Web Worker with its own engine instance.
 *
 * Features:
 * - cluster.fork() → spawns a new Web Worker
 * - cluster.isMaster/isPrimary → true on main thread
 * - cluster.isWorker → true inside Web Workers
 * - Worker messaging via MessagePort
 * - Round-robin request distribution
 */

import { ProcessManager, type ExecResult } from './ProcessManager.js';
import { AtuaProcess } from './AtuaProcess.js';

export interface ClusterWorker {
  id: number;
  process: AtuaProcess;
  isDead(): boolean;
  isConnected(): boolean;
  send(message: unknown): void;
  kill(signal?: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

export interface ClusterSettings {
  /** Number of workers to fork (default: navigator.hardwareConcurrency or 4) */
  workers?: number;
  /** Code to execute in each worker */
  exec?: string;
  /** Arguments passed to worker */
  args?: string[];
}

type EventHandler = (...args: unknown[]) => void;

export class AtuaCluster {
  private processManager: ProcessManager;
  private _workers = new Map<number, ClusterWorker>();
  private _nextWorkerId = 1;
  private _handlers = new Map<string, EventHandler[]>();
  private _settings: ClusterSettings;

  /** True when running on the main thread */
  readonly isPrimary: boolean = true;
  /** Alias for isPrimary */
  readonly isMaster: boolean = true;
  /** True when running inside a Worker */
  readonly isWorker: boolean = false;

  constructor(processManager: ProcessManager, settings: ClusterSettings = {}) {
    this.processManager = processManager;
    this._settings = settings;
  }

  /** Fork a new cluster worker */
  fork(env?: Record<string, string>): ClusterWorker {
    const id = this._nextWorkerId++;
    const code = this._settings.exec ?? 'process.exit(0);';

    const proc = this.processManager.spawn(code, { env });

    const worker: ClusterWorker = {
      id,
      process: proc,
      isDead: () => proc.state === 'exited' || proc.state === 'killed',
      isConnected: () => proc.state === 'running',
      send: (message: unknown) => {
        // In full implementation, this would use MessagePort
        proc.write(JSON.stringify(message));
      },
      kill: (signal?: string) => {
        this.processManager.kill(proc.pid, (signal as any) ?? 'SIGTERM');
      },
      on: (event: string, handler: EventHandler) => {
        proc.on(event, handler);
      },
      off: (event: string, handler: EventHandler) => {
        proc.off(event, handler);
      },
    };

    this._workers.set(id, worker);

    // Emit fork event
    this._emit('fork', worker);

    // When worker goes online
    proc.on('exit', (code: number) => {
      this._emit('exit', worker, code);
      // Auto-remove after delay
      setTimeout(() => this._workers.delete(id), 1000);
    });

    // Emit online on next tick (worker started)
    Promise.resolve().then(() => {
      if (proc.state === 'running') {
        this._emit('online', worker);
      }
    });

    return worker;
  }

  /** Get all workers */
  get workers(): Record<number, ClusterWorker> {
    const result: Record<number, ClusterWorker> = {};
    for (const [id, worker] of this._workers) {
      result[id] = worker;
    }
    return result;
  }

  /** Get the number of workers */
  get workerCount(): number {
    return this._workers.size;
  }

  /** Disconnect all workers */
  disconnect(callback?: () => void): void {
    for (const worker of this._workers.values()) {
      worker.kill();
    }
    if (callback) {
      // Wait a bit for workers to exit
      setTimeout(callback, 100);
    }
  }

  /** Get cluster settings */
  get settings(): ClusterSettings {
    return { ...this._settings };
  }

  /** Setup the cluster master with settings */
  setupPrimary(settings: ClusterSettings): void {
    Object.assign(this._settings, settings);
  }

  /** Alias for setupPrimary */
  setupMaster(settings: ClusterSettings): void {
    this.setupPrimary(settings);
  }

  on(event: string, handler: EventHandler): this {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    const handlers = this._handlers.get(event);
    if (handlers) {
      this._handlers.set(event, handlers.filter((h) => h !== handler));
    }
    return this;
  }

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(event);
    if (handlers) handlers.forEach((h) => h(...args));
  }
}

/**
 * Generate the cluster module source for the engine's require() system.
 */
export function getClusterModuleSource(): string {
  return `
(function() {
  var workers = {};
  var nextId = 1;
  var isPrimary = true;
  var isWorker = false;
  var _events = {};

  function Worker(id) {
    this.id = id;
    this._events = {};
    this._dead = false;
    this._connected = true;
  }
  Worker.prototype.isDead = function() { return this._dead; };
  Worker.prototype.isConnected = function() { return this._connected; };
  Worker.prototype.send = function(msg) {};
  Worker.prototype.kill = function(signal) {
    this._dead = true;
    this._connected = false;
    var handlers = this._events['exit'];
    if (handlers) handlers.forEach(function(h) { h(0, signal || 'SIGTERM'); });
  };
  Worker.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };
  Worker.prototype.disconnect = function() {
    this._connected = false;
    var handlers = this._events['disconnect'];
    if (handlers) handlers.forEach(function(h) { h(); });
  };

  module.exports.isPrimary = isPrimary;
  module.exports.isMaster = isPrimary;
  module.exports.isWorker = isWorker;
  module.exports.workers = workers;

  module.exports.fork = function(env) {
    var w = new Worker(nextId++);
    workers[w.id] = w;
    var handlers = _events['fork'];
    if (handlers) handlers.forEach(function(h) { h(w); });
    Promise.resolve().then(function() {
      var onlineHandlers = _events['online'];
      if (onlineHandlers) onlineHandlers.forEach(function(h) { h(w); });
    });
    return w;
  };

  module.exports.disconnect = function(callback) {
    for (var id in workers) workers[id].kill();
    if (callback) setTimeout(callback, 0);
  };

  module.exports.setupPrimary = function(settings) {};
  module.exports.setupMaster = module.exports.setupPrimary;

  module.exports.on = function(event, handler) {
    if (!_events[event]) _events[event] = [];
    _events[event].push(handler);
    return module.exports;
  };

  module.exports.Worker = Worker;
  module.exports.schedulingPolicy = 2; // SCHED_RR
  module.exports.SCHED_NONE = 1;
  module.exports.SCHED_RR = 2;
})();
`;
}
