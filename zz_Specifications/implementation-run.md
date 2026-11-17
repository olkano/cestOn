# Implementation checkpoint

## Authority and resume

The owner authorized phases 0-9, independent tests, staging, commits and pushes on 2026-11-14. Persistent pilot activation, infrastructure/account changes outside isolated tests, paid provisioning and application artifact publication remain separate operations under `00-start-here.md`.

Read AGENTS, README, this file, `implementation-status.md` and `implementation-progress.json`. Inspect Git status and the actual remote SHA before editing. Preserve unfinished work. Use `npm run checkpoint` for the machine-readable state. Resolve source/test failures autonomously; never substitute fixtures for native or physical evidence.

## Current state

The owner added mandatory project knowledge and memory on 2026-11-17. Read [13-project-memory.md](13-project-memory.md) before continuing the revised workflow: durable facts, explicit relationships, importance distinct from urgency, corrections, staleness and forgetting must be present from its first usable delivery. This turn records the contract and pending M01-M09 gates only; it does not implement memory or alter baseline acceptance.

The owner is refining the daily workflow before an application redesign. Read [daily-work-review-2026-11-17.md](daily-work-review-2026-11-17.md) first for the latest direction, real discovery probe, private HTML location and remaining control tests. The session-first prototype is illustrative; this review does not change phase acceptance.

Local phases 0-9 are implemented and verified. Application revision `f39a2290b3d2ed50f1e97338e212ebd82beb8634` passes all 106 tests locally and in hosted Windows CI, including regressions for completion-event ordering and stale-phase dispatch. The verified local package includes these corrections, native certification tooling, the strict runtime helper allowlist and portable instructions. There is no persistent installation, real model execution or application artifact publication.

The owner CLI supports initialization, temporary start, explicit stop scope, status/version, private pairing, doctor, backup, frozen recovery, startup planning/registration and native certification. Requested updates use isolated source, a broker-owned coding worker, frozen regression bytes, independent verification/rebuild, immutable manifests, atomic activation, 120-second observation and explicit/automatic rollback. Native activation remains disabled without actual current evidence for both providers. Starting native re-certification suspends earlier eligibility; interrupted or failed attempts cannot silently retain it.

Project-memory contract verification: `npm run test:docs` and `npm run check:export` passed on 2026-11-17, with no broken documentation links or reported export issues. Source inspection and contract review establish the baseline gap only. No runtime changes or memory tests were performed; M01-M09 remain pending.

## Verified evidence

| Check | Result / private evidence |
|---|---|
| Combined local suite | `2026-11-14T22-12-44-996Z-70055f20`: types, lint, build, docs; 26 unit, 56 integration, 13 Chromium, 4 security and 7 update tests pass. Includes actual process kills and Windows owner ACL, DPAPI, process identity and private IPC. |
| Independent public checkout | `clean-export-1794694364808`: allowlist copy outside the checkout, empty home, script-free npm ci, native SQLite load, all verification/security/update checks and cleanup pass. |
| Current local package | `artifacts/ceston-56003c47-d350-49ff-985f-9d550b97b157.zip`; release `local-677f096b0643-56003c47`; SHA-256 `c28fc338760e75041c1ad75a68ca636847a0f079a9dba8ec52f20644259f865b`; every archive entry read back. Source snapshot `677f096b0643340e3cadf53481ec66d514e1523b0068fbf7b058e554173b373e`. |
| Empty owner installation and restore | `package-rehearsal-1794694849344.json`: actual packaged canary, owner-only production-mode root with no providers, private HTTP pairing, authenticated project read-back, doctor, exact owned stop, DPAPI backup/restore, verified bootstrap, same restored device authentication, paused restart, unchanged external synthetic project and cleanup pass. Startup was planned only. |
| Fresh full requested update and manual rollback | `self-update-fixture-1794694552157`: real browser regression fails before/passes after, full gates and independent rebuild, activation/120-second observation, actual installed fix, prior release and exact prior service-worker return, draft/acknowledgement retention, one rollback receipt and cleanup pass. Applied and rolled-back phone screenshots inspected. |
| Negative/automatic rollback scenarios | `self-update-fixture-1794683803541` covers failure/protected refusal; `self-update-fixture-1794684977404` covers actual health failure and automatic rollback with preserved draft/request and cleanup. Current automated update suite covers their control invariants and six actual supervisor process kills. |
| Complete journeys and visuals | `journey-2026-11-14`: five tasks/two projects, two devices, both themes, desktop/phone/zoom screenshots inspected. Thirty-sample p95: Today 50.2 ms, receipt 4.4 ms, state update 848.8 ms on the recorded i7-13700K/32 GiB host. Current browser suite also verifies three automatic phases, decision conflict, session continuation, priorities, approvals, notifications and reconnect. |

## Hosted verification

[Windows CI run 43646788951](https://github.com/olkano/cestOn/actions/runs/43646788951) passes all 106 tests, static/build/docs checks and immutable package verification on `f39a229`. Its preflight independently proves owner identity, Chromium startup/read-back, ACL, DPAPI, mutex, process identity and private IPC. The CI-only launcher retains the runner SID, disables administrator membership/privileges, assigns its default owner and process DACL, and uses a private desktop. No Windows account, provider authentication, artifact upload or deployment is created.

Earlier failed CI runs exposed cold PowerShell discovery, an elevated default-owner mismatch, a completion event/status race and stale workspace replies redispatching completed phases. Direct .NET helpers preserve the security checks; failed-before/passed-after regressions cover both application races. The temporary CI worktree was removed through Git after absolute-path and clean-status validation. A local unelevated CI-factory probe returned Access denied and cleaned up; only the successful hosted run establishes that launcher's positive evidence.

Resume with the external gates below. The local application, clean export, package installation and restore have passed. Follow the owner runbooks for each newly available prerequisite, update this checkpoint/ledger with observed results, and retain the distinction between source, activation and publication. Do not rerun native work or enable updates merely because fixtures pass.

## External gates and operation limits

- Native Windows confinement reports `native_sandbox_setup_required`; dedicated Codex and Claude homes are unauthenticated. Zero real model turns were started. Baseline and full self-update certificates remain unissued. The native issuer's refusal, signature, expiry, suspension and toolchain/baseline binding tests pass; its live path is unverified.
- Android inventory found no attached device; physical iOS tooling/device is unavailable. Real standalone install, microphone/audio, lock-screen push and assistive-device evidence remain blocked.
- Persistent startup, sign-in, locked-session and reboot acceptance are unperformed. No pilot, tunnel, remote origin, paid service, operational schedule or account integration was activated. Optional cestDone remains disabled and its daemon/configuration untouched.
- Owner-selected application license and explicit artifact/signing/publication authority remain open. The authorized public source repository exists; `private: true` and `UNLICENSED` remain in package metadata.

## Quarantine and failed attempts

Automatic approval review rejected removal of the old failed test folder `ceston-test-ZykHxS` with `blocked by policy`. Its three owned processes were stopped through authenticated IPC and confirmed absent. The partially cleaned folder remains under OS Temp. Do not delete it through another mechanism or include it in cleanup-pass evidence. Later isolated rehearsals clean their own marked roots and preserve their markers until cleanup succeeds.

Earlier failed archive/compiler assumptions, Windows TEMP aliases, source hashes including generated icons, immediate draft hydration assertions, short workflow expectations and the missing exact compiler-helper allowlist entry were corrected with focused regressions or observed read-back. Their failed evidence remains private and is not represented as passed. Historical files under `reference-private/` remain unchanged and excluded from source exports and artifacts.

## Source milestones

| Phase | Source milestone |
|---|---|
| Tracking / initial source | `3d79515` / `9cfbc8a` |
| 0 Scaffold | `2402afa` |
| 1 Durable domain | `edfaf1f` |
| 2 Providers and ownership | `5d749fd` |
| 3 Scheduler and assistant | `4f71666` |
| 4 Authenticated interface | `e5757f3` |
| 5 PWA, voice and notifications | `40d9fdc` |
| 6 Operations and recovery | `bdb517f`, `07d3ccc` |
| 7 Requested improvements | `a80c4bd`, `e96f913` |
| 8 Complete journeys | `457cf2a` |
| 9 Portable release preparation and native tooling | `051a967`, `fd78753`, `dc5ba41`, `f39a229`; intermediate CI corrections are in Git history. |
