/**
 * atua.telemetry MCP Provider — wraps real Performance API as 5 MCP tools.
 *
 * Browser-only: requires real Performance API.
 * Constructor takes optional performance object (defaults to globalThis.performance).
 */
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.telemetry';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('webvitals', 'Get Web Vitals (LCP, FID, CLS) from PerformanceObserver', {}),
  tool('resources', 'Get resource timing entries', {
    since: { type: 'number', description: 'Filter entries after this timestamp' },
  }),
  tool('memory', 'Get memory usage (requires cross-origin isolation)', {}),
  tool('marks', 'Get performance marks and measures', {
    name: { type: 'string', description: 'Filter by mark/measure name' },
  }),
  tool('timing', 'Get navigation and paint timing', {}),
];

/** Collected Web Vitals from PerformanceObserver */
interface WebVitals {
  lcp?: number;
  fid?: number;
  cls?: number;
}

export function createAtuaTelemetryProvider(
  perf?: Performance,
): ProviderRegistration {
  const p = perf ?? (typeof globalThis !== 'undefined' ? globalThis.performance : undefined);
  const vitals: WebVitals = {};

  // Set up PerformanceObserver for Web Vitals if available
  if (typeof PerformanceObserver !== 'undefined' && p) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') {
            vitals.lcp = entry.startTime;
          }
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* observer type not supported */ }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'first-input') {
            vitals.fid = (entry as any).processingStart - entry.startTime;
          }
        }
      }).observe({ type: 'first-input', buffered: true });
    } catch { /* observer type not supported */ }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
            vitals.cls = (vitals.cls ?? 0) + (entry as any).value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* observer type not supported */ }
  }

  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    if (!p) {
      return { content: 'Performance API not available', isError: true };
    }

    try {
      switch (shortName) {
        case 'webvitals': {
          return { content: { ...vitals } };
        }
        case 'resources': {
          let entries = p.getEntriesByType('resource');
          if (a.since) {
            entries = entries.filter((e) => e.startTime >= a.since);
          }
          return {
            content: entries.map((e) => ({
              name: e.name,
              startTime: e.startTime,
              duration: e.duration,
              transferSize: (e as any).transferSize,
              encodedBodySize: (e as any).encodedBodySize,
              initiatorType: (e as any).initiatorType,
            })),
          };
        }
        case 'memory': {
          const fn = (p as any).measureUserAgentSpecificMemory;
          if (typeof fn !== 'function') {
            return {
              content: {
                available: false,
                reason: 'requires cross-origin isolation',
              },
            };
          }
          const memoryInfo = await fn.call(p);
          return { content: { available: true, ...memoryInfo } };
        }
        case 'marks': {
          let marks = p.getEntriesByType('mark');
          let measures = p.getEntriesByType('measure');
          if (a.name) {
            marks = marks.filter((e) => e.name === a.name);
            measures = measures.filter((e) => e.name === a.name);
          }
          return {
            content: {
              marks: marks.map((e) => ({
                name: e.name,
                startTime: e.startTime,
                duration: e.duration,
              })),
              measures: measures.map((e) => ({
                name: e.name,
                startTime: e.startTime,
                duration: e.duration,
              })),
            },
          };
        }
        case 'timing': {
          const navigation = p.getEntriesByType('navigation');
          const paint = p.getEntriesByType('paint');
          return {
            content: {
              navigation: navigation.map((e) => ({
                name: e.name,
                startTime: e.startTime,
                duration: e.duration,
                type: (e as any).type,
                redirectCount: (e as any).redirectCount,
                domContentLoadedEventEnd: (e as any).domContentLoadedEventEnd,
                loadEventEnd: (e as any).loadEventEnd,
              })),
              paint: paint.map((e) => ({
                name: e.name,
                startTime: e.startTime,
              })),
            },
          };
        }
        default:
          return { content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  return createProvider({
    namespace: NS,
    tools: TOOLS,
    handler,
    capabilities: ['telemetry.webvitals', 'telemetry.memory'],
  });
}
