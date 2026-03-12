/**
 * Multi-mount configuration logic tests (Node)
 */
import { describe, it, expect } from 'vitest';
import { AtuaFS } from './AtuaFS.js';

describe('AtuaFS Multi-Mount (Node)', () => {
  it('should create with multi-mount config using InMemory (Node always uses InMemory)', async () => {
    const fs = await AtuaFS.create({
      name: 'multi-test',
      mounts: {
        '/': 'memory',
        '/tmp': 'memory',
      },
    });

    // Write to root
    fs.writeFileSync('/root.txt', 'root data');
    expect(fs.readFileSync('/root.txt', 'utf-8')).toBe('root data');

    // Write to /tmp
    fs.mkdirSync('/tmp', { recursive: true });
    fs.writeFileSync('/tmp/temp.txt', 'temp data');
    expect(fs.readFileSync('/tmp/temp.txt', 'utf-8')).toBe('temp data');
  });

  it('should support mount config objects', async () => {
    const fs = await AtuaFS.create({
      name: 'mount-obj-test',
      mounts: {
        '/': { backend: 'memory' },
        '/project': { backend: 'memory', persistent: true },
      },
    });

    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/file.txt', 'project data');
    expect(fs.readFileSync('/project/file.txt', 'utf-8')).toBe('project data');
  });

  it('should have watch method and destroy', async () => {
    const fs = await AtuaFS.create('watch-test');
    expect(typeof fs.watch).toBe('function');
    expect(typeof fs.destroy).toBe('function');
    fs.destroy();
  });
});
