# Implementation checkpoint

## Authority and resume procedure

The owner authorized the whole implementation, independent testing, and staging, commits, and pushes of meaningful verified phases on 2026-11-14. This does not authorize persistent pilot activation, remote infrastructure changes, paid-service provisioning, or publishing application packages. Follow `00-start-here.md` and the phase contracts.

On resume, read AGENTS, README, this file, `implementation-status.md`, and `implementation-progress.json`; inspect Git status and the latest remote commit before editing. Preserve unfinished work. Run the current phase's focused checks, inspect results, and continue phases 0-9 without routine approval. Never substitute fixture results for provider/device certification.

## Current checkpoint

- Phase: 6, operations, supervisor and recovery. Phases 0-5 are locally fixture-verified; this is not full product acceptance.
- Latest source milestones: phase 2 `5d749fd`, phase 3 `4f71666`, phase 4 `e5757f3`; phase 5 is the checkpoint commit following those. The milestone table and Git history retain earlier commits.
- Current system: durable SQLite commands/scopes/events, bounded planner/scheduler, independent artifact/recipe verification with before/after previews, separate broker and concurrent owner-only IPC, exact decision intents, source/PDF intake, immutable external-action service, authenticated API/SSE, desktop/phone UI, asset-only PWA, per-device 24-hour drafts and unresolved delivery identity, bounded speech and durable notifications. Broker/model fixtures are clearly labelled and production-disabled.
- Verification: full verify, 17 unit, 32 integration, 10 production-bundle Chromium, 4 security and 1 update-baseline tests pass. Evidence: `evidence-private/2026-11-14T16-52-11-609Z-eb346b06/record.json`. Native Windows DPAPI round-trip and wrong-purpose denial pass. The v1 schema remains unchanged; a hash-checked transactional v2 migration adds notification delivery/checkpoint tables. Audit reports zero vulnerabilities. Desktop dark and phone light screenshots were independently inspected; all five viewport sizes pass both themes.
- Next: immutable manifests/package command, independent supervisor and process registry, coordinator reconnect without stopping the broker, exact-scope CLI/startup preparation, encrypted backup/restore and retention. Then implement requested self-improvement and full resilience/release rehearsals. Package command still fails closed until phase 6 exists.
- Mandatory engineering gates: isolated native workspaces must prevent unmanaged-session writes before native edits are enabled; harden certification against effective home/project policy and SDK changes; certify native trusted recipes. Rehearse waiting service-worker activation/rollback with actual supervisor bundles. Checkpoint transitions must never discard acknowledged commands or blindly replay uncertain effects.
- External gates: both fresh managed native homes were unauthenticated and zero model turns were started. Live provider and real-provider self-update certification remain blocked. Physical Android/iOS, actual microphone/voice and lock-screen push need device evidence. No persistent pilot, tunnel, paid service or application artifact publication is authorized. Optional cestDone remains disabled; its daemon and configuration were untouched.
- Documentation review: API/snapshot and initial pairing authority live in their owning specs; mobile service constraints and physical acceptance card live in focused docs. README describes the actual temporary synthetic development workflow.

## Milestones

| Phase | Commit | Verification / remaining work |
|---|---|---|
| Tracking initialized | `3d79515` | Resume procedure and machine-readable checkpoint created before implementation edits. |
| 0 Scaffold | `2402afa` | Local scaffold verification passes; live-provider certification remains pending. |
| 1 Durable domain | `edfaf1f` | Strict transactional commands, crash recovery, leases and WAL backup verified locally. |
| 2 Providers and ownership | See phase commit in Git history | Local fixture/IPC/process checks pass; live profiles remain explicitly blocked. |
| 3 Scheduler and assistant | See phase commit in Git history | Local separate-process fixture workflow verified; native recipes and live provider execution remain gated. |
| 4 Authenticated interface | See phase commit in Git history | Local API, desktop/phone workflows, security and reconnect verified; device/provider gates remain separate. |
| 5 PWA, voice and notifications | See phase commit in Git history | Production static/offline, fake audio, DPAPI and notification tests pass; physical device and actual provider checks remain blocked. |
