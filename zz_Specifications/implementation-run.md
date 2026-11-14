# Implementation checkpoint

## Authority and resume procedure

The owner authorized the whole implementation, independent testing, and staging, commits, and pushes of meaningful verified phases on 2026-11-14. This does not authorize persistent pilot activation, remote infrastructure changes, paid-service provisioning, or publishing application packages. Follow `00-start-here.md` and the phase contracts.

On resume, read AGENTS, README, this file, `implementation-status.md`, and `implementation-progress.json`; inspect Git status and the latest remote commit before editing. Preserve unfinished work. Run the current phase's focused checks, inspect results, and continue phases 0-9 without routine approval. Never substitute fixture results for provider/device certification.

## Current checkpoint

- Phase: 0, scaffold and capability baseline.
- Completed: startup instructions and contracts inspected; source baseline clean on main and tracked to origin/main.
- Next: create pinned npm workspaces, test isolation helpers, config validation, redaction, fixture provider, runnable shell, verification scripts, and dependency lock. Prove failures before core implementations, then verify and commit this phase.
- Evidence: detailed local results go under ignored `zz_Specifications/evidence-private/<run-id>/`; sanitized phase results belong in the ledger and this checkpoint.
- Known gates: physical Android/iOS, live speech/push, real-provider certification, and constrained real-provider self-update require separate evidence. No persistent pilot or remote origin activation was requested.

## Clarifications to encode with their owning modules

- Add explicit installation resume that releases only the installation dispatch freeze; individually paused tasks remain paused.
- Define an authenticated snapshot with an event cursor captured consistently with its state for reconnect recovery.
- Initial pairing uses the one-use invitation and exact Origin/Host checks before a session exists; authenticated mutations additionally require the per-session CSRF token.

## Milestones

| Phase | Commit | Verification / remaining work |
|---|---|---|
| Tracking initialized | See Git history | Resume procedure and machine-readable checkpoint created before implementation edits. |
