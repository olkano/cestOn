# Implementation status

Specification baseline: 2026-11-14. Current status: Phases 0-3 locally verified with live-provider gates blocked. Authenticated UI and remaining feature phases are in progress. No persistent pilot is activated.

| Phase | Status | Verification | Blocker / next action |
|---|---|---|---|
| 0 Scaffold and capability baseline | local verified; live gates pending | `npm ci`; `npm run verify`; `test:security`; `test:updates`; `doctor`; audit; visual desktop/phone inspection. [Checkpoint](implementation-run.md). | Codex/Claude executable baselines detected; real managed-policy certification remains phase 2. |
| 1 Durable domain and commands | local verified | `npm run verify`; security/update baselines; 9 unit and 14 integration checks, including actual process kills at commit boundaries, lost-ack reconciliation, WAL backup and pruning. [Checkpoint](implementation-run.md). | Process ownership and live-provider controls are phase 2. |
| 2 Providers and ownership | local verified; live blocked | Full verify; 14 unit and 19 integration tests; owner-only Windows pipe ACL, separate-process forgery rejection, broker reconnect, exact transport targeting, interruption, scope policy, discovery and handoff fixtures. [Checkpoint](implementation-run.md). | Isolated native probes report unauthenticated managed homes. Live start/resume/interrupt, effective denial and real-provider certification remain blocked. Optional cestDone disabled. |
| 3 Scheduler and assistant | local fixture verified; native recipes pending | Full verify, 16 unit and 27 integration tests, including separate broker workflow, independent artifact/recipe proof, bounded retries, pause acknowledgement, exact decisions, PDF/source isolation and uncertain external-action reconciliation. [Checkpoint](implementation-run.md). | Native recipe certification and real workspace ownership enforcement precede enabling managed native writes. |
| 4 Authenticated UI | pending | Not run | Phases 1-3. |
| 5 PWA, voice, notifications | pending | Not run | Phase 4; device/provider gates tracked separately. |
| 6 Operations and supervisor | pending | Not run | Phases 1-4. |
| 7 Self-improvement | pending | Not run | Phases 3-6. |
| 8 Full rehearsal | pending | Not run | All required feature phases. |
| 9 Handoff and release preparation | pending | Not run | Acceptance evidence and export checks. |

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
