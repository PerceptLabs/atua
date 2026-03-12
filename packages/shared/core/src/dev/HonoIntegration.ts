/**
 * HonoIntegration — Backend API routes via real Hono in Service Worker
 *
 * Detects if /src/api/ directory exists, builds it to /dist/api-sw.js (IIFE format),
 * and enables API route handling in the preview Service Worker.
 *
 * Phase 13b: Replaced the toy ~125-line mini-router with pre-bundled real Hono.
 * All Hono middleware, routing, error boundaries, and the full Context API
 * now work in the Service Worker.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import type { BuildPipeline, Transpiler } from './BuildPipeline.js';
import { HONO_CORE_BUNDLE, HONO_CORS_BUNDLE, HONO_PACKAGE_JSON } from './hono-bundle.js';

export interface HonoIntegrationConfig {
  /** Source directory for API routes (default: /src/api) */
  apiDir?: string;
  /** Entry point within apiDir (default: index.ts or index.js) */
  entryPoint?: string;
  /** Output path for the built API bundle (default: /dist/api-sw.js) */
  outputPath?: string;
}

export interface HonoBuildResult {
  /** Whether API routes were detected and built */
  hasApi: boolean;
  /** Path to built API bundle (null if no API) */
  outputPath: string | null;
  /** Build errors */
  errors: string[];
}

export class HonoIntegration {
  private readonly fs: AtuaFS;
  private readonly pipeline: BuildPipeline;
  private readonly apiDir: string;
  private readonly entryPoint: string;
  private readonly outputPath: string;

  constructor(
    fs: AtuaFS,
    pipeline: BuildPipeline,
    config: HonoIntegrationConfig = {},
  ) {
    this.fs = fs;
    this.pipeline = pipeline;
    this.apiDir = config.apiDir ?? '/src/api';
    this.entryPoint = config.entryPoint ?? 'index';
    this.outputPath = config.outputPath ?? '/dist/api-sw.js';
  }

  /**
   * Detect if API routes exist.
   */
  hasApiRoutes(): boolean {
    const extensions = ['.ts', '.js', '.tsx', '.jsx'];
    for (const ext of extensions) {
      const path = `${this.apiDir}/${this.entryPoint}${ext}`;
      if (this.fs.existsSync(path)) return true;
    }
    return false;
  }

  /**
   * Find the API entry point file.
   */
  findEntryPoint(): string | null {
    const extensions = ['.ts', '.js', '.tsx', '.jsx'];
    for (const ext of extensions) {
      const path = `${this.apiDir}/${this.entryPoint}${ext}`;
      if (this.fs.existsSync(path)) return path;
    }
    return null;
  }

  /**
   * Build API routes to IIFE format for Service Worker.
   * Uses pre-bundled real Hono — full middleware, routing, and Context API.
   */
  async build(): Promise<HonoBuildResult> {
    if (!this.hasApiRoutes()) {
      return { hasApi: false, outputPath: null, errors: [] };
    }

    const entryPath = this.findEntryPoint();
    if (!entryPath) {
      return {
        hasApi: false,
        outputPath: null,
        errors: ['No API entry point found'],
      };
    }

    const errors: string[] = [];

    try {
      // Read the API source
      const source = this.fs.readFileSync(entryPath, 'utf-8') as string;

      // Create the IIFE wrapper with real Hono
      const wrapped = this.createHonoWrapper(source, entryPath);

      // Ensure output directory exists
      const outputDir = this.outputPath.substring(
        0,
        this.outputPath.lastIndexOf('/'),
      );
      try {
        this.fs.mkdirSync(outputDir, { recursive: true });
      } catch {
        // May already exist
      }

      // Write the built bundle
      this.fs.writeFileSync(this.outputPath, wrapped);

      return {
        hasApi: true,
        outputPath: this.outputPath,
        errors: [],
      };
    } catch (err: any) {
      errors.push(err?.message ?? String(err));
      return { hasApi: true, outputPath: null, errors };
    }
  }

  /**
   * Collect all API source files from the API directory.
   */
  collectApiFiles(): Map<string, string> {
    const files = new Map<string, string>();

    try {
      const entries = this.fs.readdirSync(this.apiDir);
      for (const entry of entries) {
        const entryName = typeof entry === 'string' ? entry : (entry as any).name;
        const fullPath = `${this.apiDir}/${entryName}`;
        try {
          const stat = this.fs.statSync(fullPath);
          if (!stat.isDirectory()) {
            const content = this.fs.readFileSync(fullPath, 'utf-8') as string;
            files.set(fullPath, content);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // API dir may not exist
    }

    return files;
  }

  /**
   * Ensure Hono package is available in AtuaFS /node_modules/hono/.
   * Pre-bundled with Atua — no network needed.
   */
  ensureHono(): void {
    const honoIndex = '/node_modules/hono/dist/cjs/index.js';
    if (this.fs.existsSync(honoIndex)) return;

    this.fs.mkdirSync('/node_modules/hono/dist/cjs/middleware/cors', { recursive: true });
    this.fs.writeFileSync('/node_modules/hono/package.json', HONO_PACKAGE_JSON);
    this.fs.writeFileSync(honoIndex, HONO_CORE_BUNDLE);
    this.fs.writeFileSync(
      '/node_modules/hono/dist/cjs/middleware/cors/index.js',
      HONO_CORS_BUNDLE,
    );
  }

  /**
   * Create IIFE wrapper with real Hono.
   *
   * The wrapper:
   * 1. Defines a CommonJS module registry with pre-bundled Hono
   * 2. Provides require() that resolves 'hono' and 'hono/cors'
   * 3. Transforms user's ESM import statements to require() calls
   * 4. Executes user code
   * 5. Wires up self.atuaApiHandler = app.fetch.bind(app)
   */
  private createHonoWrapper(source: string, filePath: string): string {
    // Transform ESM imports to CommonJS require calls
    const transformed = this.transformImports(source);

    return `// Atua API Bundle — Real Hono v4.12.3
// Source: ${filePath}
(function() {
  'use strict';

  // --- Pre-bundled Hono module registry ---
  var __honoModules = {};

  // Hono core
  (function() {
    var module = { exports: {} };
    var exports = module.exports;
    ${HONO_CORE_BUNDLE}
    __honoModules['hono'] = module.exports;
  })();

  // Hono CORS middleware
  (function() {
    var module = { exports: {} };
    var exports = module.exports;
    ${HONO_CORS_BUNDLE}
    __honoModules['hono/cors'] = module.exports;
  })();

  // --- CommonJS require shim ---
  function require(name) {
    if (__honoModules[name]) return __honoModules[name];
    throw new Error('[atua] Module not found: ' + name);
  }

  // --- User API code ---
${transformed}
  // --- End user API code ---

  // --- Wire up handler ---
  if (typeof app !== 'undefined' && typeof app.fetch === 'function') {
    self.atuaApiHandler = function(request, env) {
      return app.fetch(request, env);
    };
  } else {
    console.error('[atua] No Hono app found. Export your app as "app".');
  }
})();
`;
  }

  /**
   * Transform ESM import statements to CommonJS require() calls.
   * Handles:
   *   import { X, Y } from 'mod'  → var { X, Y } = require('mod');
   *   import X from 'mod'         → var X = require('mod').default || require('mod');
   *   import * as X from 'mod'    → var X = require('mod');
   *   export default X            → (kept, app is in scope via var)
   */
  private transformImports(source: string): string {
    return source
      // Named imports: import { X, Y } from 'mod'
      .replace(
        /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (_match, names: string, mod: string) =>
          `var {${names}} = require('${mod}');`,
      )
      // Default import: import X from 'mod'
      .replace(
        /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (_match, name: string, mod: string) =>
          `var ${name} = (require('${mod}').default || require('${mod}'));`,
      )
      // Namespace import: import * as X from 'mod'
      .replace(
        /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (_match, name: string, mod: string) =>
          `var ${name} = require('${mod}');`,
      )
      // Strip export default (the var is still in scope)
      .replace(/export\s+default\s+/g, '')
      // Strip export { ... }
      .replace(/export\s+\{[^}]*\}\s*;?/g, '');
  }
}
