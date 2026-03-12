/**
 * Unstorage driver backed by CatalystKV.
 *
 * Enables Nitro's useStorage() to read/write via CatalystKV (IndexedDB).
 * Each driver instance creates its own CatalystKV namespace.
 *
 * Usage in nitro.config.ts:
 *   import catalystKVDriver from '@aspect/nitro-preset-catalyst/storage-driver';
 *
 *   export default defineNitroConfig({
 *     storage: {
 *       data: { driver: catalystKVDriver({ namespace: 'my-app-data' }) }
 *     }
 *   })
 *
 * Or in route handlers (Nitro wires it up):
 *   const storage = useStorage('data');
 *   await storage.setItem('key', 'value');
 *   const value = await storage.getItem('key');
 */
import { CatalystKV } from '@aspect/catalyst-workers';

/** Options for the CatalystKV storage driver */
export interface CatalystKVDriverOptions {
  /** KV namespace name (default: 'nitro-data') */
  namespace?: string;
}

/**
 * Unstorage driver interface (matches unstorage's Driver type).
 * Defined inline to avoid requiring unstorage as a dependency.
 */
export interface StorageDriver {
  name: string;
  hasItem(key: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(base?: string): Promise<string[]>;
  clear(base?: string): Promise<void>;
  dispose?(): Promise<void>;
}

/**
 * Create an unstorage-compatible driver backed by CatalystKV.
 *
 * This driver can be used standalone or with Nitro's storage system.
 */
export function catalystKVDriver(
  options?: CatalystKVDriverOptions,
): StorageDriver {
  const namespace = options?.namespace ?? 'nitro-data';
  let kv: CatalystKV | null = null;

  function getKV(): CatalystKV {
    if (!kv) {
      kv = new CatalystKV(namespace);
    }
    return kv;
  }

  return {
    name: 'catalyst-kv',

    async hasItem(key: string): Promise<boolean> {
      const value = await getKV().get(key);
      return value !== null;
    },

    async getItem(key: string): Promise<string | null> {
      const value = await getKV().get(key, 'text');
      return value as string | null;
    },

    async setItem(key: string, value: string): Promise<void> {
      await getKV().put(key, value);
    },

    async removeItem(key: string): Promise<void> {
      await getKV().delete(key);
    },

    async getKeys(base?: string): Promise<string[]> {
      const result = await getKV().list({ prefix: base ?? '' });
      return result.keys.map((k) => k.name);
    },

    async clear(base?: string): Promise<void> {
      const result = await getKV().list({ prefix: base ?? '' });
      for (const k of result.keys) {
        await getKV().delete(k.name);
      }
    },

    async dispose(): Promise<void> {
      if (kv) {
        kv.destroy();
        kv = null;
      }
    },
  };
}

export default catalystKVDriver;
