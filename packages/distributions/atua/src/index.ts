/**
 * @aspect/atua — Distribution package for Workers mode
 *
 * Re-exports the complete Atua runtime with native V8 execution
 * and NodeCompatLoader pre-wired. Consumers import from this
 * package for the standard Workers-compatible experience.
 *
 * Usage:
 *   import { Atua, createRuntime } from '@aspect/atua';
 *   const runtime = await createRuntime({ name: 'my-app' });
 */

// Core runtime
export {
  // Top-level factory
  Atua,
  createRuntime,
  // Legacy engine (kept for backward compat)
  AtuaEngine,
  NodeCompatLoader,
  // Filesystem
  AtuaFS,
  // Network
  FetchProxy,
  // Process management
  ProcessManager,
  AtuaProcess,
  // Package management
  PackageManager,
  PackageCache,
  PackageFetcher,
  NpmResolver,
  PackageJson,
  Lockfile,
  Semver,
  // Build pipeline
  BuildPipeline,
  ContentHashCache,
  HMRManager,
  PassthroughTranspiler,
  EsbuildTranspiler,
  HonoIntegration,
  // WASI
  AtuaWASI,
  WASIBindings,
  WASI_ERRNO,
  BinaryCache,
  // Sync
  SyncClient,
  SyncServer,
  OperationJournal,
  ConflictResolver,
  PROTOCOL_VERSION,
  generateOpId,
  // Engines — native V8
  NativeEngine,
  NativeModuleLoader,
  // Validation
  analyzeCode,
  checkCode,
  validateImports,
  // HTTP server
  AtuaHTTPServer,
  createHTTPServer,
  getHTTPModuleSource,
  // DNS
  AtuaDNS,
  getDNSModuleSource,
  // TCP / TLS
  AtuaTCPSocket,
  AtuaTCPServer,
  createConnection,
  getNetModuleSource,
  tlsConnect,
  createTLSServer,
  getTLSModuleSource,
  // Process pipelines & cluster
  pipeProcesses,
  pipeToFile,
  pipeFromFile,
  teeProcess,
  collectOutput,
  collectErrors,
  AtuaCluster,
  getClusterModuleSource,
  // Package — addons
  AddonRegistry,
  NpmProcessRunner,
  // Execution contexts
  InlineContext,
  WorkerContext,
  ContextRouter,
  // Compat
  WorkersComplianceGate,
  // Version
  VERSION,
} from '@aspect/atua-core';

// Re-export all types
export type {
  AtuaConfig,
  EngineConfig,
  ConsoleLevel,
  IEngine,
  IModuleLoader,
  EngineFactory,
  ModuleLoaderFactory,
  EngineInstanceConfig,
  EngineCapabilities,
  ModuleResolution,
  ModuleLoaderCapabilities,
  ModuleLoaderConfig,
  FetchProxyConfig,
  SerializedRequest,
  SerializedResponse,
  ProcessOptions,
  ExecResult,
  Signal,
  ProcessState,
  PackageInfo,
  PackageManagerConfig,
  CacheEntry,
  PackageCacheConfig,
  FetchedPackage,
  PackageFetcherConfig,
  ResolvedPackage,
  NpmResolverConfig,
  PackageJsonData,
  LockfileData,
  LockfileEntry,
  BuildConfig,
  BuildResult,
  BuildError,
  Transpiler,
  HMREvent,
  HonoIntegrationConfig,
  HonoBuildResult,
  WASIExecConfig,
  WASIExecResult,
  AtuaWASIConfig,
  WASIConfig,
  BinaryCacheEntry,
  BinaryCacheConfig,
  SyncClientConfig,
  SyncServerConfig,
  JournalConfig,
  ConflictInfo,
  ConflictResolution,
  ConflictStrategy,
  FileOperation,
  SyncMessage,
  ConnectionState,
  SyncResult,
  // Engines
  NativeEngineConfig,
  // Validation
  AnalysisResult,
  ASTCheckResult,
  ASTViolation,
  ImportValidationResult,
  BlockedImport,
  // HTTP
  RequestHandler,
  SerializedHTTPRequest,
  SerializedHTTPResponse,
  // DNS
  DNSConfig,
  // TCP / TLS
  TCPConnectionOptions,
  TLSConnectionOptions,
  // Cluster
  ClusterWorker,
  ClusterSettings,
  // Package — addons
  AddonEntry,
  NpmProcessRunnerConfig,
  ScriptRunResult,
  ScriptPhase,
  // Execution contexts
  ExecutionContext,
  EvalOpts,
  SpawnOpts,
  ExecContextResult,
  ProcessContextResult,
  ContextStatus,
  WorkerContextConfig,
  ExecRequest,
  ContextRouterConfig,
  // Compat
  ComplianceResult,
  ComplianceError,
  ComplianceWarning,
} from '@aspect/atua-core';
