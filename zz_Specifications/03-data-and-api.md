# Data, commands, and HTTP contracts

The baseline schema below is not sufficient for U19. [Project memory](13-project-memory.md) requires additional versioned notes, optional relationships, provenance and deletion handling. Specify and test the minimal migration/API contract for each implementation increment; a complete ontology or new storage service is unnecessary. No memory endpoints are claimed here as implemented.

## Schema conventions

Use UUIDs for internal IDs, UTC ISO timestamps on the wire, integer UTC milliseconds in SQLite, and monotonic durations within a process. Every mutable aggregate has integer `revision`, starting at 1. Reject unknown JSON fields, cap text sizes, and generate OpenAPI plus browser types from shared Zod contracts. Database columns below are mandatory; implementation may add indexed projections without changing meaning.

| Table | Required fields and constraints |
|---|---|
| installations | id, schema_version, created_at, active_release, dispatch_paused; one row |
| devices | id, display_name, token_hash, created_at, last_seen_at, expires_at, revoked_at; unique token hash |
| projects | id, display_name, canonical_root, kind, config_json, revision, archived_at; unique canonical root |
| tasks | id, project_id, title, goal, state, priority, scope_revision_id, revision, created_at, updated_at, next_action, summary_cursor |
| task_dependencies | task_id, depends_on_id; unique pair; reject self-edge and cycles transactionally |
| scope_revisions | id, task_id, revision, allowed_operations_json, roots_json, resources_json, budgets_json, completion_boundary, authority_source, created_at; immutable |
| sessions | id, provider, provider_session_id, provider_home_id, project_id, task_id nullable, ownership, observed_state, observed_at, evidence_cursor; unique provider/home/provider ID |
| runs | id, task_id, phase_id, session_id, state, broker_receipt, provider_turn_id, started_at, ended_at, attempt, usage_json, error_code |
| phases | id, task_id, ordinal, goal, dependencies_json, verification_json, state, attempt_count, max_attempts, revision |
| commands | id, task_id nullable, device_id, idempotency_key, payload_hash, type, payload_json, expected_revision, scope_revision_id, state, created_at, accepted_at, resolved_at, error_code; unique device/key |
| outbox | command_id unique, next_attempt_at, attempts, claimed_at; tied transactionally to commands |
| decisions | id, task_id, revision, prompt, options_json, evidence_cursor, expires_at, state, chosen_option_id, command_id; immutable content per revision |
| action_approvals | id, task_id, revision, target_json, current_hash, proposed_hash, effects_json, verification_json, expires_at, approved_command_id, state |
| events | sequence autoincrement, event_id unique, aggregate_id, aggregate_revision, type, sanitized_payload_json, created_at, provider_event_key nullable unique |
| evidence | id, task_id, run_id nullable, kind, content_hash, relative_blob_path, source, observed_at, retention_class; no arbitrary remote filesystem paths |
| leases | resource_key primary key, task_id, run_id, broker_owner_nonce, acquired_at, renewed_at, state |
| updates | id, task_id, state, base_release, candidate_release, request_hash, artifact_hash, scope_revision_id, supervisor_receipt, verification_json, last_error, created_at, updated_at |
| notifications | id, task_id, decision_id nullable, dedup_key unique, status, attempts, created_at, read_at |
| push_subscriptions | id, device_id, endpoint_encrypted, keys_encrypted, created_at, disabled_at; endpoint hash unique |

Store sanitized user-visible conversation messages in task events. Bound individual text to 32 KiB, titles to 160 characters, and page results to 100 rows. Full provider transcripts remain in provider-owned storage; only explicitly selected excerpts become evidence. Sources and uploads have content hashes and a project-scoped duplicate key.

## State machines

Task states: `draft`, `queued`, `running`, `waiting_input`, `blocked`, `pausing`, `paused`, `review_ready`, `completed`, `cancelled`. Observation freshness (`fresh`, `stale`, `unknown`) is separate from task state. Completion requires satisfied phase verification and the declared review boundary. `review_ready` becomes `completed` through user acceptance or a scope that explicitly permits automatic final acceptance. Neither state means a deployment occurred.

Run states: `created -> starting -> running -> verifying -> succeeded`. Any active state may enter `interrupting`, `failed`, or `reconciling`; `interrupting -> interrupted` needs broker acknowledgement. A lost process enters `reconciling`, then a proven terminal state or `needs_attention`. No transition from interrupted to succeeded without a new verified run.

Command states: `received -> queued -> dispatching -> accepted -> running -> succeeded`. `rejected` is validation/authority failure before effect; `failed` is a known unsuccessful attempt; `reconciling` means possible effect without enough evidence; `cancelled` means proven not executed or acknowledged cancellation. Do not rewrite failed command IDs for retries; create a linked retry command only after reconciliation and authority checks.

Decision states: `open -> answered`, `expired`, or `superseded`. Answer and dispatch outbox insertion are atomic. A second answer returns the first receipt if identical; a conflicting choice returns 409. Decision revision, scope revision, and expected task revision must all match. Updating scope invalidates old approvals and decisions that depend on it.

Phase states: `pending`, `eligible`, `running`, `verifying`, `done`, `waiting_input`, `blocked`, `cancelled`. Dependency cycles are rejected before save. Priority changes affect only eligible not-yet-dispatched work. Pause freezes new dispatch before interrupt requests go out. Resume never implicitly resumes other tasks.

## HTTP API

All authenticated routes use `/api/v1`. JSON responses use `{data, meta:{requestId, revision?}}`. Errors use `{error:{code,message,retryable,details?}, meta:{requestId}}`; omit stack traces and sensitive values. Apply authorization to every route, including event streams and evidence downloads. Use 400 malformed, 401 unauthenticated, 403 forbidden, 404 missing, 409 stale/conflict, 413 too large, 422 unsupported capability, 429 rate limit, 503 dependency unavailable.

| Method and path | Contract |
|---|---|
| GET `/health/live` | Process liveness only; no private metadata, usable without auth. |
| GET `/health/ready` | Authenticated readiness and component compatibility; returns 503 during recovery. |
| POST `/pairing/redeem` | One-time short-lived invitation plus device name; issue HttpOnly session cookie. Rate limit; see security spec. |
| GET `/me` | Installation ID, device ID, display preferences, supported capabilities, CSRF token. |
| DELETE `/devices/:id` | Revoke device, push subscription, and live streams; current-device revoke logs out. |
| GET `/projects`, GET `/tasks` | Cursor pagination; task filters include state, project, search, attention. |
| GET `/tasks/:id` | Goal, revision, scope summary, phases, current decision, freshness, evidence links. |
| GET `/tasks/:id/events?after=` | Bounded historical timeline with monotonic cursor. |
| GET `/sessions` | Metadata only by default; exact IDs scoped to registered projects. |
| GET `/sessions/:id/history?cursor=` | Bounded on-demand excerpt, sanitized and authorized. |
| POST `/commands` | Typed commands below, `Idempotency-Key` required; returns 202 with command ID and status URL. |
| GET `/commands/:id` | Current receipt, acknowledgement, effect, and verification status. |
| POST `/conversation` | Text, current task/decision IDs, revision, client message ID; emits answer or typed intent proposal. Mutating intent uses the command service, never a separate execution route. |
| POST `/intake` | Text or multipart supported file; 10 MiB cap, content hash, type check, source ID; no remote URL fetch by default. |
| GET `/evidence/:id` | Scoped streaming download, content disposition attachment for untrusted formats. |
| GET `/events?after=` | SSE of sanitized state changes. Authenticate, authorize, and honor cursor. |
| POST `/voice/transcribe` | Streaming or bounded audio upload; 60-second/10-MiB cap; returns transcript only, never dispatches it. |
| POST `/voice/speak` | Bounded text from an authorized summary; returns audio or a capability error. |
| POST `/push/subscriptions` | Per-device browser subscription; validate HTTPS endpoint and provider allowlist, encrypt stored secrets. |
| DELETE `/push/subscriptions/:id` | Revoke own subscription. |
| GET `/updates/:id` | Current stage, active/candidate release, verification, rollback availability. |

`POST /commands` common envelope:

```json
{"type":"decision.answer","taskId":"task-uuid","expectedRevision":12,"scopeRevisionId":"scope-uuid","payload":{"decisionId":"decision-uuid","decisionRevision":3,"optionId":"apply-existing"}}
```

The coordinator, not the model, fills `device_id`, `scope_revision_id`, and authority evidence from the authenticated request and stored task. A browser-supplied scope ID is a concurrency assertion, not proof of permission. For `task.create`, the expected revision is omitted and the server validates the requested scope against the selected project profile before creating its first scope revision. Optional `sourceIds` must belong to that project; their extracted content remains untrusted source material.

Command variants: `task.create` (projectId, title, goal, requestedScope), `task.instruct` (text, deliveryMode), `decision.answer`, `task.pause`, `installation.pause`, `installation.resume`, `task.resume`, `task.cancel`, `task.prioritize` (priority, dependencyIds), `task.accept`, `session.adopt` (sessionId, handoffEvidenceId), `action.approve` (approvalId, revision, proposedHash), `assistant.improve` (description, acceptanceCriteria, applyLocally), and `update.rollback` (updateId, targetRelease). Every variant has its own strict schema; no shell/executable/config blob variant exists. Installation pause/resume checks the installation revision. Resume releases the installation dispatch freeze and leaves individually paused tasks paused; a task resume never releases the installation freeze.

Use a client-generated UUID idempotency key retained until a command is resolved. Same device/key and same canonical payload returns the original result, even after restart. Same key and different payload returns 409. Retain keys as long as command records; pruning creates non-reusable tombstones for a further 180 days. Clients do not auto-resend unresolved writes under a new key.

## SSE and reconnect

`GET /snapshot?after=0` captures state and its event cursor in one read transaction. Each page contains at most 100 tasks, totalTasks and nextCursor. Additional pages include `expectedCursor` from the first page; any intervening event returns `409 snapshot_changed` so the client restarts the snapshot instead of merging inconsistent decisions. Project pages contain no host paths. Generated request schemas are in `docs/api.openapi.json`; browser command and request types derive from the shared Zod contracts.

Emit `id: sequence`, `event: task.changed|command.changed|decision.changed|update.changed|host.status`, and JSON `{eventId,aggregateId,revision,occurredAt,data}`. Heartbeat every 15 seconds. Client marks connection stale after 45 seconds without a heartbeat, reconnects with exponential backoff capped at 30 seconds plus jitter, and requests changes after the last committed cursor. A cursor older than retention returns a `resync_required` event and a full snapshot route; never silently skip missing decisions. Disconnect when a device is revoked.

## Transactions and tests

In one transaction: validate revision and authority, insert command, update decision if applicable, append events, create outbox. Broker dispatch is outside that transaction. Do not hold a database transaction during model calls or tool execution. Test competing clients, duplicate keys, reordered provider events, SQLite busy handling, crash at every boundary, and expired approvals with deterministic fixtures.

## Model and worker envelopes

The intent interpreter receives only the selected task/decision IDs and revisions, authorized bounded summaries, current message, and permitted intent types. It returns one discriminated result: `answer` with text and evidence IDs, `clarify` with one question and optional choices, or `propose_command` with a typed command payload and human-readable interpretation. Reject invented IDs, unknown fields, malformed output, and evidence outside the supplied set. Retry malformed interpretation once with the schema error; then show a usable text error without mutation.

A phase plan contains `goal`, `phases[{id,ordinal,goal,dependsOn,allowedRecipeIds,expectedArtifacts,verificationRecipeIds,decisionBoundary}]`, and `completionBoundary`. Validate acyclic dependencies, phase count, known recipes, registered paths, and allowed operations before persistence. The model cannot insert executable command strings as verification recipes; project setup owns the recipe registry.

A worker completion contains `runId`, `phaseId`, `status: succeeded|failed|needs_input`, `summary`, `artifactRefs`, `claimedChecks`, `nextAction`, and optional `decisionProposal`. Treat claimed checks as leads to independently collected runner results, not proof. The verifier checks expected artifact hashes, trusted test process exits/results, and scope before recording phase completion. A deterministic fixture model must cover malformed output, invented targets, fabricated evidence, and a convincing but false success report.
