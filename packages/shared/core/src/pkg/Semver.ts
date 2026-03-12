/**
 * Semver — Thin adapter over @std/semver
 *
 * Preserves the string-based API used by NpmResolver and PackageManager
 * while delegating to the well-tested @std/semver implementation.
 */
import {
  parse as stdParse,
  tryParse as stdTryParse,
  parseRange as stdParseRange,
  tryParseRange as stdTryParseRange,
  satisfies as stdSatisfies,
  maxSatisfying as stdMaxSatisfying,
  compare as stdCompare,
  format as stdFormat,
  canParse as stdCanParse,
} from '@jsr/std__semver';

export interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/** Parse a version string like "1.2.3" or "1.2.3-beta.1" */
export function parse(version: string): SemverVersion | null {
  const cleaned = version.replace(/^[v=]/, '').trim();
  const sv = stdTryParse(cleaned);
  if (!sv) return null;
  return {
    major: sv.major,
    minor: sv.minor,
    patch: sv.patch,
    prerelease: sv.prerelease && sv.prerelease.length > 0 ? sv.prerelease.join('.') : undefined,
  };
}

/** Compare two versions: -1 if a < b, 0 if equal, 1 if a > b */
export function compare(a: SemverVersion, b: SemverVersion): -1 | 0 | 1 {
  const sa = stdParse(`${a.major}.${a.minor}.${a.patch}${a.prerelease ? '-' + a.prerelease : ''}`);
  const sb = stdParse(`${b.major}.${b.minor}.${b.patch}${b.prerelease ? '-' + b.prerelease : ''}`);
  return stdCompare(sa, sb);
}

/** Check if version satisfies a range like ^1.2.3, ~1.2.3, >=1.0.0 */
export function satisfies(version: string, range: string): boolean {
  const trimmed = range.trim();

  // Handle special cases @std/semver doesn't parse
  if (trimmed === '*' || trimmed === 'latest' || trimmed === '') return true;

  const cleaned = version.replace(/^[v=]/, '').trim();
  const sv = stdTryParse(cleaned);
  if (!sv) return false;

  // Handle x-ranges (1.x, 1.2.x) — convert to caret/tilde equivalent
  if (trimmed.includes('x') || trimmed.includes('X')) {
    const parts = trimmed.split('.');
    if (parts[0] && parts[0] !== 'x' && parts[0] !== 'X') {
      if (sv.major !== parseInt(parts[0], 10)) return false;
    }
    if (parts[1] && parts[1] !== 'x' && parts[1] !== 'X') {
      if (sv.minor !== parseInt(parts[1], 10)) return false;
    }
    return true;
  }

  // Exact version (no operator prefix) — treat as pinned
  if (/^\d+\.\d+\.\d+/.test(trimmed) && !/[~^>=<]/.test(trimmed)) {
    const rv = stdTryParse(trimmed);
    if (!rv) return false;
    return stdCompare(sv, rv) === 0;
  }

  const r = stdTryParseRange(trimmed);
  if (!r) return false;
  return stdSatisfies(sv, r);
}

/** Find the latest version from a list that satisfies a range */
export function maxSatisfying(versions: string[], range: string): string | null {
  const trimmed = range.trim();
  if (trimmed === '*' || trimmed === 'latest' || trimmed === '') {
    // Return highest non-prerelease version
    const parsed = versions
      .map((v) => ({ str: v, sv: stdTryParse(v.replace(/^[v=]/, '').trim()) }))
      .filter((x) => x.sv && (!x.sv.prerelease || x.sv.prerelease.length === 0));
    if (parsed.length === 0) return null;
    parsed.sort((a, b) => stdCompare(a.sv!, b.sv!));
    return parsed[parsed.length - 1].str;
  }

  // Parse range — handle x-ranges by filtering manually
  if (trimmed.includes('x') || trimmed.includes('X')) {
    let best: string | null = null;
    let bestSv: ReturnType<typeof stdTryParse> = undefined;
    for (const v of versions) {
      if (!satisfies(v, trimmed)) continue;
      const sv = stdTryParse(v.replace(/^[v=]/, '').trim());
      if (!sv || (sv.prerelease && sv.prerelease.length > 0)) continue;
      if (!bestSv || stdCompare(sv, bestSv) > 0) {
        best = v;
        bestSv = sv;
      }
    }
    return best;
  }

  const r = stdTryParseRange(trimmed);
  if (!r) return null;

  const svVersions = versions
    .map((v) => ({ str: v, sv: stdTryParse(v.replace(/^[v=]/, '').trim()) }))
    .filter((x): x is { str: string; sv: NonNullable<typeof x.sv> } => {
      if (!x.sv) return false;
      // Skip prereleases unless range explicitly targets them
      if (x.sv.prerelease && x.sv.prerelease.length > 0 && !range.includes('-')) return false;
      return true;
    });

  const best = stdMaxSatisfying(svVersions.map((x) => x.sv), r);
  if (!best) return null;

  // Find the original string for this version
  const formatted = stdFormat(best);
  const match = svVersions.find((x) => stdFormat(x.sv) === formatted);
  return match?.str ?? formatted;
}

/** Sort versions in ascending order */
export function sort(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const sa = stdTryParse(a.replace(/^[v=]/, '').trim());
    const sb = stdTryParse(b.replace(/^[v=]/, '').trim());
    if (!sa || !sb) return 0;
    return stdCompare(sa, sb);
  });
}

/** Check if a string is a valid semver version */
export function valid(version: string): boolean {
  return stdCanParse(version.replace(/^[v=]/, '').trim());
}
