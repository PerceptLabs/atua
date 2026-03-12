/**
 * WorkersComplianceGate Tests — Cloudflare Workers compliance checking
 */
import { describe, it, expect } from 'vitest';
import { WorkersComplianceGate } from './WorkersComplianceGate.js';

describe('WorkersComplianceGate', () => {
  const gate = new WorkersComplianceGate();

  describe('compliant code', () => {
    it('passes clean fetch-based code', () => {
      const result = gate.check(`
        export default {
          async fetch(request) {
            return new Response('Hello World');
          }
        };
      `);
      expect(result.compliant).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.tier).toBe('workers');
    });

    it('passes code using Web APIs', () => {
      const result = gate.check(`
        const cache = caches.default;
        const url = new URL('https://example.com');
        const response = await fetch(url);
      `);
      expect(result.compliant).toBe(true);
    });
  });

  describe('blocked APIs', () => {
    it('detects fs usage', () => {
      const result = gate.check(`const fs = require('fs');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'fs')).toBe(true);
    });

    it('detects child_process usage', () => {
      const result = gate.check(`const cp = require('child_process');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'child_process')).toBe(true);
    });

    it('detects cluster usage', () => {
      const result = gate.check(`const cluster = require('cluster');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'cluster')).toBe(true);
    });

    it('detects dgram usage', () => {
      const result = gate.check(`const dgram = require('dgram');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'dgram')).toBe(true);
    });

    it('detects worker_threads usage', () => {
      const result = gate.check(`const { Worker } = require('worker_threads');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'worker_threads')).toBe(true);
    });

    it('detects vm usage', () => {
      const result = gate.check(`const vm = require('vm');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'vm')).toBe(true);
    });
  });

  describe('forbidden patterns', () => {
    it('detects eval()', () => {
      const result = gate.check(`const x = eval('1+1');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'eval')).toBe(true);
    });

    it('detects new Function()', () => {
      const result = gate.check(`const fn = new Function('return 1');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'Function')).toBe(true);
    });

    it('detects window usage', () => {
      const result = gate.check(`const w = window.innerWidth;`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'window')).toBe(true);
    });

    it('detects document usage', () => {
      const result = gate.check(`const el = document.getElementById('app');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'document')).toBe(true);
    });

    it('detects localStorage usage', () => {
      const result = gate.check(`localStorage.setItem('key', 'val');`);
      expect(result.compliant).toBe(false);
      expect(result.errors.some((e) => e.type === 'localStorage')).toBe(true);
    });

    it('skips patterns in comments', () => {
      const result = gate.check(`
        // eval('test') is not used
        /* document.getElementById('app') */
        const x = 1;
      `);
      // Comments are skipped for forbidden patterns
      expect(result.errors.filter((e) => e.type === 'eval').length).toBe(0);
    });

    it('includes line numbers for forbidden patterns', () => {
      const result = gate.check(`const a = 1;\nconst b = eval('2');`);
      const evalErr = result.errors.find((e) => e.type === 'eval');
      expect(evalErr).toBeDefined();
      expect(evalErr!.line).toBe(2);
    });
  });

  describe('warning patterns', () => {
    it('warns about net module', () => {
      const result = gate.check(`const net = require('net');`);
      expect(result.warnings.some((w) => w.type === 'net')).toBe(true);
    });

    it('warns about process.env', () => {
      const result = gate.check(`const key = process.env.API_KEY;`);
      expect(result.warnings.some((w) => w.type === 'process.env')).toBe(true);
    });

    it('warns about setTimeout', () => {
      const result = gate.check(`setTimeout(() => {}, 1000);`);
      expect(result.warnings.some((w) => w.type === 'setTimeout')).toBe(true);
    });
  });

  describe('tier assignment', () => {
    it('assigns workers tier for compliant code', () => {
      const result = gate.check(`export default { fetch() { return new Response('ok'); } };`);
      expect(result.tier).toBe('workers');
    });

    it('assigns full tier for non-compliant code', () => {
      const result = gate.check(`const fs = require('fs');`);
      expect(result.tier).toBe('full');
    });
  });

  describe('generateReport', () => {
    it('generates PASS report for compliant code', () => {
      const result = gate.check(`const x = 1;`);
      const report = gate.generateReport(result);
      expect(report).toContain('PASS');
      expect(report).toContain('workers');
    });

    it('generates FAIL report with errors', () => {
      const result = gate.check(`const fs = require('fs'); eval('x');`);
      const report = gate.generateReport(result);
      expect(report).toContain('FAIL');
      expect(report).toContain('Errors');
    });

    it('includes warnings in report', () => {
      const result = gate.check(`setTimeout(() => {}, 100);`);
      const report = gate.generateReport(result);
      expect(report).toContain('Warnings');
    });
  });
});
