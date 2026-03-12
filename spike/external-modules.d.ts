/**
 * Type shims for external modules used in spike tests.
 * These packages may not be installed — the spike file just needs to type-check.
 */
declare module '@zenfs/core' {
  export function configure(options: any): Promise<void>;
  export const fs: {
    writeFileSync(path: string, data: string): void;
    readFileSync(path: string, encoding: string): string;
    mkdirSync(path: string, options?: any): void;
    readdirSync(path: string): string[];
  };
  export const InMemory: any;
}

declare module 'quickjs-emscripten' {
  export function getQuickJS(): Promise<any>;
}
