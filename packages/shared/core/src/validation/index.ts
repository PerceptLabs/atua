// Static analysis — replaces CodeValidator + SandboxRunner
export { analyzeCode } from './StaticAnalysis.js';
export type { AnalysisResult } from './StaticAnalysis.js';

// AST checker and import validator — independent of QuickJS, kept
export { checkCode } from './ASTChecker.js';
export type { ASTCheckResult, ASTViolation } from './ASTChecker.js';
export { validateImports } from './ImportGraphValidator.js';
export type { ImportValidationResult, BlockedImport } from './ImportGraphValidator.js';

