/**
 * @aspect/catalyst-workers-d1 — Cloudflare D1 emulation via wa-sqlite
 *
 * Separate package due to 940KB WASM dependency.
 * Only loaded when project declares D1 bindings.
 */
export { CatalystD1, CatalystD1PreparedStatement } from './d1.js';
export type { D1Result, D1Meta, D1ExecResult } from './d1.js';
