/**
 * CodeValidator Tests — Tier 0 security gate
 */
import { describe, it, expect } from 'vitest';
import { CodeValidator } from './CodeValidator.js';
import { checkCode } from './ASTChecker.js';
import { validateImports } from './ImportGraphValidator.js';
import { runInSandbox } from './SandboxRunner.js';

describe('ASTChecker', () => {
  it('detects eval() usage', () => {
    const result = checkCode('var x = eval("dangerous");');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'eval')).toBe(true);
  });

  it('detects Function constructor', () => {
    const result = checkCode('var fn = new Function("return this");');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'function-constructor')).toBe(true);
  });

  it('detects __proto__ pollution', () => {
    const result = checkCode('obj.__proto__.polluted = true;');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'prototype-pollution')).toBe(true);
  });

  it('detects constructor.constructor pollution', () => {
    const result = checkCode('obj.constructor["constructor"]("return this")();');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'prototype-pollution')).toBe(true);
  });

  it('detects window global access', () => {
    const result = checkCode('var x = window.location;');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'browser-global')).toBe(true);
  });

  it('detects document global access', () => {
    const result = checkCode('document.cookie = "stolen";');
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.type === 'browser-global')).toBe(true);
  });

  it('passes clean Express app code', () => {
    const code = `
      const express = require('express');
      const app = express();
      app.get('/', (req, res) => res.send('Hello'));
      app.listen(3000);
    `;
    const result = checkCode(code);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes clean code with no suspicious patterns', () => {
    const code = `
      var path = require('path');
      var result = path.join('a', 'b', 'c');
      console.log(result);
      module.exports = result;
    `;
    const result = checkCode(code);
    expect(result.safe).toBe(true);
  });

  it('ignores eval in comments', () => {
    const code = `
      // eval("this is a comment");
      var x = 1 + 1;
    `;
    const result = checkCode(code);
    expect(result.safe).toBe(true);
  });

  it('ignores eval in string literals', () => {
    const code = `
      var msg = "don't use eval()";
      console.log(msg);
    `;
    const result = checkCode(code);
    expect(result.safe).toBe(true);
  });
});

describe('ImportGraphValidator', () => {
  it('allows Node.js builtins', () => {
    const code = `
      const fs = require('fs');
      const path = require('path');
      const crypto = require('crypto');
    `;
    const result = validateImports(code);
    expect(result.valid).toBe(true);
  });

  it('allows node: prefixed builtins', () => {
    const code = `const path = require('node:path');`;
    const result = validateImports(code);
    expect(result.valid).toBe(true);
  });

  it('blocks filesystem traversal', () => {
    const code = `require('/etc/passwd');`;
    const result = validateImports(code);
    expect(result.valid).toBe(false);
    expect(result.blockedImports.length).toBeGreaterThan(0);
  });

  it('blocks null byte injection', () => {
    // Construct code with actual null byte in the specifier
    const result = validateImports('require("fs' + '\x00' + 'exploit")');
    expect(result.valid).toBe(false);
  });

  it('allows relative imports by default', () => {
    const code = `require('./myModule');`;
    const result = validateImports(code);
    expect(result.valid).toBe(true);
  });

  it('allows npm packages', () => {
    const code = `
      const express = require('express');
      const lodash = require('lodash');
    `;
    const result = validateImports(code);
    expect(result.valid).toBe(true);
  });

  it('blocks unknown URL imports', () => {
    const code = `import x from 'https://evil.com/malware.js';`;
    const result = validateImports(code);
    expect(result.valid).toBe(false);
  });

  it('allows esm.sh CDN imports', () => {
    const code = `import lodash from 'https://esm.sh/lodash';`;
    const result = validateImports(code);
    expect(result.valid).toBe(true);
  });
});

describe('SandboxRunner', () => {
  it('passes clean code', async () => {
    const result = await runInSandbox('var x = 1 + 2;');
    expect(result.passed).toBe(true);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('detects infinite loops (CPU timeout)', async () => {
    const result = await runInSandbox('while(true) {}', { timeout: 50 });
    expect(result.passed).toBe(false);
    expect(result.timeoutExceeded).toBe(true);
  });

  it('detects syntax errors', async () => {
    const result = await runInSandbox('function {');
    expect(result.passed).toBe(false);
  });

  it('passes standard code quickly', async () => {
    const code = `
      var arr = [];
      for (var i = 0; i < 100; i++) arr.push(i);
      var sum = arr.reduce(function(a, b) { return a + b; }, 0);
    `;
    const result = await runInSandbox(code);
    expect(result.passed).toBe(true);
    expect(result.durationMs).toBeLessThan(5000);
  });
});

describe('CodeValidator — Full pipeline', () => {
  it('blocks malicious eval code', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const result = await validator.validate('eval("dangerous");');
    expect(result.valid).toBe(false);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('blocks Function constructor', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const result = await validator.validate('new Function("return this")()');
    expect(result.valid).toBe(false);
  });

  it('blocks __proto__ pollution', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const result = await validator.validate('obj.__proto__.isAdmin = true;');
    expect(result.valid).toBe(false);
  });

  it('passes clean Express app', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const code = `
      const express = require('express');
      const app = express();
      app.get('/', function(req, res) { res.send('Hello'); });
      app.listen(3000);
    `;
    const result = await validator.validate(code);
    expect(result.valid).toBe(true);
  });

  it('passes import validation for clean code', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const code = `
      const path = require('path');
      const result = path.join('a', 'b');
    `;
    const result = await validator.validate(code);
    expect(result.valid).toBe(true);
    expect(result.imports.valid).toBe(true);
  });

  it('blocks /etc/passwd import', async () => {
    const validator = new CodeValidator({ skipSandbox: true });
    const result = await validator.validate('require("/etc/passwd");');
    expect(result.valid).toBe(false);
  });

  it('quickValidate skips sandbox', async () => {
    const validator = new CodeValidator();
    const result = await validator.quickValidate('var x = 1 + 1;');
    expect(result.valid).toBe(true);
    expect(result.sandbox).toBeUndefined();
  });

  it('full validation with sandbox', async () => {
    const validator = new CodeValidator();
    const result = await validator.validate('var x = 1 + 1;');
    expect(result.valid).toBe(true);
    expect(result.sandbox).toBeDefined();
    expect(result.sandbox!.passed).toBe(true);
  });

  it('full validation catches infinite loop', async () => {
    const validator = new CodeValidator({
      skipAST: true,
      skipImports: true,
      sandbox: { timeout: 50 },
    });
    const result = await validator.validate('while(true) {}');
    expect(result.valid).toBe(false);
    expect(result.sandbox?.timeoutExceeded).toBe(true);
  });
});
