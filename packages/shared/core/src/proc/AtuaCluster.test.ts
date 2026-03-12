/**
 * AtuaCluster Tests — cluster module via Web Workers
 */
import { describe, it, expect, vi } from 'vitest';
import { AtuaCluster, getClusterModuleSource } from './AtuaCluster.js';
import { ProcessManager } from './ProcessManager.js';
import { AtuaFS } from '../fs/AtuaFS.js';

describe('AtuaCluster', () => {
  async function createCluster(exec?: string) {
    const fs = await AtuaFS.create('cluster-test');
    const pm = new ProcessManager({ fs });
    return { cluster: new AtuaCluster(pm, { exec }), pm, fs };
  }

  describe('primary/worker flags', () => {
    it('isPrimary and isMaster are true on main thread', async () => {
      const { cluster } = await createCluster();
      expect(cluster.isPrimary).toBe(true);
      expect(cluster.isMaster).toBe(true);
      expect(cluster.isWorker).toBe(false);
    });
  });

  describe('fork', () => {
    it('creates a cluster worker', async () => {
      const { cluster } = await createCluster('console.log("worker");');
      const worker = cluster.fork();
      expect(worker.id).toBe(1);
      expect(worker.process).toBeDefined();
    });

    it('assigns incrementing worker IDs', async () => {
      const { cluster } = await createCluster('console.log("w");');
      const w1 = cluster.fork();
      const w2 = cluster.fork();
      expect(w1.id).toBe(1);
      expect(w2.id).toBe(2);
    });

    it('emits fork event', async () => {
      const { cluster } = await createCluster('console.log("w");');
      const events: unknown[] = [];
      cluster.on('fork', (w: unknown) => events.push(w));
      cluster.fork();
      expect(events.length).toBe(1);
    });
  });

  describe('workers', () => {
    it('tracks workers in the workers map', async () => {
      const { cluster } = await createCluster('console.log("w");');
      cluster.fork();
      cluster.fork();
      expect(cluster.workerCount).toBe(2);
      const workers = cluster.workers;
      expect(Object.keys(workers).length).toBe(2);
    });
  });

  describe('settings', () => {
    it('returns cluster settings', async () => {
      const { cluster } = await createCluster('main.js');
      expect(cluster.settings.exec).toBe('main.js');
    });

    it('setupPrimary updates settings', async () => {
      const { cluster } = await createCluster();
      cluster.setupPrimary({ exec: 'worker.js', workers: 4 });
      expect(cluster.settings.exec).toBe('worker.js');
      expect(cluster.settings.workers).toBe(4);
    });

    it('setupMaster is alias for setupPrimary', async () => {
      const { cluster } = await createCluster();
      cluster.setupMaster({ exec: 'worker.js' });
      expect(cluster.settings.exec).toBe('worker.js');
    });
  });

  describe('disconnect', () => {
    it('kills all workers', async () => {
      const { cluster } = await createCluster('console.log("w");');
      const w1 = cluster.fork();
      const w2 = cluster.fork();

      cluster.disconnect();

      // Workers should be killed (dead)
      // The kill happens synchronously in our impl
      expect(w1.isDead()).toBe(true);
      expect(w2.isDead()).toBe(true);
    });
  });

  describe('on/off', () => {
    it('registers and removes event handlers', async () => {
      const { cluster } = await createCluster();
      const calls: string[] = [];
      const handler = () => calls.push('called');

      cluster.on('fork', handler);
      cluster.fork();
      expect(calls.length).toBe(1);

      cluster.off('fork', handler);
      cluster.fork();
      expect(calls.length).toBe(1); // handler removed
    });
  });

  describe('getClusterModuleSource', () => {
    it('returns valid JavaScript source', () => {
      const source = getClusterModuleSource();
      expect(source).toContain('module.exports');
      expect(source).toContain('isPrimary');
      expect(source).toContain('isMaster');
      expect(source).toContain('fork');
      expect(source).toContain('SCHED_RR');
    });

    it('source is evaluable', () => {
      const source = getClusterModuleSource();
      const module = { exports: {} as any };
      const fn = new Function('module', 'exports', 'require', source);
      fn(module, module.exports, () => ({}));

      expect(module.exports.isPrimary).toBe(true);
      expect(module.exports.isMaster).toBe(true);
      expect(module.exports.isWorker).toBe(false);
      expect(typeof module.exports.fork).toBe('function');
    });
  });
});
