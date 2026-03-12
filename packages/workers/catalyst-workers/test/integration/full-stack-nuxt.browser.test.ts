/**
 * Full-Stack Nuxt Integration — Browser tests
 *
 * End-to-end validation of a Nuxt todo app demonstrating D1 (CRUD),
 * KV (sessions), and R2 (file uploads) all running entirely in the browser.
 * Uses a hand-crafted fixture simulating Nuxt/Nitro output.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalystWorkers } from '../../src/runtime.js';
import { CatalystKV } from '../../src/bindings/kv.js';
import { CatalystR2 } from '../../src/bindings/r2.js';
import { CatalystD1 } from '@aspect/catalyst-workers-d1';
import type { WorkerModule } from '../../src/runtime.js';

import * as nuxtBundle from '../fixtures/nuxt-fullstack/.output/server/index.mjs';

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

let runtime: CatalystWorkers | null = null;
let db: CatalystD1 | null = null;
let kv: CatalystKV | null = null;
let r2: CatalystR2 | null = null;

beforeEach(async () => {
  const ns = crypto.randomUUID();
  db = new CatalystD1(`nuxt-db-${ns}`);
  kv = new CatalystKV(`nuxt-kv-${ns}`);
  r2 = new CatalystR2(`nuxt-r2-${ns}`);

  // Initialize the todos table (fresh DB per test, no stale data)
  await db.exec('CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, completed INTEGER DEFAULT 0)');

  runtime = await CatalystWorkers.create({
    workers: {
      nuxt: {
        module: nuxtBundle as unknown as WorkerModule,
        bindings: {
          MY_DB: { type: 'd1', instance: db },
          SESSION_KV: { type: 'kv', instance: kv },
          UPLOADS: { type: 'r2', instance: r2 },
          APP_NAME: { type: 'var', value: 'Nuxt Todo App' },
        },
        routes: ['/**'],
      },
    },
  });
});

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
  if (db) {
    await db.destroy();
    db = null;
  }
  if (kv) {
    kv.destroy();
    kv = null;
  }
  if (r2) {
    r2.destroy();
    r2 = null;
  }
});

describe('Nuxt Full-Stack — D1 CRUD', () => {
  it('create todo (POST → D1 insert)', async () => {
    const response = await runtime!.fetch(
      req('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Buy groceries', completed: false }),
      }),
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(201);

    const data = await response!.json();
    expect(data.title).toBe('Buy groceries');
    expect(data.completed).toBe(false);
    expect(data.id).toBeDefined();
  });

  it('list todos (GET → D1 select)', async () => {
    // Insert two todos
    await runtime!.fetch(
      req('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Task 1', completed: false }),
      }),
    );
    await runtime!.fetch(
      req('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Task 2', completed: true }),
      }),
    );

    // List all
    const response = await runtime!.fetch(req('/api/todos'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const todos = await response!.json();
    expect(todos).toHaveLength(2);
    expect(todos[0].title).toBe('Task 1');
    expect(todos[1].title).toBe('Task 2');
  });

  it('update todo (PUT → D1 update)', async () => {
    // Create a todo
    const createRes = await runtime!.fetch(
      req('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Original', completed: false }),
      }),
    );
    const created = await createRes!.json();

    // Update it
    const updateRes = await runtime!.fetch(
      req('/api/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: created.id, title: 'Updated', completed: true }),
      }),
    );
    expect(updateRes!.status).toBe(200);

    // Verify via list
    const listRes = await runtime!.fetch(req('/api/todos'));
    const todos = await listRes!.json();
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('Updated');
    expect(todos[0].completed).toBe(1);
  });

  it('delete todo (DELETE → D1 delete)', async () => {
    // Create a todo
    const createRes = await runtime!.fetch(
      req('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'To delete', completed: false }),
      }),
    );
    const created = await createRes!.json();

    // Delete it
    const deleteRes = await runtime!.fetch(
      req(`/api/todos?id=${created.id}`, { method: 'DELETE' }),
    );
    expect(deleteRes!.status).toBe(200);
    const deleteData = await deleteRes!.json();
    expect(deleteData.deleted).toBe(true);

    // Verify empty
    const listRes = await runtime!.fetch(req('/api/todos'));
    const todos = await listRes!.json();
    expect(todos).toHaveLength(0);
  });
});

describe('Nuxt Full-Stack — KV Sessions', () => {
  it('session persistence (KV set → KV get)', async () => {
    // Store a session value
    const storeRes = await runtime!.fetch(
      req('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user-123', value: 'authenticated' }),
      }),
    );
    expect(storeRes!.status).toBe(201);

    // Read it back
    const readRes = await runtime!.fetch(req('/api/session?key=user-123'));
    expect(readRes!.status).toBe(200);

    const data = await readRes!.json();
    expect(data.key).toBe('user-123');
    expect(data.value).toBe('authenticated');
  });
});

describe('Nuxt Full-Stack — R2 Uploads', () => {
  it('file upload (POST → R2 put → GET → R2 get)', async () => {
    // Upload a file
    const uploadRes = await runtime!.fetch(
      req('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'docs/readme.txt', data: 'Hello from R2!' }),
      }),
    );
    expect(uploadRes!.status).toBe(201);
    const uploadData = await uploadRes!.json();
    expect(uploadData.uploaded).toBe(true);

    // Download the file
    const downloadRes = await runtime!.fetch(
      req('/api/upload?key=docs/readme.txt'),
    );
    expect(downloadRes!.status).toBe(200);

    const downloadData = await downloadRes!.json();
    expect(downloadData.key).toBe('docs/readme.txt');
    expect(downloadData.data).toBe('Hello from R2!');
  });
});
