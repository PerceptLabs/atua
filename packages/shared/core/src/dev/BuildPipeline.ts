/**
 * BuildPipeline — Source transpilation and bundling
 *
 * Reads source files from CatalystFS, transforms with a configurable
 * transpiler (esbuild-wasm or custom), bundles modules, writes output
 * to /dist/ in CatalystFS.
 *
 * Features:
 * - TSX/TS/JSX → JS transpilation
 * - Simple module bundling with import resolution
 * - Content-hash caching (skip redundant builds)
 * - Frontend + backend (SW) build passes
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import { ContentHashCache } from './ContentHashCache.js';

export interface BuildConfig {
  /** Entry point path in CatalystFS (default: '/src/index.tsx') */
  entryPoint?: string;
  /** Output directory (default: '/dist') */
  outDir?: string;
  /** Output filename (default: 'app.js') */
  outFile?: string;
  /** Target platform (default: 'browser') */
  platform?: 'browser' | 'worker';
  /** JSX transform mode (default: 'transform') */
  jsx?: 'transform' | 'automatic';
  /** Minify output (default: false) */
  minify?: boolean;
  /** Target environment (default: 'es2020') */
  target?: string;
}

export interface BuildResult {
  outputPath: string;
  code: string;
  errors: BuildError[];
  hash: string;
  cached: boolean;
  duration: number;
}

export interface BuildError {
  text: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface TranspileResult {
  code: string;
  errors: BuildError[];
}

/** Pluggable transpiler interface */
export interface Transpiler {
  transform(
    code: string,
    options: { loader: string; jsx?: string; minify?: boolean; target?: string },
  ): Promise<TranspileResult>;
}

/** Default pass-through transpiler (no transformation) */
export class PassthroughTranspiler implements Transpiler {
  async transform(code: string): Promise<TranspileResult> {
    return { code, errors: [] };
  }
}

/** Transpiler that uses esbuild-wasm */
export class EsbuildTranspiler implements Transpiler {
  private esbuild: any = null;
  private initPromise: Promise<void> | null = null;

  async transform(
    code: string,
    options: { loader: string; jsx?: string; minify?: boolean; target?: string },
  ): Promise<TranspileResult> {
    await this.ensureInitialized();

    try {
      const result = await this.esbuild.transform(code, {
        loader: options.loader,
        jsx: options.jsx ?? 'transform',
        minify: options.minify ?? false,
        target: options.target ?? 'es2020',
      });
      return { code: result.code, errors: [] };
    } catch (err: any) {
      const errors: BuildError[] = [];
      if (err.errors && Array.isArray(err.errors)) {
        for (const e of err.errors) {
          errors.push({
            text: e.text || String(e),
            file: e.location?.file,
            line: e.location?.line,
            column: e.location?.column,
          });
        }
      } else {
        errors.push({ text: err.message || String(err) });
      }
      return { code: '', errors };
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.esbuild) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const esbuild = await import('esbuild-wasm');

      // Try initialization — works differently in Node vs browser
      let initialized = false;
      try {
        await esbuild.initialize({});
        initialized = true;
      } catch {
        // May need worker:false option
        try {
          await esbuild.initialize({ worker: false });
          initialized = true;
        } catch (e: any) {
          // Check if already initialized (calling initialize twice throws)
          if (e?.message?.includes('already') || e?.message?.includes('Cannot call')) {
            initialized = true;
          }
        }
      }

      if (!initialized) {
        throw new Error('Failed to initialize esbuild-wasm');
      }

      this.esbuild = esbuild;
    })();

    await this.initPromise;
  }
}

export class BuildPipeline {
  private fs: CatalystFS;
  private transpiler: Transpiler;
  private cache: ContentHashCache;

  constructor(fs: CatalystFS, transpiler?: Transpiler) {
    this.fs = fs;
    this.transpiler = transpiler ?? new PassthroughTranspiler();
    this.cache = new ContentHashCache();
  }

  /** Get the content hash cache */
  getCache(): ContentHashCache {
    return this.cache;
  }

  /**
   * Build from entry point: collect sources, transform, bundle, write output.
   */
  async build(config: BuildConfig = {}): Promise<BuildResult> {
    const start = Date.now();
    const entryPoint = config.entryPoint ?? '/src/index.tsx';
    const outDir = config.outDir ?? '/dist';
    const outFile = config.outFile ?? 'app.js';
    const outputPath = `${outDir}/${outFile}`;

    // Collect all source files starting from entry point
    const sourceFiles = new Map<string, string>();
    try {
      this.collectSources(entryPoint, sourceFiles);
    } catch (err: any) {
      return {
        outputPath,
        code: '',
        errors: [{ text: `Failed to read sources: ${err.message || err}`, file: entryPoint }],
        hash: '',
        cached: false,
        duration: Date.now() - start,
      };
    }

    if (sourceFiles.size === 0) {
      return {
        outputPath,
        code: '',
        errors: [{ text: `Entry point not found: ${entryPoint}`, file: entryPoint }],
        hash: '',
        cached: false,
        duration: Date.now() - start,
      };
    }

    // Compute content hash
    const hash = await this.cache.computeHash(sourceFiles);

    // Check cache
    const cached = this.cache.get(hash);
    if (cached) {
      return {
        outputPath: cached.outputPath,
        code: cached.code,
        errors: [],
        hash,
        cached: true,
        duration: Date.now() - start,
      };
    }

    // Transform all files
    const allErrors: BuildError[] = [];
    const modules = new Map<string, string>();

    for (const [path, source] of sourceFiles) {
      const loader = getLoader(path);
      const result = await this.transpiler.transform(source, {
        loader,
        jsx: config.jsx ?? 'transform',
        minify: config.minify,
        target: config.target ?? 'es2020',
      });

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          allErrors.push({ ...err, file: err.file ?? path });
        }
      } else {
        modules.set(path, result.code);
      }
    }

    if (allErrors.length > 0) {
      return {
        outputPath,
        code: '',
        errors: allErrors,
        hash,
        cached: false,
        duration: Date.now() - start,
      };
    }

    // Bundle modules
    const bundle = this.bundle(modules, entryPoint, config.platform ?? 'browser');

    // Write output
    this.ensureDir(outDir);
    this.fs.writeFileSync(outputPath, bundle);

    // Cache the build
    this.cache.set(hash, { code: bundle, outputPath });

    return {
      outputPath,
      code: bundle,
      errors: [],
      hash,
      cached: false,
      duration: Date.now() - start,
    };
  }

  /** Collect source files recursively from CatalystFS */
  private collectSources(path: string, collected: Map<string, string>, depth = 0): void {
    if (collected.has(path)) return;

    // Try to read the file (resolve extensions if needed)
    const resolved = this.resolveFile(path);
    if (!resolved) return;

    const source = this.fs.readFileSync(resolved, 'utf-8') as string;
    collected.set(resolved, source);

    // Parse imports and recurse
    const imports = parseImports(source);
    for (const imp of imports) {
      if (imp.startsWith('.') || imp.startsWith('/')) {
        const importPath = resolveRelative(imp, resolved);
        try {
          this.collectSources(importPath, collected, depth + 1);
        } catch {
          // Imported file not found — skip
        }
      }
    }
  }

  /** Resolve a file path, trying common extensions */
  private resolveFile(path: string): string | null {
    if (this.fs.existsSync(path)) return path;

    const extensions = ['.tsx', '.ts', '.jsx', '.js', '.json'];
    for (const ext of extensions) {
      const withExt = path + ext;
      if (this.fs.existsSync(withExt)) return withExt;
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = `${path}/index${ext}`;
      if (this.fs.existsSync(indexPath)) return indexPath;
    }

    return null;
  }

  /** Bundle modules into a single output file */
  private bundle(
    modules: Map<string, string>,
    entryPoint: string,
    platform: string,
  ): string {
    if (modules.size === 1) {
      // Single module — no wrapping needed
      const code = modules.values().next().value!;
      if (platform === 'worker') {
        return `// Catalyst Worker Build\n${code}`;
      }
      return code;
    }

    // Multi-module: wrap in module registry
    const moduleIds = new Map<string, number>();
    const moduleCode: string[] = [];
    let id = 0;

    for (const [path, code] of modules) {
      moduleIds.set(path, id);
      moduleCode.push(`  /* ${path} */\n  ${id}: function(module, exports, require) {\n${indent(code, 4)}\n  }`);
      id++;
    }

    const entryId = moduleIds.get(entryPoint) ?? 0;

    return `(function() {
var __modules = {
${moduleCode.join(',\n')}
};
var __cache = {};
function require(id) {
  if (__cache[id]) return __cache[id].exports;
  var module = __cache[id] = { exports: {} };
  __modules[id](module, module.exports, require);
  return module.exports;
}
require(${entryId});
})();`;
  }

  /** Ensure a directory exists */
  private ensureDir(path: string): void {
    try {
      if (!this.fs.existsSync(path)) {
        this.fs.mkdirSync(path, { recursive: true });
      }
    } catch {}
  }
}

/** Determine loader type from file extension */
export function getLoader(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  return 'js';
}

/** Parse import/require specifiers from source code */
export function parseImports(source: string): string[] {
  const imports: string[] = [];

  // Match: import ... from '...' (single line)
  const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    imports.push(match[1]);
  }

  // Match: require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/** Resolve a relative import specifier */
export function resolveRelative(specifier: string, from: string): string {
  if (specifier.startsWith('/')) return specifier;

  const dir = from.substring(0, from.lastIndexOf('/')) || '/';

  if (specifier.startsWith('./')) {
    return normalizePath(`${dir}/${specifier.slice(2)}`);
  }
  if (specifier.startsWith('../')) {
    return normalizePath(`${dir}/${specifier}`);
  }
  return specifier;
}

/** Normalize a path (resolve .. and .) */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return '/' + result.join('/');
}

/** Indent every line of text */
function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}
