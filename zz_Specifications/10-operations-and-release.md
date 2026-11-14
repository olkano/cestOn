# Setup, operation, and public release

## Installation model

Version 1 is self-hosted. A public source repository and downloadable package let another operator run their own installation with their own providers. Do not provision a shared hosted service, reuse Olkano accounts, or require access to Daniel's folders. Proposed GitHub destination: `olkano/cestOn`; verify availability and authorization at release time.

The implementation supplies a local CLI with these commands: `ceston doctor`, `ceston start`, `ceston stop`, `ceston status`, `ceston pair`, `ceston install-startup`, `ceston uninstall-startup`, `ceston backup`, `ceston recover`, and `ceston version`. Commands return structured JSON with `--json`; interactive secrets such as pairing invitations never appear in status/log output. `start` does not install persistence automatically. `stop` reports broker-owned work and requires a deliberate chosen stop scope.

Development uses `npm ci`, `npm run dev`, and `npm run verify`. A local package is created by `npm run package:local`, then inspected before installation. Package scripts never publish, register a tunnel, send a message, or restart an existing service as a side effect.

## Configuration contract

Store operator configuration outside the checkout under the data root. Provide a tracked example with generic placeholders only. Validate schema before start, and show exact invalid keys without values. A minimal planned example is:

```json
{
  "configVersion": 1,
  "listen": {"host": "127.0.0.1", "port": 4318},
  "publicOrigin": "https://assistant.example.invalid",
  "projects": [],
  "providers": [],
  "limits": {"concurrency": 2, "phaseAttempts": 2, "runMinutes": 45, "taskPhases": 8},
  "voice": {"enabled": false},
  "push": {"enabled": false},
  "updates": {"requestedLocalApply": false, "retainVerifiedReleases": 3}
}
```

`publicOrigin` must be replaced or omitted for loopback-only use; `.invalid` must fail remote activation. Enable requested local self-application during owner setup only after the update certification passes. Public installations default off until their operator enables it; the personal pilot should enable it once certified, matching the requested experience. Setup explains what a direct fix request authorizes and which protected operations remain separate.

Project profiles include canonical roots, allowed recipes, provider profile, scope defaults, and Git policy. Provider profiles include executable/runtime version, auth mode reference, model selection, capabilities, and resource caps. Store credential references rather than values in configuration. Do not copy sibling `.env` or `.cestdonerc.json` into this file.

Before changing ignored configuration, make a verified backup outside the worktree, write a temporary file, parse it, rename atomically, and read back the effective configuration. Invalid changes retain the previous valid configuration. Configuration reload never starts a task merely because a profile was added.

## Remote setup and phone

Prepare a dedicated HTTPS origin, an origin-restricted proxy/tunnel route to the loopback API, application pairing, and optional Access identity verification. Keep broker/supervisor sockets private. Verify an unauthenticated request cannot obtain task data and an authenticated device can receive SSE through the proxy. Check forwarding timeouts, request size limits, certificate validity, and allowed Host/Origin values.

Do not change existing production tunnel routes. Remote provisioning requires the exact origin and account, proposed route/policy, affected services, and read-back plan. The agent can prepare and perform an authorized change; it must not hand routine executable operations to the operator unnecessarily. Human device installation, OS prompts, or unavailable credentials remain explicit prerequisites.

The Windows startup installer registers only cestOn under the current user with a stable supervisor path and single-instance guard. Test sign-in, locked desktop, reboot recovery, and unavailable network. Document that sleep/sign-out can stop availability. Do not use the existing SYSTEM cestDone daemon, its PM2 home, or mapped-drive assumptions.

## Doctor and operations

Doctor checks Node/runtime versions, data-root ACLs, SQLite integrity/schema, available ports, supervisor/broker/API compatibility, current release hash, project accessibility, provider capability freshness, authentication availability, disk space, clock skew, and optional voice/push configuration. It does not run real work or reveal secrets. Report `ready`, `degraded`, or `blocked` per capability.

Log bounded structured events with rotation at 10 MiB, five files per process by default. Cleanup runs on startup and daily, with a dry-run option. Preserve unresolved commands, active updates, and current rollback artifacts. Show disk usage and pruning outcome. Never delete provider-owned history.

Backups contain database, configuration without embedded secrets, release pointer, schema version, and broker reconciliation cursor. Encrypt private backups and verify restore in an isolated root. Recovery enumerates available releases/backups by verified metadata, freezes dispatch, reconciles accepted commands, and checks the selected restored state before resuming. Run the recovery rehearsal every release that changes persistence or supervision.

## Public release checklist

1. Produce a sanitized export from an explicit allowlist: implemented apps/packages/scripts, public docs/specs, icon derivatives/master, lockfile, tests with synthetic fixtures, and license/notices. Exclude `reference-private`, private evidence, state, logs, `.env`, provider homes, local config, personal paths, and credentials. Review the actual archive and intended Git history, not just `.gitignore`.
2. Confirm repository/name/package availability and the owner's license choice. MIT is the proposed license for original cestOn code; do not imply the owner has already licensed it or that copied dependencies share that license. Resolve dependency notices, including cestDone's current documentation/metadata inconsistency if its code is ever redistributed. External executable use does not justify copying its private source.
3. Make `AGENTS.md` self-contained for outside contributors: replace the personal parent loader with the parent's portable engineering core plus cestOn-specific rules, and remove personal workspace references from public instructions. Keep the local operator setup in ignored configuration. Verify a checkout outside the personal workspace works.
4. Run clean `npm ci`, `npm run verify`, package inspection, installation, update, rollback, and uninstall in a fresh data root. Publish a tested host/browser/provider compatibility matrix, known limitations, and whether physical device tests passed.
5. Add CI that runs isolated checks and artifact generation on supported platforms. Live-provider tests are manual and do not receive secrets for untrusted pull requests. No workflow automatically deploys to an operator's machine or publishes from an unreviewed branch.
6. Only with explicit publication authority, create/confirm `olkano/cestOn`, set the intended visibility, push exactly reviewed source, and upload the release artifact with checksums and release notes. Read back repository visibility, commit, artifact hash, and download contents. Do not publish the private historical exploration.
7. Installation remains opt-in and self-hosted. Release availability must not auto-update every installation. Operators select update policy; a local improvement is private to that installation unless separately published.

Native store packaging, signing accounts, iOS build infrastructure, app review, and store submissions are a later extension. Preparing the PWA is a complete version-1 mobile path; do not leave the main product waiting for a native wrapper.
