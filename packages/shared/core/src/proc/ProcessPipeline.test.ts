/**
 * ProcessPipeline Tests — stdio piping between processes
 */
import { describe, it, expect } from 'vitest';
import { AtuaProcess } from './AtuaProcess.js';
import { pipeProcesses, pipeToFile, pipeFromFile, teeProcess, collectOutput, collectErrors } from './ProcessPipeline.js';
import { AtuaFS } from '../fs/AtuaFS.js';

function createMockProcess(pid: number): AtuaProcess {
  const proc = new AtuaProcess(pid);
  proc._setState('running');
  return proc;
}

describe('ProcessPipeline', () => {
  describe('pipeProcesses', () => {
    it('pipes stdout from source to stdin of destination', () => {
      const source = createMockProcess(1);
      const dest = createMockProcess(2);

      const received: string[] = [];
      dest.on('stdin', (data: string) => received.push(data));

      pipeProcesses(source, dest);

      source._pushStdout('hello ');
      source._pushStdout('world');

      expect(received).toEqual(['hello ', 'world']);
    });

    it('handles multiple chunks', () => {
      const source = createMockProcess(1);
      const dest = createMockProcess(2);

      const received: string[] = [];
      dest.on('stdin', (data: string) => received.push(data));

      pipeProcesses(source, dest);

      for (let i = 0; i < 5; i++) {
        source._pushStdout(`chunk${i}\n`);
      }

      expect(received.length).toBe(5);
    });
  });

  describe('pipeToFile', () => {
    it('writes stdout to a file in AtuaFS', async () => {
      const fs = await AtuaFS.create('pipe-test');
      const source = createMockProcess(1);

      pipeToFile(source, fs, '/output.txt');

      source._pushStdout('line 1\n');
      source._pushStdout('line 2\n');

      const content = fs.readFileSync('/output.txt', 'utf-8') as string;
      expect(content).toBe('line 1\nline 2\n');

      fs.destroy();
    });
  });

  describe('pipeFromFile', () => {
    it('reads file content and writes to process stdin', async () => {
      const fs = await AtuaFS.create('pipe-from-test');
      fs.writeFileSync('/input.txt', 'file content');

      const dest = createMockProcess(2);
      const received: string[] = [];
      dest.on('stdin', (data: string) => received.push(data));

      pipeFromFile(fs, '/input.txt', dest);

      expect(received).toEqual(['file content']);
      fs.destroy();
    });
  });

  describe('teeProcess', () => {
    it('sends stdout to multiple destinations', () => {
      const source = createMockProcess(1);
      const dest1 = createMockProcess(2);
      const dest2 = createMockProcess(3);

      const r1: string[] = [];
      const r2: string[] = [];
      dest1.on('stdin', (d: string) => r1.push(d));
      dest2.on('stdin', (d: string) => r2.push(d));

      teeProcess(source, [dest1, dest2]);
      source._pushStdout('broadcast');

      expect(r1).toEqual(['broadcast']);
      expect(r2).toEqual(['broadcast']);
    });
  });

  describe('collectOutput', () => {
    it('collects all stdout into a string', async () => {
      const proc = createMockProcess(1);
      const promise = collectOutput(proc);

      proc._pushStdout('hello ');
      proc._pushStdout('world');
      proc._exit(0);

      const result = await promise;
      expect(result).toBe('hello world');
    });
  });

  describe('collectErrors', () => {
    it('collects all stderr into a string', async () => {
      const proc = createMockProcess(1);
      const promise = collectErrors(proc);

      proc._pushStderr('error 1\n');
      proc._pushStderr('error 2\n');
      proc._exit(1);

      const result = await promise;
      expect(result).toBe('error 1\nerror 2\n');
    });
  });
});
