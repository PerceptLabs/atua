/**
 * atua.d1 MCP Provider tests (browser-only — wa-sqlite requires IndexedDB)
 *
 * Uses real AtuaD1 instance. All tools called through the hub.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaD1Provider } from './atua-d1-provider.js';
import { AtuaD1 } from '../../../../workers/atua-workers-d1/src/d1.js';

describe('atua.d1 Provider', () => {
  let hub: MCPHub;
  let d1: AtuaD1;

  beforeEach(async () => {
    hub = new MCPHub();
    d1 = new AtuaD1(`test-fabric-d1-${Date.now()}`);
    hub.registerProvider(createAtuaD1Provider(d1));
  });

  afterEach(async () => {
    await d1.destroy();
  });

  describe('DDL operations', () => {
    it('should create a table via exec', async () => {
      const result = await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)',
      });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).count).toBeDefined();
    });
  });

  describe('DML operations', () => {
    beforeEach(async () => {
      await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)',
      });
    });

    it('should insert with params via execute', async () => {
      const result = await hub.callTool('atua.d1.execute', {
        sql: 'INSERT INTO t (name) VALUES (?)',
        params: ['test'],
      });
      expect(result.isError).toBeUndefined();
      const meta = (result.content as any).meta;
      expect(meta.changes).toBe(1);
    });

    it('should query and return rows', async () => {
      await hub.callTool('atua.d1.execute', {
        sql: 'INSERT INTO t (name) VALUES (?)',
        params: ['alice'],
      });
      await hub.callTool('atua.d1.execute', {
        sql: 'INSERT INTO t (name) VALUES (?)',
        params: ['bob'],
      });

      const result = await hub.callTool('atua.d1.query', {
        sql: 'SELECT * FROM t ORDER BY id',
      });
      expect(result.isError).toBeUndefined();
      const { results } = result.content as any;
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('alice');
      expect(results[1].name).toBe('bob');
    });
  });

  describe('batch operations', () => {
    it('should execute multiple statements atomically', async () => {
      await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)',
      });

      const result = await hub.callTool('atua.d1.batch', {
        statements: [
          { sql: 'INSERT INTO t (name) VALUES (?)', params: ['a'] },
          { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
          { sql: 'INSERT INTO t (name) VALUES (?)', params: ['c'] },
        ],
      });
      expect(result.isError).toBeUndefined();

      const query = await hub.callTool('atua.d1.query', { sql: 'SELECT * FROM t' });
      const { results } = query.content as any;
      expect(results).toHaveLength(3);
    });
  });

  describe('tables listing', () => {
    it('should list tables with schema', async () => {
      await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)',
      });
      await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER)',
      });

      const result = await hub.callTool('atua.d1.tables', {});
      expect(result.isError).toBeUndefined();
      const tables = result.content as Array<{ name: string; sql: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('users');
      expect(names).toContain('posts');
    });
  });

  describe('error handling', () => {
    it('should return structured error for invalid SQL', async () => {
      const result = await hub.callTool('atua.d1.query', {
        sql: 'INVALID SQL STATEMENT',
      });
      expect(result.isError).toBe(true);
      expect(typeof result.content).toBe('string');
    });
  });

  describe('transaction logging', () => {
    it('should log all D1 calls', async () => {
      await hub.callTool('atua.d1.exec', {
        sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY)',
      }, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.d1' });
      expect(log).toHaveLength(1);
      expect(log[0].tool).toBe('atua.d1.exec');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
