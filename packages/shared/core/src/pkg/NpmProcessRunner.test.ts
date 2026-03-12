/**
 * NpmProcessRunner Tests — lifecycle scripts with Tier 0 gating
 */
import { describe, it, expect } from 'vitest';
import { NpmProcessRunner, type ScriptPhase } from './NpmProcessRunner.js';
import { ProcessManager } from '../proc/ProcessManager.js';
import { CatalystFS } from '../fs/CatalystFS.js';

async function createRunner(config: ConstructorParameters<typeof NpmProcessRunner>[2] = {}) {
  const fs = await CatalystFS.create('npm-runner-test');
  const pm = new ProcessManager(fs);
  return { runner: new NpmProcessRunner(pm, fs, config), fs, pm };
}

// Code that passes all validation stages (including bare QuickJS sandbox)
const CLEAN_CODE = 'var x = 1 + 1;';

describe('NpmProcessRunner', () => {
  describe('scripts disabled (default)', () => {
    it('skips scripts when disabled (default)', async () => {
      const { runner } = await createRunner();
      const result = await runner.runScript('some-pkg', 'postinstall', CLEAN_CODE);
      expect(result.executed).toBe(false);
      expect(result.skipReason).toContain('disabled');
    });

    it('isEnabled returns false by default', async () => {
      const { runner } = await createRunner();
      expect(runner.isEnabled()).toBe(false);
      expect(runner.isEnabled('some-pkg')).toBe(false);
    });
  });

  describe('scripts enabled globally', () => {
    it('runs scripts when enabled', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      const result = await runner.runScript('some-pkg', 'postinstall', CLEAN_CODE);
      expect(result.executed).toBe(true);
      expect(result.packageName).toBe('some-pkg');
      expect(result.phase).toBe('postinstall');
    });

    it('isEnabled returns true when globally enabled', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      expect(runner.isEnabled()).toBe(true);
    });
  });

  describe('per-package allowlist', () => {
    it('runs scripts for allowed packages only', async () => {
      const { runner } = await createRunner({
        allowedPackages: ['trusted-pkg'],
      });

      // Allowed package runs
      const result1 = await runner.runScript('trusted-pkg', 'postinstall', CLEAN_CODE);
      expect(result1.executed).toBe(true);

      // Non-allowed package skipped
      const result2 = await runner.runScript('untrusted-pkg', 'postinstall', CLEAN_CODE);
      expect(result2.executed).toBe(false);
    });

    it('isEnabled returns true for allowed package', async () => {
      const { runner } = await createRunner({ allowedPackages: ['trusted-pkg'] });
      expect(runner.isEnabled('trusted-pkg')).toBe(true);
      expect(runner.isEnabled('other-pkg')).toBe(false);
    });
  });

  describe('per-package blocklist', () => {
    it('blocks scripts from blocked packages even when enabled globally', async () => {
      const { runner } = await createRunner({
        scriptsEnabled: true,
        blockedPackages: ['evil-pkg'],
      });

      const result = await runner.runScript('evil-pkg', 'postinstall', CLEAN_CODE);
      expect(result.executed).toBe(false);
      expect(result.skipReason).toContain('blocked');
    });

    it('isEnabled returns false for blocked package', async () => {
      const { runner } = await createRunner({
        scriptsEnabled: true,
        blockedPackages: ['evil-pkg'],
      });
      expect(runner.isEnabled('evil-pkg')).toBe(false);
    });
  });

  describe('Tier 0 validation', () => {
    it('blocks scripts that fail validation', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      // eval() is flagged by CodeValidator AST checker
      const result = await runner.runScript('pkg', 'postinstall', 'eval("evil code");');
      expect(result.executed).toBe(false);
      expect(result.skipReason).toContain('Tier 0 validation');
      expect(result.validation).toBeDefined();
      expect(result.validation!.valid).toBe(false);
    });

    it('passes clean scripts through validation', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      const result = await runner.runScript('pkg', 'postinstall', CLEAN_CODE);
      expect(result.executed).toBe(true);
      expect(result.validation).toBeDefined();
      expect(result.validation!.valid).toBe(true);
    });

    it('skipValidation bypasses Tier 0', async () => {
      const { runner } = await createRunner({
        scriptsEnabled: true,
        skipValidation: true,
      });
      // Would normally be blocked but skipValidation is true
      const result = await runner.runScript('pkg', 'postinstall', 'eval("1+1");');
      expect(result.executed).toBe(true);
      expect(result.validation).toBeUndefined();
    });
  });

  describe('runAllScripts', () => {
    it('runs preinstall -> install -> postinstall in order', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      const results = await runner.runAllScripts('pkg', {
        preinstall: 'var a = 1;',
        install: 'var b = 2;',
        postinstall: 'var c = 3;',
      });

      expect(results.length).toBe(3);
      expect(results[0].phase).toBe('preinstall');
      expect(results[1].phase).toBe('install');
      expect(results[2].phase).toBe('postinstall');
    });

    it('skips phases without scripts', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      const results = await runner.runAllScripts('pkg', {
        postinstall: CLEAN_CODE,
      });

      expect(results.length).toBe(1);
      expect(results[0].phase).toBe('postinstall');
    });

    it('stops on failure when validation fails', async () => {
      const { runner } = await createRunner({ scriptsEnabled: true });
      const results = await runner.runAllScripts('pkg', {
        preinstall: 'eval("bad");', // Fails validation
        postinstall: CLEAN_CODE,
      });

      // preinstall fails validation (not executed), postinstall never runs
      expect(results.length).toBe(1);
      expect(results[0].phase).toBe('preinstall');
      expect(results[0].executed).toBe(false);
    });
  });

  describe('readPackageScripts', () => {
    it('reads scripts from package.json', async () => {
      const { runner, fs } = await createRunner();
      fs.mkdirSync('/node_modules/test-pkg', { recursive: true });
      fs.writeFileSync('/node_modules/test-pkg/package.json', JSON.stringify({
        name: 'test-pkg',
        scripts: {
          postinstall: 'node postinstall.js',
          build: 'tsc', // non-lifecycle — not returned
        },
      }));

      const scripts = runner.readPackageScripts('test-pkg');
      expect(scripts.postinstall).toBe('node postinstall.js');
      expect((scripts as any).build).toBeUndefined(); // not a lifecycle script
    });

    it('returns empty for packages without scripts', async () => {
      const { runner, fs } = await createRunner();
      fs.mkdirSync('/node_modules/clean-pkg', { recursive: true });
      fs.writeFileSync('/node_modules/clean-pkg/package.json', JSON.stringify({
        name: 'clean-pkg',
      }));

      const scripts = runner.readPackageScripts('clean-pkg');
      expect(Object.keys(scripts).length).toBe(0);
    });

    it('returns empty for missing package', async () => {
      const { runner } = await createRunner();
      const scripts = runner.readPackageScripts('nonexistent');
      expect(Object.keys(scripts).length).toBe(0);
    });
  });

  describe('hasScripts', () => {
    it('returns true when package has lifecycle scripts', async () => {
      const { runner, fs } = await createRunner();
      fs.mkdirSync('/node_modules/pkg-with-scripts', { recursive: true });
      fs.writeFileSync('/node_modules/pkg-with-scripts/package.json', JSON.stringify({
        scripts: { postinstall: 'echo done' },
      }));

      expect(runner.hasScripts('pkg-with-scripts')).toBe(true);
    });

    it('returns false when no lifecycle scripts', async () => {
      const { runner, fs } = await createRunner();
      fs.mkdirSync('/node_modules/clean', { recursive: true });
      fs.writeFileSync('/node_modules/clean/package.json', JSON.stringify({
        scripts: { build: 'tsc', test: 'vitest' },
      }));

      expect(runner.hasScripts('clean')).toBe(false);
    });
  });

  describe('allowedHosts', () => {
    it('has default allowed hosts', async () => {
      const { runner } = await createRunner();
      expect(runner.allowedHosts).toContain('registry.npmjs.org');
      expect(runner.allowedHosts).toContain('cdn.jsdelivr.net');
    });

    it('accepts custom allowed hosts', async () => {
      const { runner } = await createRunner({
        allowedHosts: ['custom-registry.example.com'],
      });
      expect(runner.allowedHosts).toContain('custom-registry.example.com');
      expect(runner.allowedHosts).not.toContain('registry.npmjs.org');
    });
  });
});
