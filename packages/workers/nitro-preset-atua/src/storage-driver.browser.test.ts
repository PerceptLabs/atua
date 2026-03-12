/**
 * AtuaKV Storage Driver — Browser tests
 *
 * Tests the unstorage-compatible driver backed by AtuaKV.
 * Runs in Chromium via Vitest browser mode using real IndexedDB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { atuaKVDriver, type StorageDriver } from './storage-driver.js';

let driver: StorageDriver;
let counter = 0;

beforeEach(() => {
  driver = atuaKVDriver({
    namespace: `storage-test-${Date.now()}-${counter++}`,
  });
});

afterEach(async () => {
  if (driver.dispose) await driver.dispose();
});

describe('atuaKVDriver — Basic Operations', () => {
  it('setItem and getItem round-trip', async () => {
    await driver.setItem('key1', 'value1');
    const result = await driver.getItem('key1');
    expect(result).toBe('value1');
  });

  it('getItem returns null for missing key', async () => {
    const result = await driver.getItem('nonexistent');
    expect(result).toBeNull();
  });

  it('hasItem returns true for existing key', async () => {
    await driver.setItem('exists', 'yes');
    expect(await driver.hasItem('exists')).toBe(true);
  });

  it('hasItem returns false for missing key', async () => {
    expect(await driver.hasItem('missing')).toBe(false);
  });

  it('removeItem deletes a key', async () => {
    await driver.setItem('to-delete', 'value');
    await driver.removeItem('to-delete');
    const result = await driver.getItem('to-delete');
    expect(result).toBeNull();
  });

  it('setItem overwrites existing value', async () => {
    await driver.setItem('key', 'v1');
    await driver.setItem('key', 'v2');
    expect(await driver.getItem('key')).toBe('v2');
  });
});

describe('atuaKVDriver — Keys and Clear', () => {
  it('getKeys returns all keys', async () => {
    await driver.setItem('a', '1');
    await driver.setItem('b', '2');
    await driver.setItem('c', '3');

    const keys = await driver.getKeys();
    expect(keys.sort()).toEqual(['a', 'b', 'c']);
  });

  it('getKeys with base prefix', async () => {
    await driver.setItem('users:alice', '1');
    await driver.setItem('users:bob', '2');
    await driver.setItem('posts:1', '3');

    const keys = await driver.getKeys('users:');
    expect(keys.sort()).toEqual(['users:alice', 'users:bob']);
  });

  it('clear removes all keys', async () => {
    await driver.setItem('x', '1');
    await driver.setItem('y', '2');
    await driver.clear();

    const keys = await driver.getKeys();
    expect(keys).toHaveLength(0);
  });

  it('clear with base prefix only removes matching keys', async () => {
    await driver.setItem('keep:a', '1');
    await driver.setItem('delete:b', '2');
    await driver.setItem('delete:c', '3');

    await driver.clear('delete:');

    const keys = await driver.getKeys();
    expect(keys).toEqual(['keep:a']);
  });
});

describe('atuaKVDriver — JSON Values', () => {
  it('stores and retrieves JSON as string', async () => {
    const data = JSON.stringify({ name: 'Alice', age: 30 });
    await driver.setItem('user', data);
    const result = await driver.getItem('user');
    expect(JSON.parse(result!)).toEqual({ name: 'Alice', age: 30 });
  });
});
