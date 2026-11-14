# Acceptance evidence

Statuses describe observed scope. Fixture passes never establish native/provider or physical-device acceptance. Exact command outputs and screenshots stay in ignored evidence; the [checkpoint](implementation-run.md) identifies those records and the [implementation ledger](implementation-status.md) owns overall status.

| ID | Local evidence | Result / remaining gate |
|---|---|---|
| T01 | Pinned runtime, lockfile, build and package scripts | Independent allowlist export, script-free npm ci, distributed binary load, all local gates and current package/archive read-back pass |
| T02 | Config/path validation, strict ports, owner ACL, occupied-owner rejection | Local pass, including occupied-port refusal without killing the listener and exact broker/owner diagnostics |
| T03 | Commands, database concurrency and schema migration integration tests | Local pass |
| T04 | Command idempotency, broker receipts and lost browser acknowledgement E2E | Local pass |
| T05 | Actual commit-boundary process kills, outbox reconciliation and broker journal tests | Fixture pass; native process-loss certification blocked |
| T06 | Immutable decisions/approvals, two-device conflicting UI replies | Local pass |
| T07 | Canonical paths/junctions, leases, dependency cycles and reused PID checks | Local pass |
| T08 | Bounded synthetic history discovery, exact IDs, malformed/link rejection, UI read | Local pass |
| T09 | Codex transport and Claude SDK targeting/interruption fixtures | Fixture pass; both native profiles blocked |
| T10 | Duplicate/reordered fixture events, honest instruction queue, exact turn controls | Fixture pass; native steering/interruption evidence blocked |
| T11 | Observe-only/uncertain/stopped ownership tests, UI history and new continuation | Fixture pass; native handoff unavailable and cannot write unmanaged sessions |
| T12 | Independent artifact/recipe checks, failed verification cap, three automatic UI phases | Fixture pass; native recipes blocked |
| T13 | Immutable budgets, certificate expiry, unknown billing refusal and retry tests | Fixture pass; actual native caps/auth expiry blocked |
| T14 | Selected decision intent tests, stale-target rejection, ambiguous UI clarification | Local pass |
| T15 | Project-scoped source/PDF intake, injection rendered as text, immutable action scope | Local pass |
| T16 | Pause acknowledgement/lease retention, global freeze and selected resume | Fixture pass |
| T17 | Five viewport sizes, both themes, empty/long/error content and exact task routes | Local Chromium pass; physical browsers blocked |
| T18 | SSE cursor resync, immediate revocation, revoked API/private UI clearing | Local pass |
| T19 | Offline unsent draft, changed-state explicit retry, reload with original command key | Local pass |
| T20 | Role/name assertions, keyboard focus, 200% zoom, reduced motion and system theme | Local browser pass; assistive-device acceptance unverified |
| T21 | Manifest/icons/standalone configuration and production service-worker checks | Android/iOS physical install blocked; no device attached |
| T22 | Fake microphone/transcription, denial/cancel, editable transcript and read/stop controls | Fixture pass; actual microphone/speech/playback blocked |
| T23 | Durable inbox, encrypted subscriptions, dedup/retry/removal, UI notification open/read | Fixture pass; actual locked-device push blocked |
| T24 | Waiting worker version/readiness checks, saved draft after real fixture activation, retained draft after health rollback, exact prior worker after manual rollback | Fixture pass; physical voice/update blocked |
| T25 | Live-WAL snapshot, authenticated encrypted restore, delta rejection and stopped-source retirement | Local pass |
| T26 | Disabled optional cestDone adapter, hostile-config refusal | Optional execution unavailable; existing daemon untouched |
| T27 | Auth/Host/Origin/CSRF/rate/path/upload/XSS checks, owner-only child ACL and DPAPI | Local pass |
| T28 | Browser close/reopen, offline stale state, broker independent of client | Fixture pass; physical sleep/locked/sign-in/reboot blocked |
| T29 | Coordinator replacement preserves broker run/session/command and writer lease | Fixture pass; both native long-run replacements blocked |
| T30 | Separate processes/canary, OS ownership mutex, explicit broker candidate waits for idle | Local pass; actual persistent operational acceptance blocked |
| T31 | Actual installed UI at phone viewport, failing-before/passing-after browser regression, independent rebuild, 120-second observation and read-back | Fresh full fixture pass, including manual rollback, exact prior worker, draft and acknowledgement retention; capped real-provider self-update blocked |
| T32 | Failing candidate, protected authentication edit, forged evidence/hash, traversal/link and grant tampering tests | Local pass |
| T33 | Actual separate-process candidate health failure, automatic prior-release recovery and retained acknowledged request/draft | Fixture pass |
| T34 | Six actual supervisor process kills, signed pointer recovery, incompatible schema rejection and failed-rollback frozen recovery | Local pass |
| T35 | Serialized engine, two queued requests, fresh-base reproduction, immutable source and no reactivation of already-fixed behavior | Local pass |
| T36 | Explicit allowlist, exact runtime helper guard and secret/private-path scanner regression | Source/history scan, independent clean install, ZIP read-back, authenticated temporary installation/restore/removal and hosted Windows CI pass |

## Journeys and measurements

U01-U18 have local UI/API coverage across baseline, workflow, layout, mobile, journey and improvement suites. The journey rehearsal uses five tasks across two projects, both themes and two independently paired devices. It exercises three automatic phases, conflict rejection, priority/dependency, session history and continuation, filter/scroll restoration, synthetic exact-action approval, durable inbox and blocked-task recovery. Audio capture, playback control and source injection have separate browser tests. Full self-update uses a disposable installed release and separate supervisor/broker/coordinator processes.

Physical U01/U09/U10/U12 and native U05/U07/U11/U17/U18 acceptance remains blocked where specified above. No physical microphone, delivered notification, native session control or real-provider update is inferred from a browser fixture.

The isolated five-task measurement uses 30 repetitions on the recorded development host with production Chromium assets, the real loopback API and a separate synthetic broker. Observed p95: useful Today content 50.2 ms against 2,000 ms; command receipt 4.4 ms against 500 ms; visible state update 848.8 ms against 2,000 ms. This is local engineering evidence, not a network guarantee. Raw samples, CPU/runtime and independently inspected dark/light desktop/phone/zoom screenshots are in `evidence-private/journey-2026-11-14`.

No application package, persistent pilot, tunnel, paid service or operational schedule is published/activated by these tests. The old policy-quarantined failed-test folder remains explicitly excluded from cleanup-pass evidence.
