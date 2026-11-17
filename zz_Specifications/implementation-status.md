# Implementation status

Specification baseline: 2026-11-14. Phases 0-9 are locally implemented and verified, with all 106 automated tests passing locally and in hosted Windows CI. Native, operational and physical-device acceptance remains blocked. No persistent pilot is activated. See the [current report](implementation-report-2026-11-14.md) and [resume checkpoint](implementation-run.md).

| Phase | Status | Verification | Blocker / next action |
|---|---|---|---|
| 0 Scaffold and capability baseline | local verified; live gates pending | `npm ci`; `npm run verify`; `test:security`; `test:updates`; `doctor`; audit; visual desktop/phone inspection. [Checkpoint](implementation-run.md). | Codex/Claude executable baselines detected; real managed-policy certification remains phase 2. |
| 1 Durable domain and commands | local verified | `npm run verify`; security/update baselines; 9 unit and 14 integration checks, including actual process kills at commit boundaries, lost-ack reconciliation, WAL backup and pruning. [Checkpoint](implementation-run.md). | Process ownership and live-provider controls are phase 2. |
| 2 Providers and ownership | local verified; live blocked | Full verify; 14 unit and 19 integration tests; owner-only Windows pipe ACL, separate-process forgery rejection, broker reconnect, exact transport targeting, interruption, scope policy, discovery and handoff fixtures. [Checkpoint](implementation-run.md). | Isolated native probes report unauthenticated managed homes. Live start/resume/interrupt, effective denial and real-provider certification remain blocked. Optional cestDone disabled. |
| 3 Scheduler and assistant | local fixture verified; native recipes pending | Full verify, 16 unit and 27 integration tests, including separate broker workflow, independent artifact/recipe proof, bounded retries, pause acknowledgement, exact decisions, PDF/source isolation and uncertain external-action reconciliation. [Checkpoint](implementation-run.md). | Native recipe certification and real workspace ownership enforcement precede enabling managed native writes. |
| 4 Authenticated UI | local fixture verified | Full verify, 16 unit, 28 integration, 6 Chromium, 4 security and 1 update-baseline tests. Five viewport sizes in both themes, system switching, keyboard, offline draft, source selection, exact phone decision, revoked SSE and device logout. Screenshots independently inspected. [Checkpoint](implementation-run.md). | Native stopped-owner proof remains unavailable; observe-only and new-session continuation are explicit. Physical device checks remain separate. |
| 5 PWA, voice, notifications | local fixture verified; devices blocked | Full verify, 17 unit, 32 integration, 10 production-bundle Chromium, 4 security and 1 update-baseline checks; real Windows DPAPI, transactional v1-to-v2 migration, encrypted push retry/removal, offline reload, retained command identity, fake audio and denied microphone. [Checkpoint](implementation-run.md). | Physical Android/iOS install, actual speech and lock-screen push remain blocked; waiting-worker activation/rollback rehearsal belongs to supervisor phase. |
| 6 Operations and supervisor | local fixture verified; operational gates pending | Full verify, 18 unit, 42 integration, 10 Chromium, 4 security and 4 update tests. Owner ACL, OS single-instance locks, encrypted WAL restore/delta rejection/source retirement, coordinator reconnect, canary, journal crashes, package install/start/doctor/stop/cleanup and startup planning pass. [Checkpoint](implementation-run.md). | Native sandbox requires setup; no provider turns started. Actual persistent activation, sign-in/locked-session/reboot and real-provider operational certification remain unperformed. An older failed rehearsal folder remains quarantined after policy-rejected cleanup. |
| 7 Self-improvement | local fixture verified; native blocked | Fresh installed UI request, assertion failure before/pass after, full gates, independent rebuild, 120-second observation, installed fix and manual rollback pass. Exact prior service worker, draft and acknowledged request survive. Broker owns native update execution; signed grants, protected refusal, automatic health rollback and six actual supervisor kills are tested. [Checkpoint](implementation-run.md). | Native issuer exists, with opt-in/refusal, signed suspension, expiry and binding tests. Its live path remains blocked by sandbox/authentication. No production or persistent activation. |
| 8 Full rehearsal | local fixture verified; external gates blocked | Five-task/two-project UI, two devices, exact decision race, three automatic phases, priorities/dependencies, session brief/continuation, synthetic approval, notifications, offline and recovery. Both themes inspected; 30-sample p95 meets all three targets. [Checkpoint](implementation-run.md). | Native execution, physical Android/iOS, real audio/push and sign-in/lock/reboot remain blocked. |
| 9 Handoff and release preparation | local and hosted CI verified; release gates blocked | Portable setup/support/contributing/recovery guides; independent empty-home installation and complete local gates; current ZIP read-back, authenticated owner installation, DPAPI restore/bootstrap, paused restart, exact stop, project preservation and cleanup pass. [Windows CI](https://github.com/olkano/cestOn/actions/runs/43646788951) passes all 106 tests and package verification. [Report](implementation-report-2026-11-14.md). | Owner license, native/device/operational acceptance, persistent activation and application publication remain separate gates. |

## Project-memory requirement added 2026-11-17

[U19 and M01-M09](13-project-memory.md) are mandatory for the first usable revised daily workflow and remain unimplemented/unverified. Memory accepts free-form notes and optional structure in the existing SQLite architecture. Source review confirmed an execution journal, task priorities and task dependencies, but no maintained cross-project knowledge lifecycle. The original 106 tests remain baseline evidence only. Follow the local implementation sequence in the [resume checkpoint](implementation-run.md); external provider/device gates do not block independent memory work.

## Acceptance dimensions

| Dimension | Status |
|---|---|
| Implementation present for phases 0-9 | yes |
| U19 project knowledge and memory present | no; required extension specified, M01-M09 pending |
| Revised automatic discovery and daily conversation workflow accepted | no; research/prototypes only, application work and provider/device evidence pending |
| Implementation complete against all required acceptance | no; U19 memory implementation is pending and mandatory native/device/operational evidence remains blocked |
| Full local automated verification passed | yes; 26 unit, 56 integration, 13 Chromium, 4 security, 7 update tests |
| Hosted CI passed | yes; same 106 tests and package verification on application revision f39a229 |
| Codex live adapter certified | no |
| Claude live adapter certified | no |
| Android physical device accepted | no |
| iOS physical device accepted | no |
| Real-provider isolated self-update certified | no |
| Local persistent pilot activated and verified | no |
| Public release ready | no |
| Authorized public source repository pushed | yes |
| Public application package released | no |

Update a phase row only after inspecting its actual artifacts and results. Add one concise evidence link and exact remaining gate; retain detailed results in private evidence. This ledger is implementation state, not a second specification.
