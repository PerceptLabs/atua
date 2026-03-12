/**
 * Deno Ops Bridge — Maps Deno's op system to browser APIs
 *
 * Each op category gets a browser API backend:
 *   op_read_file  → AtuaFS (OPFS)
 *   op_write_file → AtuaFS (OPFS)
 *   op_fetch      → native fetch / CatalystNet
 *   op_crypto_*   → Web Crypto API
 *   op_timer_*    → setTimeout/setInterval
 *   op_env_*      → in-memory env map
 */

export interface OpResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface OpsBridgeConfig {
  fs?: unknown;
  net?: unknown;
  env?: Record<string, string>;
  cwd?: string;
}

export type OpHandler = (...args: unknown[]) => OpResult | Promise<OpResult>;

export class OpsBridge {
  private ops = new Map<string, OpHandler>();
  private fs: unknown;
  private net: unknown;
  private env: Record<string, string>;
  private cwd: string;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextTimerId = 1;

  constructor(config: OpsBridgeConfig = {}) {
    this.fs = config.fs;
    this.net = config.net;
    this.env = config.env ?? {};
    this.cwd = config.cwd ?? '/';
    this.registerAll();
  }

  dispatch(opName: string, ...args: unknown[]): OpResult | Promise<OpResult> {
    const handler = this.ops.get(opName);
    if (!handler) return { ok: false, error: `Unknown op: ${opName}` };
    try {
      return handler(...args);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  registeredOps(): string[] {
    return [...this.ops.keys()];
  }

  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private registerAll(): void {
    this.registerFsOps();
    this.registerCryptoOps();
    this.registerTimerOps();
    this.registerNetOps();
    this.registerEnvOps();
    this.registerProcessOps();
  }

  private registerFsOps(): void {
    const fs = this.fs as any;

    this.ops.set('op_read_file_sync', (path: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try {
        return { ok: true, value: fs.readFileSync(String(path), 'utf-8') };
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_read_file_async', async (path: unknown): Promise<OpResult> => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try {
        return { ok: true, value: await fs.readFile(String(path), 'utf-8') };
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_write_file_sync', (path: unknown, data: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try {
        fs.writeFileSync(String(path), String(data));
        return { ok: true };
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_write_file_async', async (path: unknown, data: unknown): Promise<OpResult> => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try {
        await fs.writeFile(String(path), String(data));
        return { ok: true };
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_stat_sync', (path: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try {
        const stat = fs.statSync(String(path));
        return { ok: true, value: {
          isFile: stat.isFile?.() ?? false,
          isDirectory: stat.isDirectory?.() ?? false,
          size: stat.size ?? 0,
          mtime: stat.mtimeMs ?? Date.now(),
        }};
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_mkdir_sync', (path: unknown, opts: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try { fs.mkdirSync(String(path), opts as any); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_readdir_sync', (path: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try { return { ok: true, value: fs.readdirSync(String(path)) }; }
      catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_remove_sync', (path: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try { fs.unlinkSync(String(path)); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_rename_sync', (from: unknown, to: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try { fs.renameSync(String(from), String(to)); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_exists_sync', (path: unknown): OpResult => {
      if (!fs) return { ok: false, error: 'No filesystem available' };
      try { return { ok: true, value: fs.existsSync(String(path)) }; }
      catch (err) { return { ok: false, error: String(err) }; }
    });
  }

  private registerCryptoOps(): void {
    this.ops.set('op_crypto_get_random_values', (length: unknown): OpResult => {
      try {
        const bytes = new Uint8Array(Number(length));
        crypto.getRandomValues(bytes);
        return { ok: true, value: bytes };
      } catch (err) { return { ok: false, error: String(err) }; }
    });

    this.ops.set('op_crypto_random_uuid', (): OpResult => {
      return { ok: true, value: crypto.randomUUID() };
    });

    this.ops.set('op_crypto_subtle_digest', async (algo: unknown, data: unknown): Promise<OpResult> => {
      try {
        const buf = await crypto.subtle.digest(String(algo), data as ArrayBuffer);
        return { ok: true, value: new Uint8Array(buf) };
      } catch (err) { return { ok: false, error: String(err) }; }
    });
  }

  private registerTimerOps(): void {
    this.ops.set('op_timer_start', (delay: unknown, repeat: unknown): OpResult => {
      const id = this.nextTimerId++;
      const ms = Number(delay);
      this.timers.set(id, repeat ? setInterval(() => {}, ms) : setTimeout(() => {}, ms));
      return { ok: true, value: id };
    });

    this.ops.set('op_timer_cancel', (id: unknown): OpResult => {
      const timer = this.timers.get(Number(id));
      if (timer) { clearTimeout(timer); clearInterval(timer); this.timers.delete(Number(id)); }
      return { ok: true };
    });

    this.ops.set('op_now', (): OpResult => ({ ok: true, value: performance.now() }));
  }

  private registerNetOps(): void {
    this.ops.set('op_fetch', async (url: unknown, init: unknown): Promise<OpResult> => {
      try {
        const net = this.net as any;
        if (net?.fetch) {
          return { ok: true, value: await net.fetch(String(url), init as RequestInit) };
        }
        const res = await fetch(String(url), init as RequestInit);
        return { ok: true, value: {
          ok: res.ok, status: res.status, statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()), body: await res.text(),
        }};
      } catch (err) { return { ok: false, error: String(err) }; }
    });
  }

  private registerEnvOps(): void {
    this.ops.set('op_env_get', (key: unknown): OpResult => {
      return { ok: true, value: this.env[String(key)] ?? null };
    });
    this.ops.set('op_env_set', (key: unknown, val: unknown): OpResult => {
      this.env[String(key)] = String(val); return { ok: true };
    });
    this.ops.set('op_env_delete', (key: unknown): OpResult => {
      delete this.env[String(key)]; return { ok: true };
    });
    this.ops.set('op_env_to_object', (): OpResult => {
      return { ok: true, value: { ...this.env } };
    });
    this.ops.set('op_cwd', (): OpResult => ({ ok: true, value: this.cwd }));
    this.ops.set('op_chdir', (path: unknown): OpResult => {
      this.cwd = String(path); return { ok: true };
    });
    this.ops.set('op_pid', (): OpResult => ({ ok: true, value: 1 }));
  }

  private registerProcessOps(): void {
    this.ops.set('op_spawn', async (): Promise<OpResult> => {
      return { ok: false, error: 'op_spawn requires CatalystProc (not yet wired)' };
    });
  }
}
