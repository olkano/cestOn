# cestOn implementation contract

Status: ready for implementation planning; no application implementation has started. Specification baseline: 2026-11-14. Owner decisions incorporated: separate cestOn product, assistant terminology, installable phone experience, VS Code-inspired light/dark themes, and requested self-improvement with local application of verified changes.

## Read and execute

Read the root README and AGENTS, then this file, `01-product.md`, `02-architecture.md`, `03-data-and-api.md`, and `06-security-and-authority.md`. Read `08-implementation-phases.md` and `09-acceptance-tests.md` before building. Each phase names its additional contracts. Read `07-self-improvement.md` before writing any update or service lifecycle code. Use `12-traceability.md` to check coverage.

The numbered specifications are normative. The prototype illustrates interaction, not implementation. Historical material in `reference-private/` is optional background and must not override these decisions. Resolve conflicting wording in favor of explicit user requirements and the most specific contract; record a proposed clarification only when behavior cannot be determined safely. Do not reopen the architecture selection as a phase-0 deliverable.

## Scope of this delivery and a future implementation run

This delivery creates documentation, design, and a local repository only. It does not implement or activate cestOn. A later instruction to “implement these specifications” authorizes the local steps below without repeated phase-by-phase confirmation.

| Operation during implementation | Boundary |
|---|---|
| Create source, dependencies, fixtures, builds, and documentation | This repository and its isolated test roots; inspect dependency scripts before execution. |
| Run local services, tests, browser checks, and crash drills | Loopback listeners, synthetic projects, reserved test ports, per-run cleanup. |
| Provider smoke tests | Existing configured account under its authorized identity, synthetic workspaces, explicit opt-in test flag, caps in `09-acceptance-tests.md`; no operational tasks. Missing access is a recorded gate. |
| Local pilot install and restart | Only after implementation authorization includes activation of the local cestOn pilot; complete scripts and dry-run tests first. If activation was not requested, leave a fully built, validated candidate. |
| Git staging, commits, remote creation, push, public package/release | Only when the implementation request explicitly includes them. Preserve task scope and separate Git roots. |
| Tunnel, identity provider, DNS, provider account, app-store or paid service changes | Prepare exact configuration and read-back plan; require authorization for the specific external target. |
| Existing cestDone daemon, real schedules, customer systems, mail, CRM, production projects | Outside implementation test scope. Never run a real workflow as a smoke test. |

Do not invent missing credentials or silently replace real acceptance tests with fixtures. Continue all independent work when an external prerequisite is absent. Mark the affected gate `blocked`, with the exact required input or action. Do not claim the whole implementation is accepted while mandatory gates remain blocked.

## Autonomous implementation procedure

1. Inspect Git state and the ledger. Create the implementation report before edits. Preserve unrelated files and any existing operator settings.
2. Follow phases 0 through 9 in order. Within a phase, write meaningful failing tests for core behavior, implement, run focused tests, then the required phase suite.
3. Independently inspect outputs, UI, and state transitions; a worker's completion statement is not evidence. Use separate agent review only if the execution environment and current task authorize delegation. Otherwise perform a fresh review pass yourself.
4. Correct failures within scope, rerun affected checks, update the ledger, and proceed automatically. Three unsuccessful attempts at the same root problem create a blocker with evidence; continue independent work rather than looping.
5. Do not add placeholder success responses, bypass verification, or weaken a test to progress. A fixture adapter is clearly marked and cannot be enabled in a non-test install by default.
6. At completion run the clean-checkout rehearsal and complete the acceptance matrix. Report `implementation_complete`, `local_pilot_verified`, `public_release_ready`, and `publicly_released` separately.

## Required repository shape

```text
apps/web/                 React PWA
apps/server/              HTTP API, orchestration, database
apps/broker/              managed provider processes and journals
apps/supervisor/          service lifecycle and verified local updates
packages/contracts/      schemas, DTOs, state transitions
packages/adapters/        codex, claude, cestdone, fixture
packages/test-support/    fake clocks, providers, isolated workspaces
scripts/                  install, doctor, package, verify, cleanup
assets/                   canonical icon source
design/                   non-runtime design examples
docs/                     implemented operations and developer guides
zz_Specifications/        contract and implementation ledger
zz_Tickets/               scoped issues
```

Use npm workspaces, TypeScript in strict mode, React/Vite, Fastify, SQLite via `better-sqlite3`, Zod schemas, Vitest, and Playwright. This is a design choice, not an assertion that dependencies are installed. Phase 0 selects compatible supported stable versions, pins direct dependencies and the Node LTS major, commits a lockfile only when Git is authorized, and records native SQLite build support on Windows. Do not change the stack unless a reproduced incompatibility requires it; record the reason and contract impact.

## Completion evidence

Keep one current row per phase in `implementation-status.md`. Put detailed test results under an ignored `evidence-private/<run-id>/` folder and a concise sanitized completion report under `zz_Specifications/`. Never commit transcripts, credentials, home directories, screenshots of private projects, or provider payloads.

Each evidence record contains test ID, build hash, runtime/browser/device versions, fixture/live mode, command or manual steps, expected result, actual result, cleanup result, and pass/fail/blocked. The final report lists all unverified capabilities. Archive the specification set as a unit only after all required gates are accepted; update README links at that point.
