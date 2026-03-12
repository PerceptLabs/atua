/**
 * @aspect/catalyst — Distribution package for Workers mode
 *
 * Re-exports the complete Catalyst runtime with QuickJS engine
 * and NodeCompatLoader pre-wired. Consumers import from this
 * package for the standard Workers-compatible experience.
 *
 * Usage:
 *   import { Catalyst, createRuntime } from '@aspect/catalyst';
 *   const runtime = await createRuntime({ name: 'my-app' });
 */

// Core runtime
export {
  // Top-level factory
  Catalyst,
  createRuntime,
  // Engine
  CatalystEngine,
  NodeCompatLoader,
  // Filesystem
  CatalystFS,
  // Network
  FetchProxy,
  // Process management
  ProcessManager,
  CatalystProcess,
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
  CatalystWASI,
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
  // Engines — tiered architecture
  QuickJSEngine,
  NativeEngine,
  NativeModuleLoader,
  TieredEngine,
  // Validation
  CodeValidator,
  checkCode,
  validateImports,
  runInSandbox,
  // HTTP server
  CatalystHTTPServer,
  createHTTPServer,
  getHTTPModuleSource,
  // DNS
  CatalystDNS,
  getDNSModuleSource,
  // TCP / TLS
  CatalystTCPSocket,
  CatalystTCPServer,
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
  CatalystCluster,
  getClusterModuleSource,
  // Package — registry & addons
  NpmRegistryClient,
  AddonRegistry,
  NpmProcessRunner,
  // Compat
  WorkersComplianceGate,
  // Version
  VERSION,
} from '@aspect/catalyst-core';

// Re-export all types
export type {
  CatalystConfig,
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
  CatalystWASIConfig,
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
  EngineType,
  // Engines
  NativeEngineConfig,
  TieredEngineConfig,
  // Validation
  ValidationResult,
  ValidatorConfig,
  ASTCheckResult,
  ASTViolation,
  ImportValidationResult,
  BlockedImport,
  SandboxRunResult,
  SandboxRunConfig,
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
  // Package — registry & addons
  NpmRegistryConfig,
  PackageMetadata,
  InstallResult,
  AddonEntry,
  NpmProcessRunnerConfig,
  ScriptRunResult,
  ScriptPhase,
  // Compat
  ComplianceResult,
  ComplianceError,
  ComplianceWarning,
} from '@aspect/catalyst-core';
