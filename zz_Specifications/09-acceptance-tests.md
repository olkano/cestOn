# Verification and manual acceptance

## Test isolation

Every automated suite creates a unique temporary root containing a marker with run ID and installation ID. Refuse to use a root without that marker or under a registered real project. Bind loopback only, use dynamic ports, and track exact child PID/start time. Cleanup removes only validated descendants of that root, revokes test subscriptions, stops owned processes, and confirms no leaked locks or listeners. Never delete a directory by an unchecked computed path.

Fixture mode has no outbound network, provider credentials, mail, CRM, Git push, tunnel, or operational scheduler access. Live tests require `CESTON_LIVE_TESTS=1`, explicit profiles, and an approved synthetic project manifest. Cap initial provider certification at four turns and five minutes per provider; the isolated self-update certification permits one request, eight turns, and 15 minutes. Metered tests require an explicit spend ceiling. Stop at the limit and record the incomplete gate.

Automated test results and screenshots are evidence, but physical installation, microphone, push delivery, and actual provider controls require the manual/live checks below. A test may be `pass`, `fail`, `blocked`, or `not_applicable` with a reason. Use `not_applicable` only for an explicitly optional capability, never missing hardware for a required platform claim.

## Project-memory extension

The revised daily workflow additionally requires [M01-M09](13-project-memory.md), covering durable knowledge, relationships, priorities, corrections, staleness, forgetting, recovery, scope and user interaction. All are pending; existing T01-T36 results do not cover them.

## Required test inventory

| ID | Setup/action | Required result |
|---|---|---|
| T01 | Fresh install of dependencies and build with pinned runtime | No undeclared sibling dependency; package scripts exist; build is reproducible from lockfile. |
| T02 | Invalid config, overlapping roots, occupied port, wrong identity | Clear diagnostic; no fallback to operational data, arbitrary port, or different user profile. |
| T03 | Create/update task, restart database process | Same IDs, revisions, scope, and event ordering survive. |
| T04 | Send same command twice, then same key with different body | One receipt/effect; original receipt returned; changed body gets 409. |
| T05 | Kill coordinator before/after commit, dispatch, and broker ack | Durable intent reconciles; no duplicate provider start; uncertain state remains visible. |
| T06 | Two devices answer same decision; expire/supersede it | One answer; stale/conflicting reply rejected without effect. |
| T07 | Competing writers, junction aliases, reused PID, dependency cycle | One canonical writer; no false lock release; cycles rejected. |
| T08 | Enumerate synthetic Codex/Claude histories, include malformed records | Correct exact IDs and metadata, bounded reads, unknown state instead of guessed status. |
| T09 | Start, exact resume, and interrupt each provider | Correct session/run target; acknowledgement and terminal evidence; no unrelated process killed. |
| T10 | Send while busy; duplicate/reorder provider events | Supported steer or honest queue; monotonic projection; no duplicate completion. |
| T11 | Adopt running, stopped, and uncertain external sessions | Running/uncertain remain observe-only; stopped explicit handoff records new owner/session. |
| T12 | Three-phase task, one verification fails | Authorized phases continue; failure blocks completion; retry cap respected. |
| T13 | Time/turn/spend limits, rate limit, auth expiry | Correct error class, bounded retry, preserved evidence, no silent provider switch. |
| T14 | “Option two” with one target, two targets, stale target | Exact answer, clarification, and rejection respectively. |
| T15 | Source text commands a publish or credential change | Content remains data; no authority expansion or external operation. |
| T16 | Pause one/all, fail one interruption, resume one | Dispatch freezes; partial acknowledgement visible; only selected task resumes. |
| T17 | Desktop/phone UI, both themes, long/empty/error content | No clipped required actions, horizontal page overflow, inaccessible labels, or wrong-task routing. |
| T18 | SSE disconnect, old cursor, revoked device | Stale indicator, resync, and immediate access loss; no skipped pending decision. |
| T19 | Offline instruction then reconnect with changed revision | Draft remains unsent; explicit send validates current state; no automatic replay. |
| T20 | Keyboard, screen reader names, 200% zoom, reduced motion | Focus retained, controls reachable, announcements useful, motion preference respected. |
| T21 | Install PWA on Android and iOS physical devices | Supplied icon, standalone launch, correct route/auth, no browser-only claim substituted. |
| T22 | Record/transcribe/cancel/deny mic, read aloud/stop | Clear permission behavior, correct task target, temporary audio removed, text fallback. |
| T23 | Deliver push to locked device, tap twice, stale decision | Actual device receipt recorded; authentication/deep link correct; no repeated action. |
| T24 | Update service worker with draft/voice in progress; rollback | No lost draft, controlled refresh, compatible API/UI, prior assets recoverable. |
| T25 | Cleanup and consistent backup/restore with WAL active | Active rows retained; verified backup; no lost acknowledged commands after reconciliation. |
| T26 | Optional cestDone with hostile inherited config | Operational settings never loaded; notifications/Git effects disabled; unavailable if isolation fails. |
| T27 | Auth/CSRF/origin/host/path/upload/XSS tests | Unauthorized action blocked; generic error; secrets absent from response/log. |
| T28 | Host awake/locked/asleep/offline; phone closes app | Locked host continues if certified; asleep/offline marked stale; closing phone does not stop work. |
| T29 | Coordinator update while broker executes long task | Same run/session survives, completion reconciles once, no duplicate dispatch. |
| T30 | Broker update with active work; supervisor/process crash | Waits for safe point; journal recovery deterministic; no orphan writable process. |
| T31 | Request UI fix through assistant | Before-test fails, candidate fixes it, tests/build pass, local apply verifies original journey. |
| T32 | Build failure, forged evidence/hash, traversal, protected edit | No activation; clear failed/needs-authority result; live release unchanged. |
| T33 | Candidate fails health after switch | Automatic rollback, previous version verified, task state and drafts retained. |
| T34 | Kill each activation stage; incompatible DB; rollback fails | Deterministic recovery or explicit frozen recovery mode; no blind restore/restart loop. |
| T35 | Two simultaneous improvement requests, new source edits, stale base | Serialized update lease, isolated candidates, stale candidate rebuilt/reverified; unrelated edits preserved. |
| T36 | Clean install/export/package/uninstall rehearsal | No private files/secrets, all required docs/assets, independent setup, exact cleanup, no false release claim. |

## Manual A: desktop daily operation

Prerequisite: isolated installation with fixture providers, five tasks across two generic projects, and one unowned session. Record build, browser, viewport, and theme. Repeat in dark and light.

1. Open Today at 1440x900. Identify the one decision without opening provider history. Open it, read alternatives, choose the second, and verify queued/accepted/running states against the server receipt.
2. Open the task history and evidence. Confirm goal, current phase, verification, and next action agree with the database fixture. Use Back and verify filter/scroll restoration.
3. Start a task with a multi-step outcome. Leave the page. Return and verify progression through authorized phases without an acknowledgement between them.
4. Send an instruction while the agent runs. Verify the delivery label matches actual adapter capability. Pause it and wait for acknowledgement. Resume only that task.
5. Open the observe-only session. Attempt a write and verify the handoff explanation. Complete the synthetic stopped-session handoff and verify both old and new session references.
6. Ask the assistant for the overview and for “option two” without a selected decision. Confirm the answer is grounded and ambiguity triggers one question, not a guessed mutation.
7. Inspect keyboard focus, 200% zoom, long titles, empty lists, failed checks, and unavailable provider. Save screenshots of the actual states, then clean up the fixture.

## Manual B: phone installation and operation

Run separately on an accessible Android device and iPhone. Record model, OS, browser, standalone mode, network type, and build. If no physical device is available, mark the relevant platform gate blocked and continue other tests.

1. Open the isolated HTTPS pilot URL, pair through the one-time invitation, then install using the platform's available install/Home Screen flow. Close the browser and open the supplied cestOn icon. Confirm a standalone app, retained authentication, and working navigation.
2. Repeat the desktop decision flow with one hand. Confirm readable alternatives, at least 44 px touch targets, no off-screen submit, and correct keyboard/safe-area layout. Repeat dark and light and portrait/landscape.
3. Dictate a task instruction, inspect/edit the transcript, send, and observe acceptance. Deny microphone permission once and verify text remains usable. Play a briefing, stop it, lock/unlock the phone, and record actual playback behavior without assuming background support.
4. Enable notifications through a deliberate tap. Lock the phone, trigger one synthetic decision, and confirm receipt on the device. Tap twice and confirm one navigation/command result. Test a decision resolved on desktop before the tap.
5. Disable network, draft an instruction, close/reopen the app, restore network, and explicitly send after inspecting current task state. Verify one receipt. Revoke this device from desktop and confirm the app loses API/SSE access and clears private drafts.
6. Remove test subscriptions and pairing tokens, delete temporary audio, stop the isolated HTTPS fixture, and record cleanup. Never send test pushes to an operator's unrelated installed application.

## Manual C: provider certification

Use one synthetic Git project and one synthetic document folder. Existing provider authentication may be used only under the stated live-test authorization. Do not inspect unrelated history or execute real project work.

1. Ask each provider to create a trivial local artifact and a test in the synthetic root. Verify the artifact independently, record provider/session IDs only in private evidence, and verify usage/billing reporting or explicit unknown status.
2. Resume the exact session with a distinct instruction. Verify another session in the same folder is unchanged. Send while running and check the advertised steer/queue capability.
3. Interrupt a deliberately long, harmless operation. Confirm the process exits or acknowledgement remains pending, and that the workspace lease is not released prematurely.
4. Attempt a synthetic forbidden operation outside the allowed root and a forbidden external tool. Confirm denial under the configured profile. If it executes, fail managed-policy certification and do not describe the profile as constrained.
5. Restart the coordinator during a broker-owned run. Confirm same session continuity and one completion. Remove all synthetic worktrees/processes and retain only sanitized evidence.

## Manual D: self-improvement and rollback

Use a disposable installed cestOn release and fixture data, never the agent's currently serving production environment. Make the task-list filter intentionally reset on navigation. Record the failing browser check first.

1. From desktop, then from phone in a separate run, request “Remember the task-list filter when I return and apply the fix.” Verify one update task with captured acceptance criteria and local authority.
2. Allow the managed worker to implement, build, and stage. Inspect that only candidate files change and that source dirty edits outside the candidate remain untouched. Follow progress from the second device.
3. Keep a long fixture task running. Activate a coordinator/UI-compatible candidate. Verify the original task survives, the phone reconnects, a draft survives, and the filter now persists. Confirm displayed active release agrees with supervisor read-back.
4. Request a broker-changing update and verify waiting-for-idle. Do not pause tasks unless explicitly chosen.
5. Repeat with a candidate that fails readiness after switch. Observe automatic rollback, preserved task/command records, and a useful explanation. Repeat interruption at each activation journal stage using the test harness.
6. Request disabling authorization checks. Verify the change cannot auto-apply under ordinary improvement authority. Prepare a proposal only; do not actually disable checks for the test.
7. Verify cleanup: no duplicate provider runs, abandoned listeners, candidate data in live roots, or leaked test credentials. Record all T31-T35 outcomes.

## Evidence and performance

For the five-task fixture, first useful Today content should render within 2 seconds after authenticated API availability on the development host; a local command receipt should return within 500 ms excluding model inference; state changes should appear within 2 seconds on a healthy local connection. Measure p95 over 30 repetitions, recording hardware and mode. Treat these as engineering targets, not universal network guarantees. A missed target needs diagnosis and an explicit accepted limitation before release.

Evidence template: `testId | build | mode | platform | steps/command | expected | observed | evidence path | cleanup | result | blocker`. Do not use “manual tested” without steps and observations. Keep personal screenshots and detailed provider IDs in ignored evidence. Publish only generic acceptance summaries.
