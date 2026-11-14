# Implementation checkpoint

## Authority and resume procedure

The owner authorized the whole implementation, independent testing, and staging, commits, and pushes of meaningful verified phases on 2026-11-14. This does not authorize persistent pilot activation, remote infrastructure changes, paid-service provisioning, or publishing application packages. Follow `00-start-here.md` and the phase contracts.

On resume, read AGENTS, README, this file, `implementation-status.md`, and `implementation-progress.json`; inspect Git status and the latest remote commit before editing. Preserve unfinished work. Run the current phase's focused checks, inspect results, and continue phases 0-9 without routine approval. Never substitute fixture results for provider/device certification.

## Current checkpoint

- Phase: 1, durable domain and command service.
- Completed: Phase 0 npm workspace, exact dependency lock, config/limits, path validation, fail-closed test roots, log filtering, synthetic adapter, loopback shell, icon generation, build, doctor, and verification tooling.
- Verification: clean `npm ci`, zero audit findings; 7 unit, 1 loopback integration, 2 Chromium viewport/theme tests, 1 security baseline, and 1 update-default test pass. `npm run verify` includes types, lint, tests, build and local-document links. Independently inspected desktop dark and phone light screenshots. These are scaffold checks, not full feature acceptance.
- Evidence: `evidence-private/2026-11-14T14-42-32-508Z-03b2323c/record.json`. Detailed results remain ignored. Browser Chromium 159.0.8154.6; Node 24.14.0; Windows.
- Next: add failing phase-1 tests, then implement SQLite schema/migrations, strict commands, immutable authority, revision checks, outbox, decisions, canonical locks, broker receipts, and reconciliation.
- Known gates: real providers, physical Android/iOS, speech/push, constrained real-provider self-update. No persistent pilot or remote origin activation was requested.
- Documentation review: README now owns actual development commands; provider compatibility owns detected runtime limits; these change future setup and prevent false capability claims. The tracking files own phase history. No product scope was expanded.

## Clarifications to encode with their owning modules

- Add explicit installation resume that releases only the installation dispatch freeze; individually paused tasks remain paused.
- Define an authenticated snapshot with an event cursor captured consistently with its state for reconnect recovery.
- Initial pairing uses the one-use invitation and exact Origin/Host checks before a session exists; authenticated mutations additionally require the per-session CSRF token.

## Milestones

| Phase | Commit | Verification / remaining work |
|---|---|---|
| Tracking initialized | `3d79515` | Resume procedure and machine-readable checkpoint created before implementation edits. |
| 0 Scaffold | See phase commit in Git history | Local scaffold verification passes; live-provider certification remains pending. |
