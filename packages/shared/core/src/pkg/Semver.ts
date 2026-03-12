/**
 * Semver — Lightweight semver parsing and range matching
 *
 * Supports: ^1.2.3, ~1.2.3, >=1.0.0, 1.x, *, and exact versions.
 */

export interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/** Parse a version string like "1.2.3" or "1.2.3-beta.1" */
export function parse(version: string): SemverVersion | null {
  const cleaned = version.replace(/^[v=]/, '').trim();
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/** Compare two versions: -1 if a < b, 0 if equal, 1 if a > b */
export function compare(a: SemverVersion, b: SemverVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // Prerelease versions have lower precedence
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
  }
  return 0;
}

/** Check if version satisfies a range like ^1.2.3, ~1.2.3, >=1.0.0 */
export function satisfies(version: string, range: string): boolean {
  const ver = parse(version);
  if (!ver) return false;

  const trimmed = range.trim();

  // Exact version
  if (/^\d+\.\d+\.\d+/.test(trimmed)) {
    const rangeVer = parse(trimmed);
    if (!rangeVer) return false;
    if (trimmed.startsWith('=')) {
      return compare(ver, rangeVer) === 0;
    }
    // If no prefix, treat as exact match for lockfile-style pinning
    if (!/[~^>=<]/.test(trimmed)) {
      return compare(ver, rangeVer) === 0;
    }
  }

  // Wildcard
  if (trimmed === '*' || trimmed === 'latest' || trimmed === '') {
    return true;
  }

  // x-range: 1.x, 1.2.x
  if (trimmed.includes('x') || trimmed.includes('X')) {
    const parts = trimmed.split('.');
    if (parts[0] && parts[0] !== 'x' && parts[0] !== 'X') {
      if (ver.major !== parseInt(parts[0], 10)) return false;
    }
    if (parts[1] && parts[1] !== 'x' && parts[1] !== 'X') {
      if (ver.minor !== parseInt(parts[1], 10)) return false;
    }
    return true;
  }

  // Caret range: ^1.2.3
  if (trimmed.startsWith('^')) {
    const rangeVer = parse(trimmed.slice(1));
    if (!rangeVer) return false;
    if (ver.major !== rangeVer.major) return false;
    if (rangeVer.major === 0) {
      if (ver.minor !== rangeVer.minor) return false;
      return ver.patch >= rangeVer.patch;
    }
    if (ver.minor < rangeVer.minor) return false;
    if (ver.minor === rangeVer.minor && ver.patch < rangeVer.patch) return false;
    return true;
  }

  // Tilde range: ~1.2.3
  if (trimmed.startsWith('~')) {
    const rangeVer = parse(trimmed.slice(1));
    if (!rangeVer) return false;
    if (ver.major !== rangeVer.major) return false;
    if (ver.minor !== rangeVer.minor) return false;
    return ver.patch >= rangeVer.patch;
  }

  // Comparison ranges: >=1.0.0, >1.0.0, <=1.0.0, <1.0.0
  if (trimmed.startsWith('>=')) {
    const rangeVer = parse(trimmed.slice(2));
    if (!rangeVer) return false;
    return compare(ver, rangeVer) >= 0;
  }
  if (trimmed.startsWith('>')) {
    const rangeVer = parse(trimmed.slice(1));
    if (!rangeVer) return false;
    return compare(ver, rangeVer) > 0;
  }
  if (trimmed.startsWith('<=')) {
    const rangeVer = parse(trimmed.slice(2));
    if (!rangeVer) return false;
    return compare(ver, rangeVer) <= 0;
  }
  if (trimmed.startsWith('<')) {
    const rangeVer = parse(trimmed.slice(1));
    if (!rangeVer) return false;
    return compare(ver, rangeVer) < 0;
  }

  return false;
}

/** Find the latest version from a list that satisfies a range */
export function maxSatisfying(versions: string[], range: string): string | null {
  let best: string | null = null;
  let bestParsed: SemverVersion | null = null;

  for (const v of versions) {
    if (!satisfies(v, range)) continue;
    const parsed = parse(v);
    if (!parsed) continue;
    // Skip prereleases unless range explicitly targets them
    if (parsed.prerelease && !range.includes('-')) continue;
    if (!bestParsed || compare(parsed, bestParsed) > 0) {
      best = v;
      bestParsed = parsed;
    }
  }

  return best;
}

/** Sort versions in ascending order */
export function sort(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (!pa || !pb) return 0;
    return compare(pa, pb);
  });
}

/** Check if a string is a valid semver version */
export function valid(version: string): boolean {
  return parse(version) !== null;
}
