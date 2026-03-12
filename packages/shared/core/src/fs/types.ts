/**
 * CatalystFS type definitions
 */

/** Backend type for mount configuration */
export type BackendType = 'opfs' | 'memory' | 'indexeddb';

/** Mount configuration for a single path */
export interface MountConfig {
  backend: BackendType;
  persistent?: boolean;
}

/** Full filesystem configuration */
export interface CatalystFSConfig {
  /** Mount path -> backend config */
  mounts?: Record<string, MountConfig | BackendType>;
  /** Storage limits */
  limits?: {
    maxFileSize?: number;
    maxTotalStorage?: number;
  };
  /** Instance name (used for OPFS/IndexedDB namespace isolation) */
  name?: string;
}

/** File change event types */
export type WatchEventType = 'change' | 'rename';

/** Watch callback signature */
export type WatchCallback = (eventType: WatchEventType, filename: string) => void;

/** Dirent-like entry from readdir withFileTypes */
export interface FileEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
