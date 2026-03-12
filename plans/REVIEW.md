# Atua — Phase Review Protocol

**Purpose:** Two-stage review between phases. Stage 1 (spec compliance) runs after every phase commit. Stage 2 (code quality) runs before advancing to the next phase. Both must pass.

**This file is not optional.** Every implementation plan references it. CC must read and execute this before any cross-phase commit.

---

## When to Run

Run this review after every phase commit and before starting the next phase:

```
Phase N implementation → commit → REVIEW.md Stage 1 → REVIEW.md Stage 2 → Phase N+1
```

Do not start the next phase if Stage 2 has any blocking findings.

---

## Stage 1: Spec Compliance

*Did CC build what the spec said to build?*

### 1.1 — Interface Contracts

For every exported type, class, and function in the phase:

```bash
# Grep the spec for the interface name
grep -n "interface\|type\|export" [spec-file].md | grep [ClassName]

# Grep the implementation
grep -n "interface\|type\|export" packages/[package]/src/[file].ts | grep [ClassName]
```

**Check:**
- Every field in the spec's interface exists in the implementation
- No extra fields were invented that the spec doesn't mention
- Method signatures match: parameter names, types, return types
- Optional fields marked `?` in spec are optional in code (not secretly required)

**Blocking if:** Any spec interface has a field or method missing from the implementation.

### 1.2 — No Stubs Masquerading as Implementations

```bash
grep -rn "TODO\|FIXME\|throw new Error('Not implemented')\|throw new Error('not implemented')\|// stub\|// placeholder\|return {}\|return \[\]\|() => {}" \
  packages/[package]/src/ --include="*.ts" \
  | grep -v "\.test\.\|\.spec\.\|test-fixtures"
```

**Check every hit.** For each:
- Is it in test code? → OK
- Is it in source code with a comment explaining it's deferred to a future phase? → Document it, continue
- Is it silently returning empty data where real data should flow? → **Blocking**

**Blocking if:** Any stub in a non-test file with no phase attribution comment.

### 1.3 — Verification Gates Passed

Every implementation plan phase has a verification gate checklist. Confirm all items ran and passed.

```bash
# Check test output
pnpm test --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL|skip"
```

**For browser-specific tests (OPFS, Service Worker, MessageChannel, iframe DOM):**

```bash
pnpm test:browser 2>&1 | grep -E "✓|✗|PASS|FAIL|skip"
```

Tests that are marked skip with `// browser-only — cannot run in Node` are acceptable. Tests that are silently not running (no output, no skip marker) are not.

**Blocking if:** Any verification gate item is absent from test output (neither pass nor documented skip).

### 1.4 — Cross-Provider Calls Route Through Hub

This is Atua's central architectural rule. Subsystems never import each other directly. All cross-subsystem calls go through the MCP hub.

```bash
# Find direct cross-package imports in new code
grep -rn "from '@aspect/atua-fs'\|from '@aspect/atua-d1'\|from '@aspect/atua-proc'" \
  packages/atua-fabric/src/ \
  packages/pi-atua/src/ \
  --include="*.ts" \
  | grep -v "types\|interface\|test"
```

**Check:** Any import of a sibling Atua package in a package that should be using the hub is a violation.

**Allowed exceptions:**
- Type-only imports (`import type { AtuaFS } from ...`) — OK, types don't create runtime coupling
- `packages/atua-fabric/src/providers/` — providers wrap subsystems directly by design. Wrappers import their one subsystem.
- Test files importing test fixtures

**Blocking if:** Any runtime import of a sibling package where a hub call should be used instead.

### 1.5 — Browser Runtime Compliance

Atua runs in Chrome 120+. No Node.js runtime is available.

```bash
# Hunt for Node.js APIs that won't exist in browser
grep -rn "require(\|process\.\|__dirname\|__filename\|Buffer\.\|path\.\|fs\.\|os\.\|crypto\.createHash\|child_process\|net\.Socket" \
  packages/[package]/src/ --include="*.ts" \
  | grep -v "// node-only\|unenv\|mock\|test"
```

**Check every hit:**
- `require(` → Must be converted to ESM `import` or flagged as dead code
- `process.env` → Use `import.meta.env` instead, or read from `AtuaAuthStorage`
- `Buffer` → Use `Uint8Array` or `TextEncoder`/`TextDecoder`
- `path.join` → Use string concatenation or a browser-compatible path util
- `crypto.createHash` → Use `crypto.subtle.digest` (Web Crypto API)

**Blocking if:** Any unshimmed Node.js API in non-test source files.

---

## Stage 2: Code Quality

*Is the code production-ready, or will it cause problems in 3 months?*

### 2.1 — Error Handling

For every `async` function and every call to a browser API:

```bash
grep -rn "await\|\.then(" packages/[package]/src/ --include="*.ts" \
  | grep -v "try\|catch\|\.catch\|test"
```

**Check:** Uncaught promises. Every `await` that can throw should be inside a try/catch or have a `.catch()` handler. The specific exceptions:
- `await hub.callTool(...)` — always wrap. Providers can fail in ways that must not crash the caller.
- `await OPFS operations` — always wrap. OPFS throws on quota exceeded, file not found, etc.
- `await fetch(...)` — always wrap. Network is unreliable.
- `new Worker(blobUrl)` — always check `worker.onerror` is wired.
- `await import(url)` — always wrap. Dynamic imports can fail if the module throws during evaluation.

**Blocking if:** Any async browser API call without error handling in production code.

### 2.2 — Resource Cleanup

```bash
grep -rn "new Worker\|URL.createObjectURL\|new BroadcastChannel\|new MessageChannel\|addEventListener\|setInterval\|setTimeout" \
  packages/[package]/src/ --include="*.ts" | grep -v test
```

For each hit, verify there is a corresponding cleanup path:
- `new Worker(url)` → `worker.terminate()` called on shutdown
- `URL.createObjectURL(blob)` → `URL.revokeObjectURL(url)` called after use
- `new BroadcastChannel(name)` → `channel.close()` on cleanup
- `MessagePort` → `port.close()` on cleanup
- `addEventListener` → `removeEventListener` in cleanup
- `setInterval` / `setTimeout` → cleared in cleanup

**Blocking if:** Any Worker, object URL, or MessagePort with no cleanup path.

### 2.3 — No Simplification Shortcuts

Check for the class of "easy out" implementations CC tends to produce when a real implementation is hard:

```bash
# Things that look real but aren't
grep -rn "Math.random()\|Date.now()\|crypto.randomUUID()" \
  packages/[package]/src/ --include="*.ts" | grep -v "id\|uuid\|token\|nonce\|test"

# Check that streaming returns real streams, not buffered-then-faked
grep -rn "ReadableStream\|AsyncIterable\|AsyncGenerator" \
  packages/[package]/src/ --include="*.ts"
```

Common shortcuts to flag:
- **Mock timing:** `await new Promise(r => setTimeout(r, 100))` used to simulate async work instead of waiting for real completion
- **Buffer-then-fake-stream:** Building full response in memory, then creating a `ReadableStream` that emits it all at once — not real streaming
- **Ignored args:** Function accepts `options` but silently ignores fields (check with grep for unused parameters)
- **Always-success returns:** Functions that return `{ success: true }` without actually verifying the operation succeeded

**Blocking if:** Any fake timing, fake streaming, or silently ignored required parameters.

### 2.4 — MCP Tool Schema Completeness

For every registered MCP tool:

```bash
grep -rn "registerTool\|ToolDefinition\|tools:" packages/[package]/src/ --include="*.ts" | grep -v test
```

For each tool definition, verify:
- Every parameter has a type annotation
- Required parameters are not marked optional
- `description` field is present and meaningful (not "calls X" — explain what it does and what it returns)
- Return type is documented or inferable from the implementation

**Blocking if:** Any tool with missing parameter types or an empty/placeholder description.

### 2.5 — Test Isolation

```bash
grep -rn "global\.\|window\.\|self\.\|globalThis\." \
  packages/[package]/src/[feature].test.ts --include="*.ts"
```

Browser tests must not share global state between test cases. Each test should:
- Create its own hub instance
- Create its own OPFS namespace (use unique prefix per test)
- Not depend on execution order

```bash
# Check for shared state between tests
grep -rn "beforeAll\|afterAll" packages/[package]/src/*.test.ts
```

`beforeAll`/`afterAll` that create shared state across tests is a red flag. Prefer `beforeEach`/`afterEach` with fresh instances.

**Non-blocking but must be documented** if any test uses `beforeAll` with shared state — add a comment explaining why it's necessary.

---

## Atua-Specific Red Flags

These patterns are wrong in this codebase. Flag any occurrence immediately:

| Pattern | Why it's wrong | What to do instead |
|---|---|---|
| `import { CatalystFS } from '@aspect/atua-fs'` inside Fabric or Conductor | Breaks hub routing — direct coupling | Route through `hub.callTool('atuafs.read', ...)` |
| `eval(code)` on main thread | Blocks UI, no isolation | Use Worker + `new Function` inside Worker |
| `localStorage` or `sessionStorage` | 5MB limit, sync, not shared workers | Use OPFS via AtuaFS |
| `XMLHttpRequest` | Legacy, no streaming | Use `fetch()` |
| `import 'node:fs'` | Not available in browser | Route through AtuaFS provider |
| Long-polling for Worker results | Busy-waits, burns CPU | Use `MessageChannel` + `onmessage` |
| `vi.fn()` wrapping the function under test | Test tests nothing | Test real behavior |
| Playwright `page.evaluate()` that returns hardcoded values | Skips browser verification | Must run real browser code |

---

## Review Outcome

At the end of Stage 2, produce a one-paragraph summary:

```
REVIEW: Phase [N] — [package] — [date]
Stage 1: [PASS / BLOCKED: list items]
Stage 2: [PASS / BLOCKED: list items]
Non-blocking findings: [list or "none"]
Decision: [ADVANCE to Phase N+1 / BLOCKED — fix before advancing]
```

Write this summary as a comment in the last commit of the phase:

```bash
git commit --allow-empty -m "Review Phase [N]: [PASS/BLOCKED] — [one sentence summary]"
```

If BLOCKED: do not advance. Fix the blocking items, re-run the relevant verification gates, commit the fixes, and run Stage 2 again.

---

## Kickoff for Review Sessions

When running a review session (not an implementation session), the prompt is:

```
Read C:\Users\v1sua\atua\plans\REVIEW.md.
Read C:\Users\v1sua\atua\plans\README.md for architecture context.

Review the Phase [N] implementation of [package].
Spec: C:\Users\v1sua\atua\plans\todo\[spec-file].md
Plan: C:\Users\v1sua\atua\plans\todo\[plan-file].md
Code: C:\Users\v1sua\Downloads\catalystlatest\packages\[package]\src\

Run all Stage 1 and Stage 2 checks from REVIEW.md using bash commands against the actual code.
Do not summarize what the code does. Run the grep commands. Read the output. Report findings.
Produce the Review Outcome block at the end.
```
