# cestOn agent instructions

This file is self-contained for public contributors. The portable engineering core stays here as one unit so every checkout has the same working and verification rules.

- [Startup and authority](#startup-and-authority)
- [Ownership](#ownership)
- [Product-specific invariants](#product-specific-invariants)
- [Completion](#completion)
- [Portable engineering core](#working-method)

## Startup and authority

1. Read `README.md`, `zz_Specifications/00-start-here.md`, and `zz_Specifications/implementation-status.md` before changing this workspace.
2. Read the phase and its linked contracts and tests before implementing it. The specifications describe planned behavior; do not mistake pending work for existing capabilities.
3. A request to implement the specifications authorizes progression through all local phases and their isolated tests. Do not stop for approval at routine phase boundaries. Follow the explicit operation limits in `00-start-here.md`.
4. Keep task-provider activity, test evidence, and local activation distinct from public release. Never mark a skipped required test as passed.

## Ownership

- `zz_Specifications/` owns the active contract. `design/` owns illustrative prototypes, not production code. `assets/cestOn-icon.svg` is the supplied master icon.
- Before investigating a configured cestDone source checkout, read its own `AGENTS.md` and `README.md`. A sibling checkout is not required. Its live daemon and schedules are outside cestOn implementation scope. Keep `zz_Specifications/04-provider-adapters.md` aligned; do not copy private runtime configuration.
- A registered workspace keeps its own instructions and authority. cestOn does not confer permission to alter every project. No direct ITM Platform API or account integration is planned; any future integration first requires reading the owning repository's instructions and architecture.

## Product-specific invariants

- Keep coordinator, execution broker, and update supervisor separate. Provider credentials and privileged update operations never reach browser code or an ordinary task worker.
- Reject stale decisions, duplicate effects, unmanaged-session writes, and unsupported adapter capabilities deterministically. Prompt instructions alone are not enforcement.
- Test crashes before and after dispatch, commit, activation, and read-back. An uncertain action requires reconciliation, never blind replay.
- Verify UI behavior at desktop and phone sizes in both themes, with keyboard navigation, offline state, and reconnect. Include install and real-device checks in the evidence ledger.
- Use synthetic workspaces and fixture providers by default. Test scripts must fail closed if pointed at a non-test data root.
- Self-improvement edits a candidate worktree and activates through the supervisor. It never overwrites the live application in place or disables its own checks.
- Preserve the historical files under `reference-private/` unchanged. Never include them in a public export or artifact.
- Use plain language in product flows; implementation identifiers belong in expandable diagnostics. Never use em dashes in newly authored documentation or external records.

## Completion

- For owner-requested product changes, deploy the verified build to the existing Windows installation and restart cestOn before handoff. Verify the served build and the existing HTTPS address used by the PC and phone. Follow the [activation boundary](zz_Specifications/00-start-here.md#implementation-authority-and-limits).
- Update the implementation ledger after each verified phase, with commands, results, unresolved gates, and evidence locations. Continue with independent work when a real-device or credential gate is unavailable.
- Keep README limited to actual setup, architecture, and usage. Put detailed behavior in the owning spec and operational procedures in `docs/` when implemented.
- Git authorization is task-specific under the portable engineering core below. No other repository's standing push rule transfers here.
- Keep these instructions self-contained and validate a clean checkout before public collaboration. See `zz_Specifications/10-operations-and-release.md`.

<!-- BEGIN PORTABLE ENGINEERING CORE -->
## Working method

- For review, explanation, diagnosis, or planning, inspect and report. Do not implement unless asked.
- Search for prior art and trace the relevant flow before adding code. Reuse established patterns and prefer the smallest justified change.
- Preserve unrelated worktree changes. Do not broaden the requested scope.
- Before changing a gitignored file, such as local configuration, feature flags or settings, copy it outside the worktree, because Git cannot restore it. Write it atomically (temporary file, then rename), check the result parses, and restore the copy if it does not.
- Confirm important diagnoses with source, tests, logs, or live evidence. Distinguish source or local state, deployed state, and production state.

## Proposing solutions

- Rate every proposed fix against the verified root cause on impact, complexity and side effects, and give each a Yes or No recommendation with a one-line reason.
- Impact: High removes the cause for every user and input on the path where it occurred; Medium lowers its likelihood or consequence, depends on model or user compliance, or covers a path where it was not observed; Low fixes only the reported case or adds diagnostics or polish.
- Complexity: Low is one repository, a local change and hermetic tests; Medium adds modules or a component, live evaluation, stage-only verification or data migration; High crosses repositories, changes a contract, schema or public API, or needs a coordinated deployment.
- Side effects: None leaves every other input unchanged, shown by tests, with no added cost or latency; Contained changes other cases in the same component predictably or adds cost, latency or tokens; Broad reaches other clients, repositories, tenants, public API consumers or every prompt.
- A High, Low, None fix is recommended Yes and implemented first; once it resolves the cause, stop proposing code changes. High impact with exactly one Medium or Contained rating may be Yes, with the reason stated, when no such fix exists. Any other combination is a follow-up for the owner, recommended Yes or No but not implemented in the same task. Low impact is No.
- When a rating falls between two levels, take the less favourable one. Tests belong to the fix they prove. Customer communication and data repair are rated on their own track, not as alternatives to code fixes. Within a tier, prefer deterministic code over prompt text, the repository that owns the fault, and the smaller diff.

## Code and verification

- Give meaningful behavior changes automated tests. Use TDD for main logic; edge cases may be tested after implementation.
- Integration and E2E tests must clean up the data and external state they create.
- Run the relevant tests, lint or type checks, and build before handoff. Report pre-existing failures separately.
- Verify UI changes in a browser and add or update E2E coverage when required by the repository.
- Verify deployments and external writes by reading back the resulting state.
- Follow established validation, logging, error-handling, and code-style patterns. Remove temporary diagnostics before completion.

## Documentation

- Documentation review is part of every handoff. Edit only when the task reveals a qualifying durable gap.
- A gap qualifies only when it changes future action, is costly to derive from current source or standard tooling, is likely to recur or remain true, and has one clear authoritative home.
- Keep one-off details, transient state, exact run results, before-and-after metrics, and implementation chronology in tickets, specifications, reports, tests, or Git history. Extract at most one short stable rule and a link into a living document.
- Search the destination before editing. Replace stale or duplicated statements instead of appending another version, and prefer a net-neutral or smaller rewrite when the subject already exists.
- More than ten net new lines in an `AGENTS.md`, root README, or central runbook requires an explicit placement review. Soft review thresholds are 80 lines for a child `AGENTS.md`, 300 for a root README or runbook, and 500 for a reference guide; exceeding one requires an index and a reason to stay whole.
- Keep living documentation concise, present-tense, current-state oriented, and free of delivery history. Use dates only for compatibility boundaries, audits, or facts with an owner and refresh or expiry condition.
- Write Markdown and other prose documents with one source line per paragraph, list item, or blockquote, and let the editor wrap it. Do not insert line breaks at a fixed column width except where the format needs them.
- Use `README.md` for current architecture, setup, usage, and repository relationships. Use `AGENTS.md` for instructions that change how an agent should work.
- Put repeatable procedures in focused runbooks and test-specific behavior in tests, helpers, fixtures, or generated inventories.
- Each repository uses `zz_Specifications/` for specifications and planned behavior and `zz_Tickets/` for issues, investigations and incidents. Group complex features or issues in subfolders; follow established casing.
- Default to very concise Markdown written for LLM agents. Use HTML when the user requests mockups or visual representations, or when a visually rich document would improve understanding.
- Keep specifications and tickets current. Move completed work to the corresponding `done/` folder with final status and verification recorded; move rejected or discarded work to `rejected/`. Create both archive folders if missing in `zz_Specifications/` and `zz_Tickets/`; complex-feature subfolders may also have their own archives. Update affected links when moving documents.
- Keep active documents focused on the chosen approach, without substantial history or rejected options once the user has decided. Retain useful superseded material only in an annex at the end, or in a separate document under `done/` when its volume warrants it; otherwise remove it, since Git retains it.
- Never put secrets, tokens, passwords, private keys, or raw sensitive logs in documentation. Refer to the approved secret store and redact examples.

## Repository relationships

- When a repository depends on a sibling, describe the stable architecture and contract in its `README.md`.
- Add action-changing guidance to its `AGENTS.md`: when to inspect the sibling, which contracts must stay aligned, required cross-repository validation, and deployment or ownership boundaries.
- If both descriptions are needed, cross-link them and avoid duplicating prose.
- Before changing a sibling, read its own `AGENTS.md` and `README.md`. First confirm that a cross-repository change is required.
- Treat every Git root independently. Stage, review, commit, and push changes separately in the repository that owns them.

## Handoff and Git

- Do not commit, push, deploy, change external systems, or make production writes unless the request authorizes it.
- Do not stage either. `git add` only when the request asks for it, in every repository. The index is shared: two sessions working at once produce one mixed set of staged files, and whoever commits next attaches the wrong message to someone else's work. Leave changes in the working tree, name the files you touched, and let the user stage.
- When authorized to commit, stage only task files, inspect the staged diff, and use a short direct message without authoring trailers.
- Lead the handoff with the result. State verification performed, unresolved risks, and required follow-up.
- Include a `Documentation review` line: name each qualifying update and why it passed the admission gate, or state that no qualifying gap was found. Do not edit documentation only to satisfy the handoff.
<!-- END PORTABLE ENGINEERING CORE -->
