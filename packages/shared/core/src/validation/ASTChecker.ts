/**
 * ASTChecker — Walk parsed code for suspicious patterns
 *
 * Uses simple regex + token-based analysis (no external AST parser dependency).
 * Detects:
 * - eval() calls
 * - Function constructor abuse
 * - Prototype pollution (__proto__, constructor.constructor)
 * - Browser globals access (window, document, navigator)
 * - Dynamic imports with computed paths
 */

export interface ASTCheckResult {
  safe: boolean;
  violations: ASTViolation[];
}

export interface ASTViolation {
  type: 'eval' | 'function-constructor' | 'prototype-pollution' | 'browser-global' | 'dynamic-import';
  message: string;
  line?: number;
  column?: number;
}

/** Patterns that indicate dangerous code */
const PATTERNS: Array<{ type: ASTViolation['type']; pattern: RegExp; message: string }> = [
  {
    type: 'eval',
    pattern: /\beval\s*\(/g,
    message: 'Use of eval() is not allowed — it enables arbitrary code execution',
  },
  {
    type: 'function-constructor',
    pattern: /\bnew\s+Function\s*\(/g,
    message: 'new Function() constructor is not allowed — it enables arbitrary code execution',
  },
  {
    type: 'function-constructor',
    pattern: /\bFunction\s*\(\s*['"]/g,
    message: 'Function() constructor is not allowed — it enables arbitrary code execution',
  },
  {
    type: 'prototype-pollution',
    pattern: /\b__proto__\b/g,
    message: '__proto__ access detected — potential prototype pollution',
  },
  {
    type: 'prototype-pollution',
    pattern: /\bconstructor\s*\[\s*['"]constructor['"]\s*\]/g,
    message: 'constructor.constructor access detected — potential prototype pollution',
  },
  {
    type: 'prototype-pollution',
    pattern: /\bObject\s*\.\s*setPrototypeOf\b/g,
    message: 'Object.setPrototypeOf() detected — potential prototype pollution',
  },
  {
    type: 'browser-global',
    pattern: /\bwindow\s*\./g,
    message: 'window global access is not allowed in sandboxed environment',
  },
  {
    type: 'browser-global',
    pattern: /\bdocument\s*\./g,
    message: 'document global access is not allowed in sandboxed environment',
  },
  {
    type: 'dynamic-import',
    pattern: /\bimport\s*\(\s*[^'"]/g,
    message: 'Dynamic import with computed path is not allowed',
  },
];

/**
 * Check code for suspicious patterns.
 * Returns violations found, or empty array if code is clean.
 */
export function checkCode(code: string): ASTCheckResult {
  const violations: ASTViolation[] = [];
  const lines = code.split('\n');

  for (const patternDef of PATTERNS) {
    // Reset regex
    patternDef.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = patternDef.pattern.exec(code)) !== null) {
      // Check if the match is inside a comment or string
      const position = match.index;
      if (isInComment(code, position) || isInString(code, position)) {
        continue;
      }

      // Find line number
      const lineInfo = getLineNumber(code, position);

      violations.push({
        type: patternDef.type,
        message: patternDef.message,
        line: lineInfo.line,
        column: lineInfo.column,
      });
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/** Check if a position is inside a single-line or multi-line comment */
function isInComment(code: string, position: number): boolean {
  // Check for single-line comment
  const lineStart = code.lastIndexOf('\n', position - 1) + 1;
  const lineUpToPosition = code.substring(lineStart, position);
  if (lineUpToPosition.includes('//')) {
    const commentStart = lineUpToPosition.indexOf('//');
    if (commentStart < position - lineStart) return true;
  }

  // Check for multi-line comment
  let inMultiline = false;
  let i = 0;
  while (i < position) {
    if (code[i] === '/' && code[i + 1] === '*') {
      inMultiline = true;
      i += 2;
    } else if (code[i] === '*' && code[i + 1] === '/') {
      inMultiline = false;
      i += 2;
    } else {
      i++;
    }
  }
  return inMultiline;
}

/** Check if a position is inside a string literal */
function isInString(code: string, position: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = 0; i < position; i++) {
    const ch = code[i];
    const prev = i > 0 ? code[i - 1] : '';

    if (prev === '\\') continue;

    if (ch === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) inTemplate = !inTemplate;
  }

  return inSingle || inDouble || inTemplate;
}

/** Get line and column number for a position in code */
function getLineNumber(code: string, position: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;

  for (let i = 0; i < position; i++) {
    if (code[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }

  return { line, column: position - lastNewline };
}
