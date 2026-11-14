# Implementation checkpoint

## Authority and resume procedure

The owner authorized the whole implementation, independent testing, and staging, commits, and pushes of meaningful verified phases on 2026-11-14. This does not authorize persistent pilot activation, remote infrastructure changes, paid-service provisioning, or publishing application packages. Follow `00-start-here.md` and the phase contracts.

On resume, read AGENTS, README, this file, `implementation-status.md`, and `implementation-progress.json`; inspect Git status and the latest remote commit before editing. Preserve unfinished work. Run the current phase's focused checks, inspect results, and continue phases 0-9 without routine approval. Never substitute fixture results for provider/device certification.

## Current checkpoint

- Phase: 3, scheduler and conversational assistant.
- Completed: Phases 0 (`2402afa`) and 1 (`edfaf1f`); Phase 2 independent broker, owner-only Windows named pipe (explicit ACL read-back), authenticated protocol, durable provider receipts/events, canonical writer exclusion and unknown-run quarantine, environment allowlist, Codex 0.160.0 stdio adapter, Claude SDK 0.3.325 with CLI 2.1.317, bounded observe-only discovery, inactive-owner handoff contract, cancellation, runtime probes and gated live-test harness.
- Verification: 14 unit, 19 integration, 2 Chromium shell, 1 security baseline and 1 update-default checks pass. Full `npm run verify` passes. A Codex duplicate-start race and malformed-stream handling were reproduced failing and corrected. Separate-process IPC forgery, client disconnect with surviving broker, PID reuse, unknown/active owner refusal and synthetic stopped handoff are checked. Final affected integration/type/lint/build reruns pass. Audit reports zero vulnerabilities.
- Evidence: `evidence-private/2026-11-14T15-25-18-247Z-e8d3b88a/record.json` for full verification; `evidence-private/provider-probe-*` contains sanitized native probes. Both fresh managed homes report unauthenticated; zero model turns started. A transient Windows probe-root cleanup lock was resolved with bounded retries; the successful rerun cleaned its marked root. Live execution is not passed. The live-test entry point also rejects absent opt-in/profile/root inputs before execution.
- Next: implement strict bounded plan/model schemas, trusted verification recipes, fixture-backed phase progression and failure/retry/pause handling; use broker IPC for owned work; add exact intent targeting, source intake, review and immutable external-action approval. Then build authenticated API/UI in phase 4. The package command remains deliberately unavailable until phase 6.
- Known gates: authenticated managed provider profiles and live policy proof; physical Android/iOS; speech/push; constrained real-provider self-update. No persistent pilot or remote origin activation was requested. The optional cestDone source remains `fb30d27`; its live daemon/config were untouched and its uncertified batch adapter is disabled.
- Documentation review: provider compatibility records actual transports and remaining gates, plus the safe probe/certification procedure. README remains accurate for the current development shell; no unrelated documentation changes qualify.

## Clarifications to encode with their owning modules

- Add explicit installation resume that releases only the installation dispatch freeze; individually paused tasks remain paused.
- Define an authenticated snapshot with an event cursor captured consistently with its state for reconnect recovery.
- Initial pairing uses the one-use invitation and exact Origin/Host checks before a session exists; authenticated mutations additionally require the per-session CSRF token.

## Milestones

| Phase | Commit | Verification / remaining work |
|---|---|---|
| Tracking initialized | `3d79515` | Resume procedure and machine-readable checkpoint created before implementation edits. |
| 0 Scaffold | `2402afa` | Local scaffold verification passes; live-provider certification remains pending. |
| 1 Durable domain | `edfaf1f` | Strict transactional commands, crash recovery, leases and WAL backup verified locally. |
| 2 Providers and ownership | See phase commit in Git history | Local fixture/IPC/process checks pass; live profiles remain explicitly blocked. |
