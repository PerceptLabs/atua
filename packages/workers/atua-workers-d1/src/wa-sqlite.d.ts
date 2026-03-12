declare module 'wa-sqlite/dist/wa-sqlite-async.mjs' {
  const mod: any;
  export default mod;
}

declare module 'wa-sqlite/src/sqlite-api.js' {
  export const Factory: (module: any) => any;
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  export class IDBBatchAtomicVFS {
    constructor(name?: string, options?: any);
  }
}
