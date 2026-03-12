# Atua — Master Plan Index

**Last updated:** 2026-03-11
**Purpose:** Single entry point for CC and humans. Read this first. It tells you what exists, what order to build, and where every spec lives.

---

## Directory Structure

```
C:\Users\v1sua\atua\plans\
├── README.md                    ← YOU ARE HERE
├── REVIEW.md                    ← TWO-STAGE REVIEW PROTOCOL — run after every phase
├── complete/                    ← Work CC already did (historical reference)
├── inprogress/                  ← Specs needing corrections before CC uses them
├── todo/                        ← Specs + plans ready for CC to execute
└── reference/                   ← Pi.dev docs, separate projects, not Atua specs
```

---

## Current State of the Codebase

**Repo:** `C:\Users\v1sua\Downloads\catalystlatest`
**Branch:** `claude/catalyst-phase-0-SyoeR`
**Stats:** 165 TypeScript files, 34,160 lines, 72 test files, 648 tests passing
**Naming:** Everything is still named Catalyst in code. Rename to Atua is pending.

### What's Built and Working

CatalystFS (OPFS filesystem, 480 lines), CatalystEngine/QuickJS (WASM JS engine, 530 lines), NodeCompatLoader (96.2% Node.js compat, 169 lines), ProcessManager (Worker isolation, 300 lines), CatalystKV (IndexedDB KV, 341 lines), CatalystR2 (OPFS R2, 349 lines), CatalystD1 (wa-sqlite D1), CatalystWorkers Runtime (route matching, 298 lines), BuildPipeline (esbuild-wasm), Hono Integration, CatalystShell (10 builtins, 541 lines), Sync Layer (2,675 lines), Workers Compliance Tests (6 files), Nitro Preset, Astro + SvelteKit Adapters, Package Split (@aspect/catalyst + @aspect/reaction).

### What's Scaffold or Hollow

ViteRunner (state machine only), DenoEngine (falls back to eval), DenoNativeLoader (all builtins throw), Reaction distribution (hollow engine), unenv-bridge (hand-rolled, never imports unenv).

### What Doesn't Exist Yet

Atua rename, Fabric MCP hub, Pi.dev integration, Hive multi-agent, Hashbrown UI, Build UI shell, AtuaBox, Transport layer, NanoClaw, Rolldown integration.

---

## Execution Order

### Track A: Runtime Foundation (Sequential)

```
Step 1: Rename Catalyst → Atua
Step 2: Swap Primitives (catalyst-roadma2p.md Phase 0)
Step 3: Fabric — MCP Hub (todo/atua-mcp-spec.md + todo/fabric-implementation-plan.md)
Step 4: Conductor — Pi.dev (todo/pi-atua-spec.md + todo/conductor-implementation-plan.md)
Step 5: Hive — Multi-Agent (todo/pi-hive-spec.md + todo/hive-implementation-plan.md)
```

### Track B: UI Layer (After Conductor)

```
Step 6: Sizzle — Hashbrown (todo/hashbrown-atua-spec.md + todo/sizzle-implementation-plan.md)
Step 7: Build UI Shell (todo/atua-build-ui-spec.md)
```

### Track C: Infrastructure (Independent)

```
Step 8: Transport (todo/atua-transport-spec.md + todo/atua-transport-implementation-plan.md)
Step 9: AtuaBox (todo/atuabox-spec.md)
Step 10: WASI Host (inprogress/atua-hyperkernel-spec.md — read clarification first)
```

### Track D: Post-Core (After Hive)

```
Step 11: NanoClaw (todo/atua-embedded-agent-spec.md + todo/embedded-agent-implementation-plan.md)
```

### Dependency Graph

```
Rename → Swap Primitives → Fabric ──→ Conductor ──→ Hive ──→ NanoClaw
                              │            │
                              │            └──→ Sizzle ──→ Build UI
                              │
                              └──→ Transport (parallel)
                              └──→ AtuaBox (parallel)
                              └──→ WASI Host (parallel)
```

---

## Architecture Correction Notice

**READ BEFORE IMPLEMENTING:** `atua-unified-spec.md` and `atua-hyperkernel-spec.md` claim "the hyperkernel is its core." This is wrong.

The actual architecture: Core is Browser V8 + unenv + browser APIs. The WASI host is ~500 lines TS for Rolldown/wa-sqlite. AtuaBox is v86 + Alpine for native binaries.

Read `inprogress/atua-architecture-clarification.md` for the full correction. The roadmap was already correct.

---

## CC Kickoff Protocol

Every CC session follows this exact sequence. No exceptions.

### Implementation Session

```
1. Read C:\Users\v1sua\atua\plans\README.md
2. Read C:\Users\v1sua\atua\plans\REVIEW.md (know the review criteria before writing code)
3. Read the spec from todo/
4. Read the companion implementation plan
5. Run the pre-flight checklist from the plan
6. Implement Phase N only
7. Run all verification gates
8. Commit: git add -A && git commit -m "[Step] Phase [N]: [description]"
9. Run REVIEW.md Stage 1 checks against the committed code
10. Run REVIEW.md Stage 2 checks
11. Commit the review outcome: git commit --allow-empty -m "Review Phase [N]: [PASS/BLOCKED] — [summary]"
```

Do not reference, examine, or search for WebContainers source code or any proprietary competing runtime code.

### Session Prompt Template

```
Read C:\Users\v1sua\atua\plans\README.md and C:\Users\v1sua\atua\plans\REVIEW.md first.

You are implementing [STEP NAME] Phase [N] for Atua.
Spec: C:\Users\v1sua\atua\plans\todo\[spec-file].md
Plan: C:\Users\v1sua\atua\plans\todo\[plan-file].md

Run the pre-flight checklist. Implement Phase [N] only.
Run all verification gates before committing.
After committing, run REVIEW.md Stage 1 and Stage 2 checks.
Commit the review outcome before ending the session.
```

### Review-Only Session Prompt

```
Read C:\Users\v1sua\atua\plans\REVIEW.md.
Read C:\Users\v1sua\atua\plans\README.md for architecture context.

Review the Phase [N] implementation of [package].
Spec: C:\Users\v1sua\atua\plans\todo\[spec-file].md
Plan: C:\Users\v1sua\atua\plans\todo\[plan-file].md
Code: C:\Users\v1sua\Downloads\catalystlatest\packages\[package]\src\

Run all Stage 1 and Stage 2 checks using bash commands against the actual code.
Do not summarize what the code does — run the grep commands, read the output, report findings.
Produce the Review Outcome block at the end.
```

---

## File Inventory

### complete/ (9 files) — Historical

catalyst-phase0-audit.md, catalyst-codebase-audit.md, catalyst-monorepo-plan.md, catalyst-tiered-engine-spec.md, catalyst-tiered-engine-addendum.md, catalyst-tiered-engine-plan.md, catalyst-workers-plan.md, catalyst-workers-roadmap.md, phase14-cc-kickoffs.md

### inprogress/ (6 files) — Needs Corrections

atua-unified-spec.md, atua-hyperkernel-spec.md, atua-implementation-plan.md, atua-architecture-clarification.md (READ FIRST), atua-runtime-execution-spec.md, catalyst-roadma2p.md

### todo/ (17 files) — Ready for CC

atua-mcp-spec.md + fabric-implementation-plan.md (Fabric), pi-atua-spec.md + conductor-implementation-plan.md (Conductor), pi-hive-spec.md + hive-implementation-plan.md + pi-hive-dual-mode-addendum.md (Hive), hashbrown-atua-spec.md + sizzle-implementation-plan.md (Sizzle), atua-build-ui-spec.md, atua-transport-spec.md + atua-transport-implementation-plan.md (Transport), atuabox-spec.md (AtuaBox), atua-embedded-agent-spec.md + embedded-agent-implementation-plan.md (NanoClaw)

### reference/ (5 files)

AGENTSpi.md, extensions.md, sdk.md, packages.md, new2PLAN.md
