// CatalystProc — Process management layer
export { ProcessManager } from './ProcessManager.js';
export { AtuaProcess } from './AtuaProcess.js';
export type { ProcessOptions, ExecResult, ProcessManagerConfig } from './ProcessManager.js';
export type { Signal, ProcessState } from './AtuaProcess.js';
export { getWorkerSource, SIGNALS } from './worker-template.js';
export type { WorkerMessage, WorkerResponse } from './worker-template.js';
export { pipeProcesses, pipeToFile, pipeFromFile, teeProcess, collectOutput, collectErrors } from './ProcessPipeline.js';
export type { PipeOptions } from './ProcessPipeline.js';
export { AtuaCluster, getClusterModuleSource } from './AtuaCluster.js';
export type { ClusterWorker, ClusterSettings } from './AtuaCluster.js';
