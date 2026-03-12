/**
 * StaticAnalysis tests — syntax checking + pattern scanning
 */
import { describe, it, expect } from 'vitest';
import { analyzeCode } from './StaticAnalysis.js';

describe('analyzeCode', () => {
  describe('syntax checking', () => {
    it('should pass valid code', () => {
      const result = analyzeCode('const x = 1 + 2;');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect syntax errors', () => {
      const result = analyzeCode('const x = {;');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unexpected token');
    });

    it('should pass empty code', () => {
      const result = analyzeCode('');
      expect(result.valid).toBe(true);
    });

    it('should pass async function code', () => {
      const result = analyzeCode('async function load() { const r = await fetch("/api"); return r.json(); }');
      expect(result.valid).toBe(true);
    });
  });

  describe('pattern scanning', () => {
    it('should warn on eval()', () => {
      const result = analyzeCode('const x = eval("1+1");');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Uses eval() — dynamic code execution');
      expect(result.estimatedRisk).toBe('high');
    });

    it('should warn on new Function()', () => {
      const result = analyzeCode('const fn = new Function("return 1");');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Uses Function() constructor');
      expect(result.estimatedRisk).toBe('high');
    });

    it('should warn on __proto__ access', () => {
      const result = analyzeCode('const p = obj.__proto__;');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Accesses __proto__');
      expect(result.estimatedRisk).toBe('medium');
    });

    it('should warn on Object.prototype access', () => {
      const result = analyzeCode('Object.prototype.foo = 1;');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Accesses Object.prototype');
    });

    it('should warn on process.env access', () => {
      const result = analyzeCode('const key = process.env.API_KEY;');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Accesses process.env');
    });

    it('should warn on require("fs")', () => {
      const result = analyzeCode('const fs = require("fs");');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Requires fs module');
    });

    it('should warn on require("child_process")', () => {
      const result = analyzeCode('const cp = require("child_process");');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Requires child_process module');
      expect(result.estimatedRisk).toBe('high');
    });

    it('should return low risk for clean code', () => {
      const result = analyzeCode('function add(a, b) { return a + b; }');
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.estimatedRisk).toBe('low');
    });

    it('should collect multiple warnings', () => {
      const result = analyzeCode('eval("x"); const p = obj.__proto__;');
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.estimatedRisk).toBe('high');
    });
  });
});
