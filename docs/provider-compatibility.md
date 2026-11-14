# Provider compatibility

| Profile | Baseline runtime | Current verification |
|---|---|---|
| Codex app-server | 0.160.0 | Owned stdio handshake, exact start/resume/steer/interrupt, batched notifications, duplicate-start protection and lost transport are fixture-tested. Isolated native probe passes; managed home is unauthenticated. Live certification blocked. |
| Claude Code | 2.1.317 | Agent SDK 0.3.325 transport, exact session targeting, interruption, restrictive tool set and fail-closed PreToolUse hook are fixture-tested. Isolated native auth probe reports an unauthenticated managed home. Live certification blocked. |
| Fixture | 1 | Deterministic start deduplication, duplicate events, interrupted transport, and terminal-state tests pass. This is synthetic execution. |

Runtime detection does not certify authentication, billing, scope controls, or real work. Managed writes require the phase-2 certification; unsupported versions must fail closed. Never change global provider settings to make a test pass. Live tests use explicit profiles and disposable roots under the caps in [the acceptance contract](../zz_Specifications/09-acceptance-tests.md).

The tooling baseline uses Node 24, TypeScript 6.0.3, React 19.3.1, Vite 8.3.8, Fastify 5.12.8, better-sqlite3 13.2.0, Zod 4.6.7, Vitest 5.1.0, and Playwright 1.65.1. TypeScript 7 is excluded because typescript-eslint 8.72.2 declares support below 6.1. The narrow minimatch 11.0.1 override removes the transitive advisory; lint and typecheck verify compatibility. SQLite's distributed Windows prebuild loads successfully without a native build toolchain on the verified host. Other architectures may require a supported C++ toolchain.

Codex requests use a workspace-only permission profile; legacy sandbox overrides must not be layered over it. The adapter denies additional privilege requests. These settings require live denial tests on the installed host before managed writes are enabled. See the [official permission-profile contract](https://learn.chatgpt.com/docs/permissions). Claude uses a PreToolUse hook with `onFailure: block` in addition to its permission callback; see [permission ordering](https://code.claude.com/docs/en/agent-sdk/permissions). Neither is an OS sandbox claim for hostile same-user code.

Run `npm exec -- tsx scripts/probe-runtimes.ts` on the Windows npm baseline for a value-free, zero-model-turn probe using temporary provider homes. Live tests require `CESTON_LIVE_TESTS=1`, `CESTON_TEST_ROOT` with a valid marker, and `CESTON_TEST_CONFIG` containing explicit constrained profiles, dedicated authenticated homes, synthetic project roots, billing mode and a monetary ceiling for metered profiles. `npm run test:providers:live` has a total four-turn/five-minute budget per provider and never silently enables automatic updates. Missing or unobserved permission receipts remain blocked. Inspect retained synthetic evidence and clean only the owned marked root.

The optional cestDone baseline remains `fb30d27`. No versioned isolated-result contract is certified, so the adapter reports unavailable and cannot execute a job. It never loads operational configuration or starts the existing daemon.
