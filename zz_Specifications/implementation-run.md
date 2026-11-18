# Implementation checkpoint

## Authority and resume

The owner authorized the original baseline and later requested the full daily-work revision, tests and an installable build. The saved-chat upgrade operates on the existing owner installation and keeps its data and Cloudflare routing. New persistent installations, infrastructure/account changes, paid provisioning and application artifact publication remain separate operations under `00-start-here.md`.

Read AGENTS, README, this file, `implementation-status.md` and `implementation-progress.json`. Inspect Git status and the actual remote SHA before editing. Preserve unfinished work. Use `npm run checkpoint` for the machine-readable state. Resolve source/test failures autonomously; never substitute fixtures for native or physical evidence.

## Revised daily workflow

The Windows build opens in Chats. It can search, sort and read named Codex and Claude conversations, reply in eligible saved threads, start and reopen General conversations, and maintain project memory. The installed host uses the owner's signed-in provider apps for saved-chat replies. Memory accepts notes without a project, supports confirmed folder moves, flags time-sensitive notes, and learns accepted verified work. The [first-use guide](../docs/first-use.html) ships beside the Windows launcher.

Current acceptance and build evidence are recorded in the [implementation ledger](implementation-status.md). Sanity-check provider and device readiness before live tests. The production history reader checked 568 Codex files and 1,115 Claude files in a bounded local metadata scan on 2026-11-17. It returned 32 folders and 747 conversations. No titles, identifiers or texts were logged. Targeted fixture tests cover both readers and browser checks cover desktop, phone viewport, reconnect and independent General history.

## Continuation

1. Use the installation and package details in the implementation ledger. For a changed build, rerun `npm run package:local` and `node --import tsx scripts/rehearse-package.ts <unpacked-bundle>` before recording new evidence. Check the machine-readable checkpoint for the pending upgrade or the latest activation evidence.
2. Complete the remaining U19 scenarios. The current authorized source policy uses explicit capture and accepted work. Broader proposed inference and conflict review still need scoped inputs and tests. Validate review/retirement and recovery on the installed device.
3. Saved-chat replies use the original session ID and the installed, signed-in provider. Exact session and prior context have been verified in an isolated native session on both providers. Close a session held by the provider before retrying it in cestOn. Certification for autonomous Work and self-update remains separate. Reply from a physical phone and verify the standalone installation journey when a device is available.
4. Keep the ledger and machine-readable checkpoint current when a gate changes. Follow project authority and preserve verified phase evidence. Persistent activation, infrastructure changes and package publication are separate operations.

## Verified baseline evidence

| Check | Result / private evidence |
|---|---|
| Combined local suite | `2026-11-14T22-12-44-996Z-70055f20`: types, lint, build, docs; 26 unit, 56 integration, 13 Chromium, 4 security and 7 update tests pass. Includes actual process kills and Windows owner ACL, DPAPI, process identity and private IPC. |
| Independent public checkout | `clean-export-1794694364808`: allowlist copy outside the checkout, empty home, script-free npm ci, native SQLite load, all verification/security/update checks and cleanup pass. |
| Original baseline package | `artifacts/ceston-56003c47-d350-49ff-985f-9d550b97b157.zip`; release `local-677f096b0643-56003c47`; SHA-256 `c28fc338760e75041c1ad75a68ca636847a0f079a9dba8ec52f20644259f865b`; every archive entry read back. Source snapshot `677f096b0643340e3cadf53481ec66d514e1523b0068fbf7b058e554173b373e`. |
| Empty owner installation and restore | `package-rehearsal-1794694849344.json`: actual packaged canary, owner-only production-mode root with no providers, private HTTP pairing, authenticated project read-back, doctor, exact owned stop, DPAPI backup/restore, verified bootstrap, same restored device authentication, paused restart, unchanged external synthetic project and cleanup pass. Startup was planned only. |
| Fresh full requested update and manual rollback | `self-update-fixture-1794694552157`: real browser regression fails before/passes after, full gates and independent rebuild, activation/120-second observation, actual installed fix, prior release and exact prior service-worker return, draft/acknowledgement retention, one rollback receipt and cleanup pass. Applied and rolled-back phone screenshots inspected. |
| Negative/automatic rollback scenarios | `self-update-fixture-1794683803541` covers failure/protected refusal; `self-update-fixture-1794684977404` covers actual health failure and automatic rollback with preserved draft/request and cleanup. Current automated update suite covers their control invariants and six actual supervisor process kills. |
| Complete journeys and visuals | `journey-2026-11-14`: five tasks/two projects, two devices, both themes, desktop/phone/zoom screenshots inspected. Thirty-sample p95: Today 50.2 ms, receipt 4.4 ms, state update 848.8 ms on the recorded i7-13700K/32 GiB host. Current browser suite also verifies three automatic phases, decision conflict, session continuation, priorities, approvals, notifications and reconnect. |

## Hosted verification

[Windows CI run 43646788951](https://github.com/olkano/cestOn/actions/runs/43646788951) passes all 106 tests, static/build/docs checks and immutable package verification on `f39a229`. Its preflight independently proves owner identity, Chromium startup/read-back, ACL, DPAPI, mutex, process identity and private IPC. The CI-only launcher retains the runner SID, disables administrator membership/privileges, assigns its default owner and process DACL, and uses a private desktop. No Windows account, provider authentication, artifact upload or deployment is created.

Earlier failed CI runs exposed cold PowerShell discovery, an elevated default-owner mismatch, a completion event/status race and stale workspace replies redispatching completed phases. Direct .NET helpers preserve the security checks; failed-before/passed-after regressions cover both application races. The temporary CI worktree was removed through Git after absolute-path and clean-status validation. A local unelevated CI-factory probe returned Access denied and cleaned up; only the successful hosted run establishes that launcher's positive evidence.

The results above establish the original baseline at the recorded revisions. Continue the pending local work in the handoff sequence; address external gates separately when their prerequisites become available. Update this checkpoint/ledger with observed results and retain the distinction between source, activation and publication. Do not enable native execution or updates merely because fixtures pass.

## External gates and operation limits

- Native Work confinement reports `native_sandbox_setup_required` and the dedicated managed Codex and Claude homes are unauthenticated. Saved-chat replies use the installed user's provider sign-in. Baseline and full self-update certificates remain unissued. The native issuer's refusal, signature, expiry, suspension and toolchain/baseline binding tests pass; its live path is unverified.
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
