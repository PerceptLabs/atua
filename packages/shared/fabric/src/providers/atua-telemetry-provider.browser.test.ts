/**
 * atua.telemetry MCP Provider tests (browser-only)
 *
 * Uses a mock Performance object to test tool registration and data paths.
 * Full Web Vitals tests require a real browser with navigation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaTelemetryProvider } from './atua-telemetry-provider.js';

/** Minimal mock Performance for testing */
function createMockPerformance(): Performance {
  return {
    getEntriesByType(type: string) {
      if (type === 'mark') {
        return [
          { name: 'test-mark', startTime: 100, duration: 0, entryType: 'mark', toJSON: () => ({}) },
        ] as any;
      }
      if (type === 'measure') {
        return [
          { name: 'test-measure', startTime: 50, duration: 200, entryType: 'measure', toJSON: () => ({}) },
        ] as any;
      }
      if (type === 'navigation') {
        return [
          {
            name: 'document',
            startTime: 0,
            duration: 500,
            entryType: 'navigation',
            type: 'navigate',
            redirectCount: 0,
            domContentLoadedEventEnd: 300,
            loadEventEnd: 500,
            toJSON: () => ({}),
          },
        ] as any;
      }
      if (type === 'paint') {
        return [
          { name: 'first-paint', startTime: 150, entryType: 'paint', duration: 0, toJSON: () => ({}) },
          { name: 'first-contentful-paint', startTime: 200, entryType: 'paint', duration: 0, toJSON: () => ({}) },
        ] as any;
      }
      if (type === 'resource') {
        return [
          {
            name: 'https://example.com/style.css',
            startTime: 50,
            duration: 100,
            transferSize: 1024,
            encodedBodySize: 1024,
            initiatorType: 'link',
            entryType: 'resource',
            toJSON: () => ({}),
          },
        ] as any;
      }
      return [];
    },
  } as any;
}

describe('atua.telemetry Provider', () => {
  let hub: MCPHub;

  beforeEach(() => {
    hub = new MCPHub();
    hub.registerProvider(createAtuaTelemetryProvider(createMockPerformance()));
  });

  describe('tool registration', () => {
    it('should register all 5 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.telemetry' });
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.telemetry.webvitals');
      expect(names).toContain('atua.telemetry.resources');
      expect(names).toContain('atua.telemetry.memory');
      expect(names).toContain('atua.telemetry.marks');
      expect(names).toContain('atua.telemetry.timing');
    });
  });

  describe('marks', () => {
    it('should return marks and measures', async () => {
      const result = await hub.callTool('atua.telemetry.marks', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.marks).toHaveLength(1);
      expect(content.marks[0].name).toBe('test-mark');
      expect(content.measures).toHaveLength(1);
      expect(content.measures[0].name).toBe('test-measure');
      expect(content.measures[0].duration).toBe(200);
    });

    it('should filter by name', async () => {
      const result = await hub.callTool('atua.telemetry.marks', { name: 'nonexistent' });
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.marks).toHaveLength(0);
      expect(content.measures).toHaveLength(0);
    });
  });

  describe('timing', () => {
    it('should return navigation and paint timing', async () => {
      const result = await hub.callTool('atua.telemetry.timing', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.navigation).toHaveLength(1);
      expect(content.navigation[0].type).toBe('navigate');
      expect(content.paint).toHaveLength(2);
      expect(content.paint[0].name).toBe('first-paint');
      expect(content.paint[1].name).toBe('first-contentful-paint');
    });
  });

  describe('resources', () => {
    it('should return resource entries', async () => {
      const result = await hub.callTool('atua.telemetry.resources', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content).toHaveLength(1);
      expect(content[0].name).toBe('https://example.com/style.css');
      expect(content[0].transferSize).toBe(1024);
    });
  });

  describe('memory', () => {
    it('should return unavailable when measureUserAgentSpecificMemory is missing', async () => {
      const result = await hub.callTool('atua.telemetry.memory', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.available).toBe(false);
      expect(content.reason).toContain('cross-origin isolation');
    });
  });

  describe('webvitals', () => {
    it('should return collected vitals (empty without observers)', async () => {
      const result = await hub.callTool('atua.telemetry.webvitals', {});
      expect(result.isError).toBeUndefined();
      // Vitals will be empty since mock Performance doesn't have PerformanceObserver
      expect(result.content).toBeDefined();
    });
  });

  describe('transaction logging', () => {
    it('should log telemetry calls', async () => {
      await hub.callTool('atua.telemetry.marks', {}, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.telemetry' });
      expect(log).toHaveLength(1);
      expect(log[0].tool).toBe('atua.telemetry.marks');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
