/**
 * wrangler-config parser — Node tests
 *
 * Tests TOML and JSONC parsing of wrangler configuration files.
 * Pure logic — no browser APIs needed.
 */
import { describe, it, expect } from 'vitest';
import { parseWranglerConfig } from './wrangler-config.js';

// =========================================================================
// TOML parsing
// =========================================================================

describe('parseWranglerConfig — TOML', () => {
  it('parses name and main', () => {
    const config = parseWranglerConfig(`
name = "my-worker"
main = "src/worker.ts"
    `);
    expect(config.name).toBe('my-worker');
    expect(config.script).toBe('src/worker.ts');
  });

  it('parses kv_namespaces', () => {
    const config = parseWranglerConfig(`
[[kv_namespaces]]
binding = "MY_KV"
id = "abc123"

[[kv_namespaces]]
binding = "CACHE"
id = "def456"
    `);
    expect(config.bindings.MY_KV).toEqual({
      type: 'kv',
      namespace: 'abc123',
    });
    expect(config.bindings.CACHE).toEqual({
      type: 'kv',
      namespace: 'def456',
    });
  });

  it('parses d1_databases', () => {
    const config = parseWranglerConfig(`
[[d1_databases]]
binding = "MY_DB"
database_name = "my-database"
database_id = "xyz789"
    `);
    expect(config.bindings.MY_DB).toEqual({
      type: 'd1',
      database: 'my-database',
    });
  });

  it('parses r2_buckets', () => {
    const config = parseWranglerConfig(`
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket"
    `);
    expect(config.bindings.MY_BUCKET).toEqual({
      type: 'r2',
      bucket: 'my-bucket',
    });
  });

  it('parses vars section', () => {
    const config = parseWranglerConfig(`
[vars]
API_KEY = "my-secret-key"
ENVIRONMENT = "development"
    `);
    expect(config.bindings.API_KEY).toEqual({
      type: 'var',
      value: 'my-secret-key',
    });
    expect(config.bindings.ENVIRONMENT).toEqual({
      type: 'var',
      value: 'development',
    });
  });

  it('parses full wrangler.toml with all binding types', () => {
    const config = parseWranglerConfig(`
name = "my-worker"
main = "src/worker.ts"

[vars]
API_KEY = "my-secret-key"
ENVIRONMENT = "development"

[[kv_namespaces]]
binding = "MY_KV"
id = "abc123"

[[d1_databases]]
binding = "MY_DB"
database_name = "my-database"
database_id = "def456"

[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket"
    `);

    expect(config.name).toBe('my-worker');
    expect(config.script).toBe('src/worker.ts');
    expect(Object.keys(config.bindings)).toHaveLength(5);
    expect(config.bindings.MY_KV.type).toBe('kv');
    expect(config.bindings.MY_DB.type).toBe('d1');
    expect(config.bindings.MY_BUCKET.type).toBe('r2');
    expect(config.bindings.API_KEY.type).toBe('var');
    expect(config.bindings.ENVIRONMENT.type).toBe('var');
  });

  it('handles comments and empty lines', () => {
    const config = parseWranglerConfig(`
# This is a comment
name = "test"

# Another comment
[vars]
KEY = "value" # inline comment
    `);
    expect(config.name).toBe('test');
    expect(config.bindings.KEY).toEqual({ type: 'var', value: 'value' });
  });

  it('parses routes as inline array', () => {
    const config = parseWranglerConfig(`
name = "test"
routes = ["/api/*", "/health"]
    `);
    expect(config.routes).toEqual(['/api/*', '/health']);
  });
});

// =========================================================================
// JSONC parsing
// =========================================================================

describe('parseWranglerConfig — JSONC', () => {
  it('parses JSONC with single-line comments', () => {
    const config = parseWranglerConfig(`{
      // Worker name
      "name": "my-worker",
      "main": "src/worker.ts",
      // KV bindings
      "kv_namespaces": [
        { "binding": "MY_KV", "id": "abc123" }
      ]
    }`);

    expect(config.name).toBe('my-worker');
    expect(config.bindings.MY_KV).toEqual({
      type: 'kv',
      namespace: 'abc123',
    });
  });

  it('parses JSONC with multi-line comments', () => {
    const config = parseWranglerConfig(`{
      "name": "test",
      /* This is a
         multi-line comment */
      "vars": {
        "KEY": "value"
      }
    }`);

    expect(config.name).toBe('test');
    expect(config.bindings.KEY).toEqual({ type: 'var', value: 'value' });
  });

  it('handles trailing commas', () => {
    const config = parseWranglerConfig(`{
      "name": "test",
      "kv_namespaces": [
        { "binding": "KV1", "id": "id1", },
      ],
    }`);

    expect(config.bindings.KV1).toEqual({ type: 'kv', namespace: 'id1' });
  });

  it('parses all binding types from JSONC', () => {
    const config = parseWranglerConfig(`{
      "name": "my-worker",
      "main": "src/worker.ts",
      "vars": {
        "API_KEY": "secret"
      },
      "kv_namespaces": [
        { "binding": "MY_KV", "id": "kv-id" }
      ],
      "d1_databases": [
        { "binding": "MY_DB", "database_name": "mydb", "database_id": "db-id" }
      ],
      "r2_buckets": [
        { "binding": "MY_BUCKET", "bucket_name": "mybucket" }
      ]
    }`);

    expect(config.name).toBe('my-worker');
    expect(config.bindings.API_KEY).toEqual({ type: 'var', value: 'secret' });
    expect(config.bindings.MY_KV).toEqual({ type: 'kv', namespace: 'kv-id' });
    expect(config.bindings.MY_DB).toEqual({ type: 'd1', database: 'mydb' });
    expect(config.bindings.MY_BUCKET).toEqual({ type: 'r2', bucket: 'mybucket' });
  });
});
