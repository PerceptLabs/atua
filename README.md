# Atua

Standalone browser-native runtime engine.

Provides filesystem, JS execution, networking, process management, package resolution, and dev tooling inside a browser tab. Any application can consume it.

**Package scope:** `@aspect/atua-*`
**License:** MIT

## Packages

| Package | Description |
|---------|-------------|
| `@aspect/atua-core` | Engine + FS + Net + Proc |
| `@aspect/atua-pkg` | Package management (npm + esm.sh) |
| `@aspect/atua-dev` | Build pipeline + HMR |

## Development

```bash
pnpm install
pnpm build
pnpm test          # Node tests (pure logic)
pnpm test:browser  # Browser tests (OPFS, SW, WASM, MessageChannel)
pnpm test:all      # Both suites
```

## Third-Party Licenses

[ZenFS](https://github.com/zen-fs/core), Licensed under the [LGPL 3.0 or later](https://www.gnu.org/licenses/lgpl-3.0.html) and [COPYING.md](https://github.com/zen-fs/core/blob/main/COPYING.md), Copyright (c) James Prevett and other ZenFS contributors
