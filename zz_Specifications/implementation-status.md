# Implementation status

Specification baseline: 2026-11-14. Current status: Phases 0-8 locally fixture-verified with provider, operational and physical-device gates blocked. Release preparation is in progress. No persistent pilot is activated.

| Phase | Status | Verification | Blocker / next action |
|---|---|---|---|
| 0 Scaffold and capability baseline | local verified; live gates pending | `npm ci`; `npm run verify`; `test:security`; `test:updates`; `doctor`; audit; visual desktop/phone inspection. [Checkpoint](implementation-run.md). | Codex/Claude executable baselines detected; real managed-policy certification remains phase 2. |
| 1 Durable domain and commands | local verified | `npm run verify`; security/update baselines; 9 unit and 14 integration checks, including actual process kills at commit boundaries, lost-ack reconciliation, WAL backup and pruning. [Checkpoint](implementation-run.md). | Process ownership and live-provider controls are phase 2. |
| 2 Providers and ownership | local verified; live blocked | Full verify; 14 unit and 19 integration tests; owner-only Windows pipe ACL, separate-process forgery rejection, broker reconnect, exact transport targeting, interruption, scope policy, discovery and handoff fixtures. [Checkpoint](implementation-run.md). | Isolated native probes report unauthenticated managed homes. Live start/resume/interrupt, effective denial and real-provider certification remain blocked. Optional cestDone disabled. |
| 3 Scheduler and assistant | local fixture verified; native recipes pending | Full verify, 16 unit and 27 integration tests, including separate broker workflow, independent artifact/recipe proof, bounded retries, pause acknowledgement, exact decisions, PDF/source isolation and uncertain external-action reconciliation. [Checkpoint](implementation-run.md). | Native recipe certification and real workspace ownership enforcement precede enabling managed native writes. |
| 4 Authenticated UI | local fixture verified | Full verify, 16 unit, 28 integration, 6 Chromium, 4 security and 1 update-baseline tests. Five viewport sizes in both themes, system switching, keyboard, offline draft, source selection, exact phone decision, revoked SSE and device logout. Screenshots independently inspected. [Checkpoint](implementation-run.md). | Native stopped-owner proof remains unavailable; observe-only and new-session continuation are explicit. Physical device checks remain separate. |
| 5 PWA, voice, notifications | local fixture verified; devices blocked | Full verify, 17 unit, 32 integration, 10 production-bundle Chromium, 4 security and 1 update-baseline checks; real Windows DPAPI, transactional v1-to-v2 migration, encrypted push retry/removal, offline reload, retained command identity, fake audio and denied microphone. [Checkpoint](implementation-run.md). | Physical Android/iOS install, actual speech and lock-screen push remain blocked; waiting-worker activation/rollback rehearsal belongs to supervisor phase. |
| 6 Operations and supervisor | local fixture verified; operational gates pending | Full verify, 18 unit, 42 integration, 10 Chromium, 4 security and 4 update tests. Owner ACL, OS single-instance locks, encrypted WAL restore/delta rejection/source retirement, coordinator reconnect, canary, journal crashes, package install/start/doctor/stop/cleanup and startup planning pass. [Checkpoint](implementation-run.md). | Native sandbox requires setup; no provider turns started. Actual persistent activation, sign-in/locked-session/reboot and real-provider operational certification remain unperformed. An older failed rehearsal folder remains quarantined after policy-rejected cleanup. |
| 7 Self-improvement | local fixture verified; native blocked | Request idempotency/scope, real browser regression failure then success in an isolated candidate, synthetic source apply/failure/protection/rollback, desktop/phone request form and preserved draft pass. Full verify: 21 unit, 46 integration, 11 Chromium, 4 security, 6 update tests, including six actual supervisor-process kills. Broker owns native update execution; signed grants, manual rollback and private ACL denial pass. [Checkpoint](implementation-run.md). | Full separate-process success, regression failure, protected-change refusal and actual health rollback pass with cleanup; native certification remains blocked. No production or persistent activation. |
| 8 Full rehearsal | local fixture verified; external gates blocked | Five-task/two-project UI, two devices, exact decision race, three automatic phases, priorities/dependencies, session brief/continuation, synthetic approval, notifications, offline and recovery. Both themes inspected; 30-sample p95 meets all three targets. [Checkpoint](implementation-run.md). | Native execution, physical Android/iOS, real audio/push and sign-in/lock/reboot remain blocked. |
| 9 Handoff and release preparation | in progress | Portable instructions, owner CLI and local package foundation exist. | Finish clean export, independent setup, CI, final bundle and removal rehearsal; retain license/publication gates. |

## Acceptance dimensions

| Dimension | Status |
|---|---|
| Implementation complete | no |
| Full automated verification passed | no |
| Codex live adapter certified | no |
| Claude live adapter certified | no |
| Android physical device accepted | no |
| iOS physical device accepted | no |
| Real-provider isolated self-update certified | no |
| Local persistent pilot activated and verified | no |
| Public release ready | no |
| Public repository/package released | no |

Update a phase row only after inspecting its actual artifacts and results. Add one concise evidence link and exact remaining gate; retain detailed results in private evidence. This ledger is implementation state, not a second specification.
