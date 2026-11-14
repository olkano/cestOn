# Provider compatibility

| Profile | Baseline runtime | Current verification |
|---|---|---|
| Codex app-server | 0.160.0 | Executable and protocol generator available. Managed-write and sandbox certification pending. |
| Claude Code | 2.1.317 | Executable available. SDK/CLI transport and permission certification pending. |
| Fixture | 1 | Deterministic start deduplication, duplicate events, interrupted transport, and terminal-state tests pass. This is synthetic execution. |

Runtime detection does not certify authentication, billing, scope controls, or real work. Managed writes require the phase-2 certification; unsupported versions must fail closed. Never change global provider settings to make a test pass. Live tests use explicit profiles and disposable roots under the caps in [the acceptance contract](../zz_Specifications/09-acceptance-tests.md).

The tooling baseline uses Node 24, TypeScript 6.0.3, React 19.3.1, Vite 8.3.8, Fastify 5.12.8, better-sqlite3 13.2.0, Zod 4.6.7, Vitest 5.1.0, and Playwright 1.65.1. TypeScript 7 is excluded because typescript-eslint 8.72.2 declares support below 6.1. The narrow minimatch 11.0.1 override removes the transitive advisory; lint and typecheck verify compatibility. SQLite's distributed Windows prebuild loads successfully without a native build toolchain on the verified host. Other architectures may require a supported C++ toolchain.
