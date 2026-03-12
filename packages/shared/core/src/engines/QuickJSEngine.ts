/**
 * QuickJSEngine — QuickJS-WASM based JavaScript execution engine
 *
 * This is the renamed CatalystEngine. It runs user code inside QuickJS
 * compiled to WebAssembly, providing a sandboxed execution environment.
 *
 * Used as:
 * - Tier 0: Validation layer (parse, check, quick-execute against stubs)
 * - Tier 2: Workers compatibility mode (Cloudflare Workers constraints)
 *
 * The original CatalystEngine class is preserved for backward compatibility.
 * QuickJSEngine is the canonical name going forward.
 */
export { CatalystEngine as QuickJSEngine } from '../engine/CatalystEngine.js';
export type { EngineConfig, ConsoleLevel } from '../engine/CatalystEngine.js';
