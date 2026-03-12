/**
 * Host bindings barrel export.
 * Each binding returns a pure JS source string that can be injected
 * into QuickJS via evalCode(). The source defines module.exports so
 * it integrates with a CommonJS-style require() shim.
 *
 * Phase 13a: crypto removed (replaced by unenv-bridge crypto).
 * New modules (os, stream, http, querystring, string_decoder, zlib)
 * are provided by unenv-bridge.ts.
 */

export { getPathSource } from './path.js';
export { getConsoleSource } from './console.js';
export { getProcessSource } from './process.js';
export { getBufferSource } from './buffer.js';
export { getEventsSource } from './events.js';
export { getTimersSource } from './timers.js';
export { getUrlSource } from './url.js';
export { getAssertSource } from './assert.js';
export { getUtilSource } from './util.js';

// unenv-backed modules
export {
  UNENV_MODULES,
  STUB_MODULES,
  PROVIDER_REGISTRY,
  getUnenvCryptoSource,
  getUnenvOsSource,
  getUnenvStreamSource,
  getUnenvHttpSource,
  getUnenvQuerystringSource,
  getUnenvStringDecoderSource,
  getUnenvZlibSource,
  getStubModuleSource,
} from './unenv-bridge.js';

import { getPathSource } from './path.js';
import { getConsoleSource } from './console.js';
import { getProcessSource } from './process.js';
import { getBufferSource } from './buffer.js';
import { getEventsSource } from './events.js';
import { getTimersSource } from './timers.js';
import { getUrlSource } from './url.js';
import { getAssertSource } from './assert.js';
import { getUtilSource } from './util.js';

/**
 * Convenience map: module name -> source getter.
 * Contains ONLY custom (atua) host bindings.
 * For unenv-backed modules, see UNENV_MODULES in unenv-bridge.ts.
 */
export function getBuiltinModules(): Record<string, () => string> {
  return {
    path: getPathSource,
    console: getConsoleSource,
    process: getProcessSource,
    buffer: getBufferSource,
    events: getEventsSource,
    timers: getTimersSource,
    url: getUrlSource,
    assert: getAssertSource,
    util: getUtilSource,
  };
}
