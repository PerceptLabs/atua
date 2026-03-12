/**
 * Provider registry — manages namespace-to-provider mappings.
 *
 * Enforces namespace uniqueness and provides tool lookup by qualified name.
 */
import type {
  ProviderRegistration,
  ToolDefinition,
  ToolFilter,
  ProviderHealth,
  Transport,
} from './types.js';

export interface RegisteredProvider {
  namespace: string;
  tools: Map<string, ToolDefinition>;
  transport: Transport;
  capabilities: string[];
}

export class ProviderRegistry {
  private _providers = new Map<string, RegisteredProvider>();

  register(registration: ProviderRegistration): void {
    if (this._providers.has(registration.namespace)) {
      throw new Error(
        `Provider namespace '${registration.namespace}' is already registered. ` +
        `Unregister it first before re-registering.`
      );
    }

    const toolMap = new Map<string, ToolDefinition>();
    for (const tool of registration.tools) {
      toolMap.set(tool.name, tool);
    }

    this._providers.set(registration.namespace, {
      namespace: registration.namespace,
      tools: toolMap,
      transport: registration.transport,
      capabilities: registration.capabilities ?? [],
    });
  }

  unregister(namespace: string): void {
    const provider = this._providers.get(namespace);
    if (provider) {
      provider.transport.dispose();
      this._providers.delete(namespace);
    }
  }

  /**
   * Resolve a fully qualified tool name to its provider.
   * Tool name format: "{namespace}.{tool_name}"
   * Returns null if provider or tool not found.
   */
  resolve(qualifiedName: string): { provider: RegisteredProvider; toolDef: ToolDefinition } | null {
    const dotIndex = qualifiedName.indexOf('.');
    if (dotIndex === -1) return null;

    const namespace = qualifiedName.substring(0, dotIndex);
    const toolName = qualifiedName.substring(dotIndex + 1);

    // Handle nested namespaces (e.g. "atua.fs.read" → namespace "atua.fs", tool "read")
    // Try longest namespace match first
    for (const [ns, provider] of this._providers) {
      if (qualifiedName.startsWith(ns + '.')) {
        const tool = qualifiedName.substring(ns.length + 1);
        const fullToolName = ns + '.' + tool;
        const toolDef = provider.tools.get(fullToolName);
        if (toolDef) return { provider, toolDef };
      }
    }

    // Simple single-segment namespace fallback
    const provider = this._providers.get(namespace);
    if (!provider) return null;

    const toolDef = provider.tools.get(qualifiedName);
    if (!toolDef) return null;

    return { provider, toolDef };
  }

  listTools(filter?: ToolFilter): ToolDefinition[] {
    const result: ToolDefinition[] = [];

    for (const [ns, provider] of this._providers) {
      if (filter?.namespace && ns !== filter.namespace) continue;

      for (const [, toolDef] of provider.tools) {
        if (filter?.name && !toolDef.name.includes(filter.name)) continue;
        result.push(toolDef);
      }
    }

    return result;
  }

  getHealth(): Record<string, ProviderHealth> {
    const health: Record<string, ProviderHealth> = {};
    for (const [ns, provider] of this._providers) {
      health[ns] = {
        namespace: ns,
        status: 'active',
        toolCount: provider.tools.size,
      };
    }
    return health;
  }

  has(namespace: string): boolean {
    return this._providers.has(namespace);
  }

  get size(): number {
    return this._providers.size;
  }
}
