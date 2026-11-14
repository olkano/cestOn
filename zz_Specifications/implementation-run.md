# Implementation checkpoint

## Authority and resume procedure

The owner authorized the whole implementation, independent testing, and staging, commits, and pushes of meaningful verified phases on 2026-11-14. This does not authorize persistent pilot activation, remote infrastructure changes, paid-service provisioning, or publishing application packages. Follow `00-start-here.md` and the phase contracts.

On resume, read AGENTS, README, this file, `implementation-status.md`, and `implementation-progress.json`; inspect Git status and the latest remote commit before editing. Preserve unfinished work. Run the current phase's focused checks, inspect results, and continue phases 0-9 without routine approval. Never substitute fixture results for provider/device certification.

## Current checkpoint

- Phase: 2, providers and ownership.
- Completed: Phase 0 scaffold (`2402afa`); Phase 1 strict command/state schemas, SQLite WAL/migration integrity, immutable scope, transactional task/command/outbox, decision race handling, dependencies, canonical leases, consistent reconnect projection, checksummed broker receipt journal, lost-ack reconciliation, retention guard, and consistent SQLite backups.
- Verification: phase-1 tests were observed failing before implementations. Current 9 unit, 14 integration, 2 Chromium shell, 1 security baseline and 1 update-default checks pass. Actual child processes were killed before and after SQLite commit; recovered state and pending dispatch matched durable intent. An accepted broker action survived acknowledgement loss without a second start. Uncertain acceptance remained unresolved. WAL backup opened with integrity OK. Full `npm run verify`, security/update baselines, and final affected test/build reruns pass.
- Evidence: `evidence-private/2026-11-14T14-53-00-536Z-4c0c16c7/record.json`. Detailed evidence is ignored; recorded source snapshot hash, runtime/browser, commands, outputs and exits accompany the run. Final canonical-JSON adjustment was followed by unit/integration/build reruns.
- Next: implement broker process/IPC isolation and process identity; inspect exact Codex protocol and Claude SDK; add transport, scope-policy, discovery/handoff, cancellation and restart tests. Run bounded live certification only in isolated roots. The current live and package entry points deliberately fail closed until implemented.
- Known gates: real providers, physical Android/iOS, speech/push, constrained real-provider self-update. No persistent pilot or remote origin activation was requested.
- Documentation review: the owning command spec defines installation resume and preserves individual pauses. Existing architecture remains accurate; no additional README update qualifies in this phase.

## Clarifications to encode with their owning modules

- Add explicit installation resume that releases only the installation dispatch freeze; individually paused tasks remain paused.
- Define an authenticated snapshot with an event cursor captured consistently with its state for reconnect recovery.
- Initial pairing uses the one-use invitation and exact Origin/Host checks before a session exists; authenticated mutations additionally require the per-session CSRF token.

## Milestones

| Phase | Commit | Verification / remaining work |
|---|---|---|
| Tracking initialized | `3d79515` | Resume procedure and machine-readable checkpoint created before implementation edits. |
| 0 Scaffold | `2402afa` | Local scaffold verification passes; live-provider certification remains pending. |
| 1 Durable domain | See phase commit in Git history | Strict transactional commands, crash recovery, leases and WAL backup verified locally. |
