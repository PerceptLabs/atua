# AtuaBox

**Package:** `@aspect/atua-box`
**Status:** Draft
**Date:** 2026-03-09
**Depends on:** Atua hyperkernel, Fabric hub, AtuaFS

---

## What AtuaBox Is

AtuaBox is real Linux inside the browser. It boots Alpine Linux on the v86 x86 emulator (BSD, JIT, proven by Apptron) and exposes it through the same MCP tool interface as every other Atua subsystem. The agent doesn't manage a VM — it calls `box.exec("apk add imagemagick && convert logo.png -resize 128x128 thumb.png")` and gets output back.

AtuaBox exists because the hyperkernel can only run things compiled to WASI. When the agent needs `gcc`, `imagemagick`, `ffmpeg`, `git` with SSH, or any precompiled Linux binary, it escalates to AtuaBox. The hyperkernel is the fast path. AtuaBox is the escape hatch.

Zero bytes load until something needs it.

---

## What AtuaBox Is Not

Not a replacement for the hyperkernel. Not a VM the user manages. Not required. Not default. Not a Docker runtime.

---

## Architecture

```
Atua Hyperkernel (fast, ~30KB WASM)        AtuaBox (compatible, ~35MB image)
├── Rolldown, wa-sqlite, Pyodide            ├── v86 x86 JIT emulator
├── WASI guest processes                    ├── Alpine Linux 32-bit
├── ~1ms spawn                              ├── ~2s from snapshot, ~15s cold
└── 95% of work happens here                └── apk add anything
         │                                           │
         └────── both read/write AtuaFS (OPFS) ──────┘
                           │
                    Fabric MCP Hub
                    (uniform tool interface)
```

AtuaBox shares the project filesystem with the hyperkernel via virtio-9p. Files the agent writes through the hyperkernel appear inside Linux at `/mnt/project`. Files Linux writes appear in AtuaFS. No copy step. The filesystem is the bridge.

---

## Guest OS

Alpine Linux i386. ~5MB compressed base, ~35MB with dev tools pre-installed. 30,000+ packages via `apk`. Everything development needs: gcc, g++, make, python3, node, git, curl, sqlite, jq, vim. Agent runs `apk add` for anything domain-specific (imagemagick, ffmpeg, texlive, rust, go).

Why i386 not x86_64: v86 emulates 32-bit x86 with JIT (fast). The open-source 64-bit emulators are either interpreted (slow) or proprietary (Bellard's new JSLinux x86_64 layer — source not published). Alpine's i386 port covers virtually all dev tools. The 32-bit limitation rarely matters in practice.

---

## Bridge

### Filesystem — virtio-9p

v86 supports Plan 9 filesystem protocol. AtuaBox mounts three directories bridged to AtuaFS:

| Guest path | Host backing | Mode |
|---|---|---|
| `/mnt/project` | AtuaFS: current project directory | read/write |
| `/mnt/home` | AtuaFS: `/.atua/box/home` | read/write |
| `/mnt/out` | AtuaFS: `/.atua/box/output` | write |

The 9p server is a small TypeScript class (~200 lines) that translates 9p protocol operations to AtuaFS read/write calls.

### Commands — Serial Console

The agent sends commands to Linux via serial port (COM1) and reads output with a sentinel pattern:

```typescript
async exec(command: string, timeoutMs = 60_000): Promise<{ stdout: string; exitCode: number }> {
  const sentinel = `__ATUA_${Date.now()}__`;
  this.send(`${command}; echo "${sentinel}:$?"\n`);
  // Wait for sentinel in output, parse exit code
}
```

No terminal emulation. No TTY complexity. Clean request/response.

### Networking

v86 emulates a NE2000 NIC. Traffic routes through a WebSocket relay (same `relay.atua.dev` the hyperkernel uses). Guest Linux gets DHCP, DNS, full internet — `apk update`, `git clone`, `curl` all work.

---

## Snapshots

The difference between 15-second cold boot and 2-second restore. v86 saves entire machine state (CPU, RAM, devices) to a binary blob. AtuaBox stores snapshots in IndexedDB.

| Tier | What | Size | Restore |
|---|---|---|---|
| `base` | Alpine booted, shell ready, mounts active | ~15MB | ~2s |
| `dev` | base + Node.js + Python + common tools verified | ~25MB | ~2s |
| `project-{hash}` | dev + project-specific packages | ~20-50MB | ~2s |

Shipped with Atua: `base` and `dev` snapshots. Agent auto-saves `project-*` snapshots after first setup so the second session is instant. Old snapshots pruned when storage pressure detected.

---

## MCP Tools

AtuaBox registers on the Fabric hub like every other subsystem. The agent calls the same tool interface it uses for everything else.

```
box.spawn     — { snapshot?, packages? } → boots or restores AtuaBox
box.exec      — { command, cwd?, timeoutMs? } → { stdout, stderr, exitCode }
box.snapshot  — { name } → saves current state
box.destroy   — {} → tears down instance, frees memory
box.status    — {} → { running, memoryMB, uptime }
```

External MCP clients (Claude Code, etc.) get these tools automatically when connecting to `agent.atua.dev`.

---

## Agent Escalation

The agent doesn't randomly spawn Linux. It follows a simple rule:

```
Can the hyperkernel handle this? → Yes → Use hyperkernel (fast)
                                  → No  → Spawn AtuaBox (compatible)
```

The agent learns. First time it encounters `imagemagick` and the hyperkernel fails (ENOENT), it retries in AtuaBox, succeeds, and records `"convert|mogrify → requires atuabox"` in its skill memory. Next time it routes directly.

---

## Security

Three nested isolation layers:

1. **Browser sandbox.** v86 runs as JS/WASM. Cannot access real filesystem, network, or hardware.
2. **WASM linear memory.** Guest Linux exists entirely within a WASM memory buffer. Out-of-bounds access is structurally impossible.
3. **Controlled apertures.** Guest only sees 9p-mounted directories. No OPFS, no IndexedDB, no browser APIs, no DOM.

Guest is ephemeral by default. Base image resets on page load. Only 9p-mounted directories persist. Like Docker — changes not committed are gone.

---

## Size Budget

| Component | Size | When loaded |
|---|---|---|
| v86 WASM + BIOS | ~4MB | First `box.spawn` |
| Alpine image (compressed) | ~35MB | First `box.spawn` |
| Base snapshot | ~15MB | First `box.spawn` |
| **Total first use** | **~50MB** | Cached after first download |
| **Runtime memory** | **128-512MB** | Configurable per instance |

Zero cost until spawned. Cached in browser after first download. Agent warns user on first spawn.

---

## Implementation

### Package

```
packages/atua-box/
├── src/
│   ├── index.ts              createAtuaBox(), AtuaBox class
│   ├── v86-backend.ts        v86 emulator lifecycle
│   ├── fs-bridge.ts          9p server backed by AtuaFS
│   ├── shell.ts              Serial console command interface
│   ├── snapshots.ts          IndexedDB snapshot store
│   └── mcp-provider.ts       Registers box.* tools on hub
├── package.json
└── README.md
```

### Dependencies

| Package | Size | License |
|---|---|---|
| `v86` (npm) | ~4MB WASM | BSD |
| `idb` | ~3KB | ISC |

### Phases

**Phase 1:** Boot v86 with Alpine in a Worker, send command via serial, read output. Verify `uname -a` works.

**Phase 2:** Wire 9p filesystem bridge to AtuaFS. Write file in hyperkernel → visible at `/mnt/project` inside Linux. Write file inside Linux → visible in AtuaFS.

**Phase 3:** Snapshot save/restore. Boot, install packages, save. Restore in <3s. Ship base and dev snapshots.

**Phase 4:** Register `box.*` tools on Fabric hub. Pi calls `box.exec('convert ...')` → file appears in AtuaFS.

**Phase 5:** Networking via relay. `apk update`, `git clone`, `curl` work.

---

## What This Unlocks

**Universal package support.** `npm install` with native postinstall scripts that call `gcc`/`make` — run in AtuaBox, artifacts flow back through AtuaFS.

**Real compilers.** Build Rust WASM libraries, compile C extensions, cross-compile. Generated artifacts return to the hyperkernel for bundling.

**Full git.** Real `git` with SSH, submodules, LFS, credential helpers.

**Any Linux tool.** ImageMagick, FFmpeg, LaTeX, pandoc, shellcheck — `apk add` and go.

**Adversarial testing.** Run untrusted code in AtuaBox where it can't touch the hyperkernel's state. A compromised process is trapped three layers deep.
