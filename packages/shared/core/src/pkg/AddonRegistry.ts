/**
 * AddonRegistry — Registry for native addon WASM replacements
 *
 * Phase I: Maps native Node.js addons to their WASM equivalents.
 * When user code requires a package that contains native addons
 * (like better-sqlite3, sharp, bcrypt), the registry provides
 * a WASM-compiled alternative.
 *
 * Registry structure:
 * - Each addon has a name, WASM module URL, and JS wrapper
 * - Addons are loaded lazily when first required
 * - Pre-configured with common native addons
 */

export interface AddonEntry {
  /** npm package name that this replaces */
  packageName: string;
  /** URL or path to WASM module */
  wasmUrl?: string;
  /** Alternative pure-JS package name */
  jsAlternative?: string;
  /** Description of what this addon does */
  description: string;
  /** Whether the WASM replacement is available */
  available: boolean;
  /** Coverage level: 'full', 'partial', 'stub' */
  coverage: 'full' | 'partial' | 'stub';
}

/** Pre-configured addon mappings */
const DEFAULT_ADDONS: AddonEntry[] = [
  {
    packageName: 'better-sqlite3',
    jsAlternative: 'sql.js',
    description: 'SQLite database — uses sql.js (SQLite compiled to WASM)',
    available: true,
    coverage: 'full',
  },
  {
    packageName: 'sharp',
    description: 'Image processing — uses WASM-compiled libvips',
    available: false,
    coverage: 'stub',
  },
  {
    packageName: 'bcrypt',
    jsAlternative: 'bcryptjs',
    description: 'Password hashing — uses pure-JS bcryptjs',
    available: true,
    coverage: 'full',
  },
  {
    packageName: 'argon2',
    description: 'Password hashing — uses WASM-compiled argon2',
    available: false,
    coverage: 'stub',
  },
  {
    packageName: 'canvas',
    description: 'HTML Canvas API — uses browser native Canvas',
    available: true,
    coverage: 'partial',
  },
  {
    packageName: 'node-gyp',
    description: 'Native build tool — not needed in WASM environment',
    available: false,
    coverage: 'stub',
  },
  {
    packageName: 'fsevents',
    description: 'macOS file watching — uses CatalystFS FileWatcher instead',
    available: true,
    coverage: 'full',
  },
  {
    packageName: 'esbuild',
    jsAlternative: 'esbuild-wasm',
    description: 'JavaScript bundler — uses WASM build of esbuild',
    available: true,
    coverage: 'full',
  },
  {
    packageName: 'lightningcss',
    description: 'CSS parser/transformer — WASM build available',
    available: true,
    coverage: 'full',
  },
  {
    packageName: 'sass',
    description: 'Sass compiler — pure-JS Dart Sass',
    available: true,
    coverage: 'full',
  },
];

export class AddonRegistry {
  private addons = new Map<string, AddonEntry>();

  constructor(addons?: AddonEntry[]) {
    const entries = addons ?? DEFAULT_ADDONS;
    for (const addon of entries) {
      this.addons.set(addon.packageName, addon);
    }
  }

  /** Check if a package has a native addon that needs replacement */
  hasAddon(packageName: string): boolean {
    return this.addons.has(packageName);
  }

  /** Get the addon entry for a package */
  getAddon(packageName: string): AddonEntry | undefined {
    return this.addons.get(packageName);
  }

  /** Get the JS alternative for a native addon (if available) */
  getAlternative(packageName: string): string | undefined {
    return this.addons.get(packageName)?.jsAlternative;
  }

  /** Check if the addon replacement is available */
  isAvailable(packageName: string): boolean {
    return this.addons.get(packageName)?.available ?? false;
  }

  /** Register a new addon mapping */
  register(entry: AddonEntry): void {
    this.addons.set(entry.packageName, entry);
  }

  /** Remove an addon mapping */
  unregister(packageName: string): boolean {
    return this.addons.delete(packageName);
  }

  /** List all registered addons */
  listAddons(): AddonEntry[] {
    return [...this.addons.values()];
  }

  /** List only available addon replacements */
  listAvailable(): AddonEntry[] {
    return this.listAddons().filter((a) => a.available);
  }

  /** List addons that need WASM compilation (not yet available) */
  listUnavailable(): AddonEntry[] {
    return this.listAddons().filter((a) => !a.available);
  }

  /** Get compatibility report */
  getCompatReport(): {
    total: number;
    available: number;
    partial: number;
    unavailable: number;
    coverage: number;
  } {
    const all = this.listAddons();
    const available = all.filter((a) => a.available && a.coverage === 'full').length;
    const partial = all.filter((a) => a.available && a.coverage === 'partial').length;
    const unavailable = all.filter((a) => !a.available).length;

    return {
      total: all.length,
      available,
      partial,
      unavailable,
      coverage: all.length > 0 ? (available + partial * 0.5) / all.length : 1,
    };
  }
}
