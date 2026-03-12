/**
 * atua.preview MCP Provider — wraps iframe-based preview as 6 MCP tools.
 *
 * Browser-only: requires real DOM for iframe creation and inspection.
 * The provider takes a PreviewController interface to abstract iframe access.
 */
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.preview';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('start', 'Start a preview (creates iframe, loads entry point)', {
    entryPoint: { type: 'string', description: 'Entry point path (default: /index.html)' },
  }),
  tool('stop', 'Stop the active preview', {}),
  tool('dom.query', 'Query a single DOM element in the preview', {
    selector: { type: 'string', description: 'CSS selector', required: true },
  }),
  tool('dom.queryAll', 'Query all matching DOM elements in the preview', {
    selector: { type: 'string', description: 'CSS selector', required: true },
  }),
  tool('console', 'Get console log entries from the preview', {
    since: { type: 'number', description: 'Timestamp to filter from' },
  }),
  tool('errors', 'Get runtime errors from the preview', {
    since: { type: 'number', description: 'Timestamp to filter from' },
  }),
];

/** Interface for abstracting iframe access — injectable for testing */
export interface PreviewController {
  start(entryPoint: string): Promise<{ url: string }>;
  stop(): void;
  isActive(): boolean;
  getDocument(): Document | null;
  getConsoleEntries(since?: number): Array<{ level: string; args: unknown[]; timestamp: number }>;
  getErrors(since?: number): Array<{ message: string; source?: string; line?: number; timestamp: number }>;
}

/** Extract structured data from a DOM element */
function serializeElement(el: Element): Record<string, any> {
  const rect = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const computed = win ? win.getComputedStyle(el) : null;

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: [...el.classList],
    attributes: Object.fromEntries(
      Array.from(el.attributes).map((a) => [a.name, a.value]),
    ),
    boundingRect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    computedStyles: computed
      ? {
          width: computed.width,
          height: computed.height,
          display: computed.display,
          position: computed.position,
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          fontSize: computed.fontSize,
        }
      : null,
    textContent: el.textContent?.substring(0, 200) ?? null,
    childCount: el.children.length,
  };
}

export function createAtuaPreviewProvider(controller: PreviewController): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'start': {
          const entryPoint = a.entryPoint ?? '/index.html';
          const result = await controller.start(entryPoint);
          return { content: { url: result.url, active: true } };
        }
        case 'stop': {
          if (!controller.isActive()) {
            return { content: 'No active preview to stop', isError: true };
          }
          controller.stop();
          return { content: { active: false } };
        }
        case 'dom.query': {
          const doc = controller.getDocument();
          if (!doc) {
            return { content: 'No active preview', isError: true };
          }
          const el = doc.querySelector(a.selector);
          if (!el) {
            return { content: { found: false, selector: a.selector } };
          }
          return { content: { found: true, element: serializeElement(el) } };
        }
        case 'dom.queryAll': {
          const doc = controller.getDocument();
          if (!doc) {
            return { content: 'No active preview', isError: true };
          }
          const els = doc.querySelectorAll(a.selector);
          return {
            content: {
              count: els.length,
              elements: Array.from(els).map(serializeElement),
            },
          };
        }
        case 'console': {
          return { content: controller.getConsoleEntries(a.since) };
        }
        case 'errors': {
          return { content: controller.getErrors(a.since) };
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
    capabilities: ['preview.dom', 'preview.console'],
  });
}
