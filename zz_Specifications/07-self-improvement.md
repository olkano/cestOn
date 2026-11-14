# Requested self-improvement and local activation

## Required experience

The operator can say, “The task list forgets my filter when I return. Keep it and apply the fix.” The assistant captures the expected behavior, reproduces the issue, edits a candidate, runs the required tests, compiles it, activates it locally, verifies the original journey, and reports the result. No additional approval is needed for that same eligible local change. A successful build alone never produces “fixed.”

The UI distinguishes improving cestOn from directing a project task. Show the product icon, “Improve cestOn,” the expected behavior, current release, and scope before work starts. A mobile request follows the same workflow as desktop. The update runs on the host and the phone reconnects to the verified release.

## Update lifecycle

States: `requested`, `clarifying`, `reproducing`, `implementing`, `verifying`, `staged`, `waiting_for_safe_point`, `activating`, `checking`, `applied`, `rolling_back`, `rolled_back`, `failed`, `needs_authority`. Persist each transition in both the task timeline and update record. The supervisor has its own activation journal, so it can recover when the coordinator is unavailable.

1. Resolve the request to cestOn, capture acceptance criteria, request hash, active release, source revision, task scope, and allowed files. Attach only user-selected diagnostics. If expected behavior is clear, begin immediately.
2. Reproduce against the current release using a focused regression test or deterministic browser scenario. If no reproduction is possible, produce a precise question or evidence-backed limitation; do not invent a passing reproduction.
3. Create an isolated candidate worktree at the active source revision, outside the live release directory. Record base commit and dirty-source status. Never absorb or overwrite concurrent edits. If no committed source baseline exists, create a content-addressed source snapshot without staging the operator's files and preserve provenance; public release still requires an auditable source revision.
4. Implement only the requested behavior. Scope tests to a synthetic state root and ports. Run focused regression, all affected unit/integration tests, types, lint, build, and mandatory update/security tests. UI changes require browser inspection in both themes at desktop and phone sizes.
5. Produce an immutable release bundle and manifest. Verify actual bytes, dependency lock, version, protocol range, database compatibility, test report hashes, and allowed file changes. The trusted supervisor recomputes hashes and checks policy; it never accepts the worker's assertion that a manifest is valid.
6. Start the candidate on a loopback test port with a consistent sanitized database snapshot. Exercise readiness, login/device fixture, task list, command receipt, SSE reconnect, and the original failing journey. No candidate test process can dispatch to real projects or provider accounts.
7. Wait for a safe point under the rules below. Freeze new command dispatch, flush the coordinator outbox, reconcile broker receipts, take and verify a consistent database/config backup, and record active/previous/candidate release IDs in the supervisor journal.
8. Stop only the coordinator, switch the active release pointer atomically, start the new coordinator, and reconnect it to the unchanged broker. Reconcile all outstanding commands before enabling dispatch. A drained broker update may restart the broker only after no owned process or uncertain run remains.
9. Verify readiness within 60 seconds, expected release/build ID, database schema, broker protocol, command counts, pending decisions, and the original journey with a designated synthetic canary task. Observe health for 120 seconds. Then mark `applied`, release the dispatch freeze, and notify the requesting device once.
10. On failed health or regression, keep dispatch frozen, roll back automatically, verify the previous release and state, then resume safe dispatch. Report `rolled_back`, the failed gate, and preserved work. Do not attempt another update automatically more than once for the same request without a new diagnosis.

## Eligibility and protected surfaces

| Change | Default local behavior |
|---|---|
| UI, ordinary API behavior, task summaries, non-sensitive bug fix | Apply automatically under the explicit fix request after all checks. |
| Coordinator logic compatible with existing broker protocol and database | Apply after reconciliation and safe-point checks. |
| Provider adapter or broker binary | Wait until all broker-owned runs finish or are explicitly paused; run both-provider certification. Never kill active work merely to update. |
| Additive backward-compatible database migration | Allowed only with tested old/new read/write compatibility, transactional migration, and rollback rehearsal. |
| Destructive migration or changed data meaning | `needs_authority`; prepare exact migration, backup, restore, downtime, and effects. Not eligible for routine self-update. |
| Authentication, pairing, authority checks, supervisor, signing/trust roots, update allowlist, secret handling | Protected change; prepare candidate and tests, then obtain explicit authority for the reviewed change. The existing fix grant does not silently include it. |
| New paid service, external deployment, public release, Git push, another repository | Separate authority; local improvement does not imply any of these. |

Protected paths are versioned in the supervisor's independent policy, covering the policy/auth/update modules, supervisor source and binaries, release verification tooling, tests used as mandatory gates, package lifecycle scripts, and configuration that can bypass those controls. Do not allow a worker to evade the check by moving code, changing import paths, adding a dependency side effect, or deleting a test. Inspect dependency graph and manifest diff in addition to path names. Ordinary self-improvement cannot modify its own activation rules. Protected test additions are allowed; weakening/deleting their assertions is a protected change.

Start the explicit protected inventory with `apps/supervisor/**`, `apps/server/src/auth/**`, `apps/server/src/authority/**`, `apps/server/src/updates/**`, `apps/broker/src/policy/**`, `packages/contracts/src/authority/**`, `scripts/verify-release.*`, `scripts/activate-release.*`, `tests/security/**`, and `tests/updates/**`. Changes to any package scripts, executable entry points, dependency lockfiles, or policy/config schemas require semantic classification even when their paths are outside this list. Store the inventory in the supervisor installation, with its hash in release evidence; candidate source cannot redefine it.

The supervisor is a trusted local component, not a hostile-agent sandbox. Candidate workers must run through a certified constrained profile with access to candidate files and synthetic data only. They do not receive supervisor IPC credentials, live state root, publication credentials, or operational connector secrets. If the host/provider cannot enforce this profile sufficiently for the declared trust model, leave automatic activation disabled and explain the capability gap instead of claiming isolation.

## Safe-point behavior

UI/coordinator-only updates may proceed while broker-owned agent work continues, provided the broker protocol is compatible and all queued commands are journaled. The coordinator reconnect must recover the same provider run IDs without redispatch. Test this under a long-running fixture and both certified providers before enabling it.

For broker/protocol changes, show “Waiting for 2 tasks to reach a safe point” with their names. The operator can choose “Apply when idle” or explicitly pause those tasks. Waiting is not failure and does not consume retry budget. Persist the pending update across reboot; recheck authority, artifact hash, and compatibility before activation.

Draft text and selected task survive the frontend update. The new service worker activates only when the API is ready and drafts are saved. If the phone reconnects to an older UI, prevent incompatible writes and show a refresh action. A disconnected device must not replay an old approval during update recovery.

## Manifest and pointer contract

The release manifest contains `releaseId`, `sourceRevision`, `sourceSnapshotHash`, `createdAt`, `requestId`, `baseReleaseId`, `files[{path,sha256,size}]`, `nodeMajor`, `lockfileHash`, `apiProtocol`, `brokerProtocolRange`, `schemaReadRange`, `schemaWriteVersion`, `migrationIds`, `testEvidenceHashes`, and `activationClass`. Canonicalize paths, reject traversal/symlinks leaving the bundle, and reject unexpected executables or lifecycle scripts.

Release directories are immutable after staging. The supervisor creates the active pointer using temp-write, fsync where supported, and same-volume rename. The pointer stores current, previous, update ID, and transaction phase. An interruption before switch keeps the old release; after switch but before verification rolls back unless health and the journal prove a completed activation. Never select a release by modification time.

Build workers cannot self-sign a trusted public update. For local source updates the supervisor verifies the authorized request, exact candidate hash, trusted test runner outputs, and scope. Public distributable updates use a separately provisioned signing policy and explicit release action; no signing private key is added to source or ordinary worker environments.

## Database rollback and crash recovery

Routine updates allow only schema changes compatible with the previous binary. Back up SQLite using its consistent backup mechanism, not a raw copy of the live database file without WAL. Verify that the backup opens and passes integrity checks. Keep the schema transaction journal and migration hashes.

During the freeze no new user write is acknowledged until it is durably journaled, and no incompatible migration runs while the broker can emit events the old schema cannot ingest. For a compatible migration rollback uses the same database without discarding newly persisted events. Restoring a backup is a distinct recovery operation that requires replay/reconciliation of broker receipts and accepted commands since the backup; never restore blindly and lose acknowledged work.

If both candidate and prior release fail, the supervisor serves a minimal loopback recovery interface and CLI showing sanitized status, previous releases, backup verification, and an explicit recovery command. Keep the broker alive where safe and dispatch frozen. Never enter an infinite restart/update loop.

## Verification gates

Mandatory tests: original bug reproduction fails before/passes after; a failed build cannot stage; a fake test report cannot activate; protected edits cannot auto-apply; candidate path escape is rejected; coordinator update preserves an active run; broker update waits; accepted command survives restart exactly once at broker receipt level; old decision is rejected after update; migration rollback preserves events; process kill at every journal phase recovers; health failure rolls back; rollback failure enters recovery; phone drafts survive and refresh uses correct release.

Report the active release, verification performed, remaining limitation, and rollback availability. “Applied locally” is distinct from “source committed,” “pushed,” and “publicly released.” Do not make those claims without separate evidence.
