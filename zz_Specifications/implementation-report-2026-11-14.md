# Implementation report

Local phases 0-9 are implemented and verified, including the final completion-event and duplicate-dispatch corrections. All 106 automated tests pass locally and in hosted Windows CI. Native/provider and physical/operational acceptance remains blocked; this report does not establish full product acceptance or public release readiness.

## Implemented scope

The application has durable SQLite tasks/scopes/events and idempotent commands, bounded planning/scheduling, independent artifact verification, exact decisions and approvals, source/PDF intake, provider discovery/continuation contracts, a separate execution broker, authenticated device API/SSE, desktop/phone UI, themes, keyboard controls, offline drafts, a static-only PWA, bounded voice controls and durable notifications. Native profiles fail closed when authentication, billing, enforcement or certification is missing. Optional cestDone remains disabled.

The separate supervisor supplies immutable packages, private process ownership, startup planning, encrypted backup/frozen restore, verified bootstrap, read-only recovery status, safe release retention, regression-first candidate source, independent rebuild, atomic activation, 120-second observation and rollback. Native self-update certification is an explicit bounded owner command. It suspends old eligibility during re-certification and requires successful current evidence for both providers before issuing a private certificate after cleanup.

## Verification

| Check | Observed result |
|---|---|
| Combined suite | 26 unit, 56 integration, 13 production-bundle Chromium, 4 security and 7 update tests pass, plus types, lint, build and docs. Record `2026-11-14T22-12-44-996Z-70055f20`. |
| Independent setup | `clean-export-1794694364808`: explicit public allowlist, fresh directory/empty home, script-free npm ci, distributed native SQLite load, all local gates and cleanup pass. |
| Actual owner installation | `package-rehearsal-1794694849344`: packaged separate-process canary, production-mode empty owner root, HTTP pairing/project read-back, doctor, exact stop, DPAPI backup/restore, verified bootstrap, restored device login, paused restart, unchanged external synthetic project and cleanup pass. No providers or startup persistence were enabled. |
| Fresh complete update and rollback | `self-update-fixture-1794694552157`: actual installed UI at phone viewport, seeded filter regression fails before/passes after, full checks/rebuild, activation and observation, installed fix, explicit rollback, correct prior release/worker, unsent draft and acknowledgement retention, cleanup pass. Applied and rolled-back screenshots inspected. |
| Refusal, failure and crash recovery | Current suites verify stale/duplicate decisions, forged IPC/commands/grants/reports, exact helper allowlist, path/link escapes, private child ACL denial, failed checks, protected changes, recovery and six actual supervisor process kills. Separate installed fixture runs also demonstrate protected refusal and actual candidate-health rollback. |
| Complete journeys | Five tasks/two projects, two devices, three automatic phases, decision conflict, session continuation, priorities/dependencies, synthetic exact-action approval, inbox, offline/reconnect and blocked-task recovery. Desktop/phone dark/light/zoom screenshots inspected. |
| Hosted CI | [Windows run 43646788951](https://github.com/olkano/cestOn/actions/runs/43646788951) passes the same 106 tests, types, lint, build, docs and immutable package verification on application revision `f39a229`. Restricted owner-token, Chromium read-back, ACL, DPAPI, mutex, process identity and private IPC preflights pass. No provider credentials, artifact upload or deployment is involved. |

Thirty local repetitions on the recorded i7-13700K/32 GiB host measured p95 Today content at 50.2 ms, command receipt at 4.4 ms and visible state update at 848.8 ms, below the respective 2,000/500/2,000 ms engineering targets. Browser viewport/audio fixtures do not establish physical installation, microphone or notification delivery.

## Verified local artifact

- Source application revision: `f39a2290b3d2ed50f1e97338e212ebd82beb8634`.
- Source snapshot: `677f096b0643340e3cadf53481ec66d514e1523b0068fbf7b058e554173b373e`.
- Release: `local-677f096b0643-56003c47`.
- ZIP: `artifacts/ceston-56003c47-d350-49ff-985f-9d550b97b157.zip`.
- SHA-256: `c28fc338760e75041c1ad75a68ca636847a0f079a9dba8ec52f20644259f865b`.
- Manifest hash: `d0d743b965abb182578aa2af823c4ad552e0f442cc52e6991c8711b8f0b45a1b`.

Every archive entry was read back against the immutable manifest. Dependency notices and distributed license files are included. The source snapshot records the exact packaged files; the final documentation handoff follows the application revision. This is an unpublished local artifact, distinct from the authorized public source push.

## Remaining gates

- Native Windows confinement requires setup and both dedicated provider homes are unauthenticated. Zero real model turns were started; no live provider or self-update certificate was issued. The native issuer's happy path remains unverified.
- Physical Android/iOS standalone install, microphone/audio, lock-screen push and assistive-device checks remain blocked by device/service prerequisites.
- Actual startup registration, sign-in, locked-session, reboot and persistent-pilot acceptance remain unperformed. No persistent pilot, tunnel, paid service, operational schedule or account integration was activated.
- The owner has not selected the application license. Package metadata remains `private: true` and `UNLICENSED`. Signing, artifact publication and redistribution remain separate release operations.

The older failed test folder `ceston-test-ZykHxS` remains quarantined after automatic approval review rejected its removal with `blocked by policy`. Its owned processes were stopped and confirmed absent. It is excluded from passing cleanup evidence. Private historical documents remain unchanged and are excluded from exports, Git and packages.

The [status ledger](implementation-status.md), [acceptance matrix](acceptance-evidence.md) and [checkpoint](implementation-run.md) retain exact scope and resumption steps. The specification set stays active while mandatory acceptance gates remain open.
