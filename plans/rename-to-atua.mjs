/**
 * rename-to-atua.mjs
 * Renames all Catalyst → Atua references across the codebase.
 *
 * Usage (run from repo root C:\Users\v1sua\Downloads\catalystlatest):
 *   node C:\Users\v1sua\atua\plans\rename-to-atua.mjs
 *   node C:\Users\v1sua\atua\plans\rename-to-atua.mjs --apply
 *
 * Safe to re-run: skips files that are already renamed.
 */

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const DRY_RUN = !process.argv.includes('--apply');
if (DRY_RUN) console.log('DRY RUN — pass --apply to make changes\n');

// Target codebase — always explicit, never inferred from script location
const ROOT = 'C:\\Users\\v1sua\\Downloads\\catalystlatest';

const CONTENT_REPLACEMENTS = [
  // Package names (longest first)
  ['@aspect/catalyst-workers-d1',   '@aspect/atua-workers-d1'],
  ['@aspect/catalyst-compliance',   '@aspect/atua-compliance'],
  ['@aspect/catalyst-engine-deno',  '@aspect/atua-engine-deno'],
  ['@aspect/catalyst-sveltekit',    '@aspect/atua-sveltekit'],
  ['@aspect/catalyst-workers',      '@aspect/atua-workers'],
  ['@aspect/catalyst-astro',        '@aspect/atua-astro'],
  ['@aspect/catalyst-core',         '@aspect/atua-core'],
  ['@aspect/catalyst',              '@aspect/atua'],
  ['nitro-preset-catalyst',         'nitro-preset-atua'],

  // Class names (longest compound names first)
  ['CatalystHTTPServer',            'AtuaHTTPServer'],
  ['CatalystTCPSocket',             'AtuaTCPSocket'],
  ['CatalystTCPServer',             'AtuaTCPServer'],
  ['CatalystD1PreparedStatement',   'AtuaD1PreparedStatement'],
  ['CatalystTerminal',              'AtuaTerminal'],
  ['CatalystProcess',               'AtuaProcess'],
  ['CatalystCluster',               'AtuaCluster'],
  ['CatalystEngine',                'AtuaEngine'],
  ['CatalystConfig',                'AtuaConfig'],
  ['CatalystShell',                 'AtuaShell'],
  ['CatalystHTTP',                  'AtuaHTTP'],
  ['CatalystWASI',                  'AtuaWASI'],
  ['CatalystSync',                  'AtuaSync'],
  ['CatalystDNS',                   'AtuaDNS'],
  ['CatalystTCP',                   'AtuaTCP'],
  ['CatalystTLS',                   'AtuaTLS'],
  ['CatalystFS',                    'AtuaFS'],
  ['CatalystKV',                    'AtuaKV'],
  ['CatalystR2',                    'AtuaR2'],
  ['CatalystD1',                    'AtuaD1'],

  // Scoped string literals (only applied to SCOPED_STRING_FILES below)
  ["config.name ?? 'catalyst'",     "config.name ?? 'atua'"],
  ["title: 'catalyst'",             "title: 'atua'"],
  ["'catalyst'",                    "'atua'"],

  // Import paths
  ["from './catalyst.js'",          "from './atua.js'"],
  ["from './catalyst'",             "from './atua'"],
  ["from '../catalyst.js'",         "from '../atua.js'"],
  ["from '../catalyst'",            "from '../atua'"],
];

const SCOPED_STRING_FILES = new Set([
  'unenv-bridge.ts',
  'NativeEngine.ts',
  'GlobalScope.ts',
  'process.ts',
]);

const CONTENT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yaml', '.yml']);

const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git', '__screenshots__']);
const SKIP_FILES = new Set([
  'catalyst-roadmap.md',
  'catalyst-spec.md',
  'pnpm-lock.yaml',
]);

const FILE_RENAMES = [
  ['packages/shared/core/src/catalyst.ts',                        'packages/shared/core/src/atua.ts'],
  ['packages/shared/core/src/engine/CatalystEngine.ts',           'packages/shared/core/src/engine/AtuaEngine.ts'],
  ['packages/shared/core/src/engine/CatalystEngine.test.ts',      'packages/shared/core/src/engine/AtuaEngine.test.ts'],
  ['packages/shared/core/src/engine/CatalystEngine.browser.test.ts', 'packages/shared/core/src/engine/AtuaEngine.browser.test.ts'],
];

const DIR_RENAMES = [
  ['packages/workers/catalyst-workers-d1',   'packages/workers/atua-workers-d1'],
  ['packages/workers/catalyst-workers',       'packages/workers/atua-workers'],
  ['packages/workers/nitro-preset-catalyst',  'packages/workers/nitro-preset-atua'],
  ['packages/distributions/catalyst',         'packages/distributions/atua'],
];

let fileCount = 0;
let changeCount = 0;

function walkFiles(dir, callback) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walkFiles(fullPath, callback);
    } else {
      callback(fullPath, entry);
    }
  }
}

function applyContentReplacements(filePath, fileName) {
  if (!CONTENT_EXTS.has(extname(fileName))) return;
  if (SKIP_FILES.has(fileName)) return;

  const original = readFileSync(filePath, 'utf8');
  let content = original;
  const isScoped = SCOPED_STRING_FILES.has(fileName);

  for (const [from, to] of CONTENT_REPLACEMENTS) {
    if (from === "'catalyst'" && !isScoped) continue;
    content = content.replaceAll(from, to);
  }

  if (content !== original) {
    fileCount++;
    const lines = original.split('\n');
    const newLines = content.split('\n');
    const changedLines = lines
      .map((line, i) => ({ line, i, newLine: newLines[i] }))
      .filter(({ line, newLine }) => line !== newLine)
      .slice(0, 5);

    console.log(`  ${filePath.replace(ROOT, '')}`);
    for (const { i, line, newLine } of changedLines) {
      console.log(`    L${i + 1}: "${line.trim()}" → "${newLine.trim()}"`);
    }
    changeCount += changedLines.length;

    if (!DRY_RUN) writeFileSync(filePath, content, 'utf8');
  }
}

console.log('=== Step 1: Content replacements ===\n');
walkFiles(ROOT, applyContentReplacements);
console.log(`\n${fileCount} files, ${changeCount}+ lines\n`);

console.log('=== Step 2: File renames ===\n');
for (const [from, to] of FILE_RENAMES) {
  const fromPath = join(ROOT, from);
  const toPath = join(ROOT, to);
  if (!existsSync(fromPath)) { console.log(`  SKIP: ${from}`); continue; }
  if (existsSync(toPath))    { console.log(`  SKIP (exists): ${to}`); continue; }
  console.log(`  ${from} → ${to}`);
  if (!DRY_RUN) renameSync(fromPath, toPath);
}

console.log('\n=== Step 3: Directory renames ===\n');
for (const [from, to] of DIR_RENAMES) {
  const fromPath = join(ROOT, from);
  const toPath = join(ROOT, to);
  if (!existsSync(fromPath)) { console.log(`  SKIP: ${from}`); continue; }
  if (existsSync(toPath))    { console.log(`  SKIP (exists): ${to}`); continue; }
  console.log(`  ${from} → ${to}`);
  if (!DRY_RUN) renameSync(fromPath, toPath);
}

if (DRY_RUN) {
  console.log('\n─── DRY RUN complete. Run with --apply to execute. ───');
} else {
  console.log('\n─── Done. Next: ───');
  console.log('  cd C:\\Users\\v1sua\\Downloads\\catalystlatest');
  console.log('  del pnpm-lock.yaml && pnpm install');
  console.log('  pnpm tsc --noEmit && pnpm test');
}
