/**
 * CapabilityGate — enforces declared capabilities for MCP servers.
 *
 * Each server declares what subsystems it may access (fs, network, db, proc, preview).
 * The gate checks every tool call against these declarations and throws
 * PermissionError on violations. Checked at dispatch time, not registration.
 */
import type { Capabilities } from '../hub/types.js';

// Tool names that write to the filesystem
const FS_WRITE_TOOLS = new Set([
  'atua.fs.write', 'atua.fs.mkdir', 'atua.fs.unlink', 'atua.fs.rmdir',
  'atua.fs.rename', 'atua.fs.copy', 'atua.fs.append',
]);

export class PermissionError extends Error {
  readonly capability: string;
  readonly tool: string;

  constructor(capability: string, tool: string, detail: string) {
    super(`PermissionError: Server lacks capability '${capability}' required by tool '${tool}': ${detail}`);
    this.name = 'PermissionError';
    this.capability = capability;
    this.tool = tool;
  }
}

export class CapabilityGate {
  private readonly _caps: Capabilities;

  constructor(capabilities: Capabilities) {
    this._caps = capabilities;
  }

  /**
   * Check whether a tool call is allowed under this gate's capabilities.
   * Throws PermissionError if the call violates declared capabilities.
   */
  checkToolCall(toolName: string, args: unknown): void {
    if (toolName.startsWith('atua.fs.')) {
      this._checkFs(toolName, args);
    } else if (toolName.startsWith('atua.net.')) {
      this._checkNetwork(toolName, args);
    } else if (toolName.startsWith('atua.d1.')) {
      this._checkDb(toolName);
    } else if (toolName.startsWith('atua.proc.')) {
      this._checkProc(toolName);
    } else if (toolName.startsWith('atua.preview.')) {
      this._checkPreview(toolName);
    }
    // Tools outside known namespaces are not gated (e.g. other server tools)
  }

  private _checkFs(toolName: string, args: unknown): void {
    const fsCap = this._caps.fs;

    if (fsCap === 'none') {
      throw new PermissionError('fs', toolName, 'filesystem access denied');
    }

    if (fsCap === undefined) {
      // No fs capability declared — deny by default
      throw new PermissionError('fs', toolName, 'no filesystem capability declared');
    }

    // Scoped fs access
    const scope = fsCap as { scope: string; write: boolean };

    // Check write permission
    if (FS_WRITE_TOOLS.has(toolName) && !scope.write) {
      throw new PermissionError('fs', toolName, 'write access denied');
    }

    // Check path scope
    const a = args as Record<string, any> | null;
    const path = a?.path ?? a?.src ?? a?.dest;
    if (typeof path === 'string' && !path.startsWith(scope.scope)) {
      throw new PermissionError(
        'fs', toolName,
        `path '${path}' is outside allowed scope '${scope.scope}'`,
      );
    }
  }

  private _checkNetwork(toolName: string, args: unknown): void {
    const netCap = this._caps.network;

    if (netCap === 'none') {
      throw new PermissionError('network', toolName, 'network access denied');
    }

    if (netCap === undefined) {
      throw new PermissionError('network', toolName, 'no network capability declared');
    }

    // Domain allow-list
    if (Array.isArray(netCap)) {
      const a = args as Record<string, any> | null;
      const url = a?.url;
      if (typeof url === 'string') {
        let domain: string;
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = url; // Treat raw string as domain
        }
        if (!netCap.includes(domain)) {
          throw new PermissionError(
            'network', toolName,
            `domain '${domain}' is not in allowed list [${netCap.join(', ')}]`,
          );
        }
      }
    }
  }

  private _checkDb(toolName: string): void {
    const dbCap = this._caps.db;

    if (dbCap === 'none' || dbCap === undefined) {
      throw new PermissionError('db', toolName, 'database access denied');
    }
    // dbCap === 'catalyst.d1' — allowed
  }

  private _checkProc(toolName: string): void {
    const procCap = this._caps.proc;

    if (procCap === 'none' || procCap === undefined) {
      throw new PermissionError('proc', toolName, 'process access denied');
    }

    const shortName = toolName.substring('atua.proc.'.length);

    // 'spawn' level allows exec and spawn but not kill
    if (procCap === 'spawn') {
      if (shortName === 'kill') {
        throw new PermissionError('proc', toolName, 'kill requires proc: "full"');
      }
    }
    // 'full' allows everything
  }

  private _checkPreview(toolName: string): void {
    if (this._caps.preview !== true) {
      throw new PermissionError('preview', toolName, 'preview access denied');
    }
  }
}
