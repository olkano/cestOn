# Implementation sequence

Execute all local phases after an implementation request. This document is sufficiently ordered to use directly as a cestDone specification or another agent's plan input; it does not grant the external writes excluded by `00-start-here.md`. Record actual outcomes in `implementation-status.md`. Do not mark phase completion from file presence alone.

## Common phase procedure

Read the phase contracts. Identify affected modules and test IDs. Add failing behavior tests for the main logic, implement, run the focused suite, inspect the diff, and run the phase gates. Fix failures before declaring the phase done. Update the ledger and proceed immediately to the next unblocked phase. After three unsuccessful attempts at the same issue, record its reproduction and continue independent work; do not abandon the whole project or fabricate a pass.

All commands below are required package-script contracts to create in phase 0. Before they exist, do not claim they have run. `npm run verify` must execute typecheck, lint, unit, integration, browser E2E, build, and documentation checks in that order and return nonzero on any failure. It must not run live providers, publish, send notifications, or activate a service. Live and manual suites are separate explicit commands.

## Phase 0: scaffold and capability baseline

Read: `02-architecture.md`, `04-provider-adapters.md`, `06-security-and-authority.md`, `11-research-and-decisions.md`.

1. Inspect the clean/new workspace and create npm workspaces with the prescribed apps/packages. Select a supported Node LTS major and compatible exact dependency versions; record versions and lockfile. Add `.node-version`, package `engines`, strict tsconfigs, ESLint, Vitest, Playwright, and consistent formatting.
2. Implement shared config parsing, structured redacted logger, installation/data-root validation, fixture IDs, and test-root cleanup. Development ports: web 4317, API 4318; tests use dynamically allocated ports. Never kill an unrelated process to free a port.
3. Add `dev`, `build`, `typecheck`, `lint`, `test:unit`, `test:integration`, `test:e2e`, `test:security`, `test:updates`, `test:providers:fixture`, `test:providers:live`, `test:docs`, `verify`, `package:local`, and `doctor` scripts. Live tests require `CESTON_LIVE_TESTS=1`, a synthetic workspace manifest, and explicit configured profiles.
4. Implement fixture adapters with deterministic event streams, configurable failures, delayed acknowledgement, duplicate events, and crash points. No fixture can access an actual provider endpoint.
5. Probe installed provider executables without starting real work. Record API/schema/auth capability only, not secrets. Run the bounded live capability test only if available and authorized. Establish a pinned Codex and Claude profile; missing live access leaves their certification gates blocked while fixture development continues.
6. Add the manifest/icon generation script and a basic shell with the supplied icon. Add dependency/source notices placeholders without asserting resolved third-party licensing.

Gate: clean `npm ci`, `npm run verify` on the minimal fixture, T01/T02, plus capability evidence. No provider failure may be hidden by selecting a fixture under the same display name.

## Phase 1: durable domain and command service

Read: `03-data-and-api.md`, `06-security-and-authority.md`.

1. Implement SQLite schema/migrations and repositories, scope revisions, task/phase/decision state machines, event projection, and dependency-cycle checks.
2. Implement command schemas, idempotency, revision validation, transactional outbox, and event cursors. Write crash-injection tests around transaction commit and dispatch acknowledgement.
3. Implement canonical project roots, writer/resource leases, broker receipt journal, bounded history, and reconciliation interfaces with fixtures.
4. Implement limits, retry classification, freshness, and pruning policies. Test that active/unresolved records survive cleanup.

Gate: T03-T07 and T25; `typecheck`, `lint`, unit and integration pass. State-machine coverage includes forbidden transitions, not only the happy path.

## Phase 2: providers, observation, and ownership

Read: `04-provider-adapters.md` and security execution controls.

1. Build the broker as a separate process with authenticated owner-restricted IPC and persistent receipts. Verify process identity before reconnect or kill.
2. Implement Codex and Claude adapters, probe results, bounded metadata discovery, exact-ID history, start, resume, normalized events, and interruption. Hide unsupported active steering.
3. Implement observe-only session linking, explicit handoff, new-session continuation, and stale-owner handling. Do not write provider transcript storage.
4. Implement the optional cestDone adapter only through isolated configuration and executable invocation. If its baseline fails isolation, record the optional limitation and leave it disabled.
5. Exercise failure categories, token/usage aggregation, unknown cost, provider expiry, process loss, and cancellation watchdog.

Gate: T08-T11, T26 and all fixture-provider tests. Both live provider certifications are required before calling managed execution production-ready; missing access does not prevent later fixture-backed phases.

## Phase 3: scheduler and conversational assistant

Read: `01-product.md`, command/API contracts, authority rules.

1. Implement a bounded phase planner producing a strict phase/dependency/verification schema. Validate before saving. Use registered profiles and task budgets; the model cannot grant operations or change caps.
2. Implement eligible-phase scheduling, locks, concurrency, priority, pause/stop/resume, bounded retry, and verification. A completed worker result is reviewed against actual artifacts and required tests before phase completion.
3. Implement the assistant context builder with task summaries, evidence cursors, a bounded message window, and explicit target IDs. Route model output through typed intents into the existing command service.
4. Implement ambiguity handling, exact-option decisions, scope-change requests, source intake, review packets, and external-action preparation/approval contracts. Use a fake external action service for tests, not actual email/CRM.
5. Implement overview/briefing responses grounded in current state and a deterministic fallback when the model is unavailable. Persist user decisions and their scope; do not promote them into global preferences automatically.

Gate: T12-T16 and model-contract fixtures covering wrong task, stale option, malformed intent, source injection, automatic phase continuation, limits, and failed verification. `npm run verify` passes.

## Phase 4: authenticated desktop and mobile UI

Read: `05-experience-and-mobile.md`, `06-security-and-authority.md`, design prototype.

1. Implement pairing, device sessions, revocation, CSRF/origin checks, SSE authorization, and rate limits before enabling non-loopback reachability.
2. Build Today, Work, task detail/history/evidence, Needs me, Assistant, and Settings. Use shared contracts and actual fixture/server state, not prototype strings.
3. Implement dark/light/system tokens, supplied icon, desktop density, mobile navigation, drafts, keyboard/focus management, all loading/empty/error states, and route restoration.
4. Implement command acknowledgements and reconnect with revision-aware resync. UI cannot optimistically claim a command was executed before broker evidence.
5. Add Playwright coverage for U01-U08 and U11-U17 using real local API and fixture providers. Run visual inspection separately from DOM assertions.

Gate: T17-T20, T27; desktop 1440x900 and 1920x1080, mobile 390x844 and 360x800, tablet 768x1024; both explicit themes and system switch. `npm run verify` and `test:security` pass.

## Phase 5: installable phone, voice, and notifications

Read: mobile specification and operations remote setup.

1. Implement manifest and all icon sizes, service worker asset-only cache, install help, standalone detection, safe-area handling, and offline shell/drafts.
2. Implement voice adapter interfaces, fixture speech, configured server transcription/TTS, browser playback fallback, permission denial, cancel, limits, and audio deletion. Do not hard-code a speech model or silently enable a paid API.
3. Implement durable in-app notifications, per-device push subscriptions, generic payloads, deduplication, retry/removal, deep links, and revalidation on open.
4. Exercise mobile network disconnect/reconnect and app close/reopen. Generate a real-device test card and run it on accessible Android/iOS devices. Do not equate Playwright WebKit with an installed iOS app.
5. Prepare HTTPS/tunnel configuration examples without modifying an existing tunnel. If remote pilot activation is authorized, provision only the named target and run read-back/security checks.

Gate: T21-T24 and T28. Phone install, real audio, and lock-screen push gates can remain explicitly blocked if hardware/permissions are unavailable; local product work proceeds. No native wrapper is required.

## Phase 6: operations and supervisor foundation

Read: `07-self-improvement.md`, `10-operations-and-release.md`.

1. Implement immutable release packaging, manifest verification, separate supervisor, active pointer, health/readiness contracts, startup task installer, doctor, and exact-scope uninstall.
2. Implement consistent backup/restore, broker recovery, log rotation, retention, and safe migration policy. Rehearse recovery on isolated data.
3. Build local candidate launch and canary test harness, with fixture-only state and denied operational dispatch. Implement dispatch freeze/reconciliation and prior-release recovery UI/CLI.
4. Test coordinator restart during an active broker run and user sign-in/locked-session behavior. A service running under the wrong identity fails doctor checks.

Gate: T25/T29/T30; `test:updates` and the full local verification suite pass. Actual persistent pilot installation requires the separately stated activation authority.

## Phase 7: requested self-improvement

Read the complete self-improvement specification before edits.

1. Add the Improve cestOn route/intent, issue capture, request authority, acceptance criteria, update state machine, and protected-change classification.
2. Implement isolated worktree/snapshot preparation, regression-first implementation prompt, trusted test execution, build and manifest validation, and local activation eligibility.
3. Implement safe-point waiting, atomic switch, post-switch verification, automatic rollback, and journal-based recovery. Do not let the updater worker change its own verification policy.
4. Persist frontend drafts through update and reconnect. Report local application separately from Git/publication.
5. Run a full self-improvement scenario: seed an intentionally broken filter in a test release, request the fix through the actual UI, run a managed test worker to produce the candidate, activate it, and verify persistence. Repeat with a failing candidate and a protected change.

Gate: T31-T35 plus all security/update tests. Fixture success alone does not establish that the real coding adapter can build and apply a candidate; perform the capped real-provider self-improvement certification in an isolated installation.

## Phase 8: complete journey and resilience rehearsal

1. Run every U01-U18 journey from the UI against fixture providers and the real local API. Inspect screenshot sets in both themes, not only automated snapshots.
2. Perform the manual desktop, mobile, recovery, and self-update procedures in `09-acceptance-tests.md`. Record unavailable hardware/provider gates honestly.
3. Seed five tasks with mixed ownership and states, disconnect/reconnect, race two devices, interrupt processes, exhaust budgets, expire credentials, and activate/roll back updates.
4. Verify resource cleanup and that no real source project, schedule, external recipient, or operational configuration changed.
5. Fix all blocking failures and rerun affected plus cross-cutting tests. Measure the stated performance and interaction goals.

Gate: T01-T36, complete evidence matrix, no known wrong-target/duplicate-effect/authentication/update-integrity failure. `npm run verify` passes from a clean install.

## Phase 9: handoff and release preparation

1. Update README to actual commands and limitations. Create focused setup, upgrade/recovery, provider certification, and contributing guides. Preserve historical references privately.
2. Generate a local install bundle with checksums, reproducible icon derivatives, dependency notices, source revision, and an explicit support matrix. Rehearse installation into a new user-data root and uninstall without touching projects.
3. Prepare the public export from an explicit allowlist. Scan it and its planned history for personal environment details, secrets, reference-private files, logs, and test evidence. Make agent guidance portable before public collaboration.
4. Confirm owner-selected license and name/repository/package availability at release time. Do not inherit the unresolved cestDone license statement or copy its source.
5. If local activation was requested, install the verified pilot, verify active version and recoverability, and record its exact target. If publication was explicitly requested, follow the release checklist and verify the resulting remote/artifact. Otherwise leave these operations prepared and report them as not performed.
6. Complete the status ledger and final report, listing implementation, local pilot, device/provider certifications, and public release separately. Stop only after all authorized work is complete and remaining external gates are explicit.

Gate: T36 clean-checkout/public-export rehearsal; required manual evidence complete or clearly blocked. No “all done” claim while mandatory product acceptance remains unverified.
