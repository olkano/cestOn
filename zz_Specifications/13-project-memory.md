# Project knowledge and memory

Owner requirement added 2026-11-17, U19. This is mandatory from the first usable version of the revised daily workflow, not an optional later feature. Status: specified, not implemented or accepted. The original 106 tests do not establish this capability.

## Purpose and user experience

cestOn must help the owner understand open projects, their connections, what matters, what is urgent, and what to do next. The owner must not have to reconstruct this context in every conversation or carry it all in their head. Learning means maintaining sourced knowledge over time, not training a model.

Keep two distinct records:

| Record | Question it answers | Behavior |
|---|---|---|
| Activity ledger | What happened and what was verified? | Dated instructions, decisions, actions and evidence, subject to retention and explicit deletion rules. |
| Current project knowledge | What should we understand now? | Editable purpose, status, importance, deadlines, blockers, next actions and relationships; superseded information is excluded from current answers. |

The normal interface must support “What should I work on?”, “How are these projects connected?”, “What do you remember about this?” and ordinary corrections such as “That deadline moved to Friday.” Show the reasons, evidence dates and uncertainties behind answers. Provide a simple view of remembered facts with correct and forget controls. The owner does not need to manage a technical ledger or tags before starting work.

A project remains a folder or repository in the daily navigation. A broader goal can link several projects without merging their files, conversations or authority. A conversation without a chosen folder can capture an unassigned goal or fact; attach it later without losing history. Do not invent a folder to represent an external service.

Illustrative example, not a discovered fact: Project A is important because it supports a customer commitment, depends on a component in Project B, and has a Friday deadline. Moving the deadline changes its urgency without automatically reducing its importance. A recently opened low-impact project must not become the most important merely because it was used last.

## Minimum knowledge contract

1. Give projects and knowledge records stable IDs independent of display name and path. Preserve references across a confirmed folder move; do not merge similar names or repository clones automatically. Link facts to projects, goals, tasks and sessions as applicable.
2. Keep importance and urgency separate. Record the owner's importance assessment and reason; derive urgency from explicit deadlines, blockers and consequences, with timezone and evaluation time. Unknown dates or importance remain unknown. Recency is a separate sorting choice. Explain recommendations and allow correction; the scoring formula can evolve.
3. Support typed, directional relationships such as “depends on”, “part of” and “shares a component with”. Distinguish a descriptive project relationship from an enforced task dependency. A remembered relationship must not silently change execution order or locks.
4. Each fact or relationship carries its source reference, source scope, observed time, last confirmation time, revision, and status: user-confirmed, observed, inferred, disputed, needs review, superseded or forgotten. Record applicable validity dates and a review date where useful. An inference includes its supporting evidence and uncertainty.
5. Capture explicit user statements and corrections immediately. Extract useful candidate knowledge from authorized conversations and evidence with source links. Ordinary capture does not require repeated confirmation. Ask when a consequential inference or ambiguous target would change the owner's understanding or action. Never present an unsupported guess as established knowledge.
6. Explicit user corrections supersede the corresponding current fact. A newer inferred statement cannot silently overwrite a confirmed statement. Preserve unresolved conflicts visibly; source recency alone does not determine truth. Verified conflicting evidence can flag a confirmed fact for review.
7. Retrieve only relevant, permitted current knowledge for a conversation, across sessions and providers. State when retrieval or source coverage is incomplete. Keep raw transcripts out of the default project summary. Memory must survive process restart and must not depend on a particular provider's conversation window.

## Updating, staleness and forgetting

Use review rules appropriate to each fact type. A current blocker can need frequent review; a project's purpose should not expire merely because it was quiet. Source changes invalidate affected summaries and recommendations. A fact that is old or unverified is labelled accordingly; age alone is not evidence that it is false.

Updates replace the current view and retain a compact revision history where permitted. Distinguish “this changed”, “this was wrong” and “forget this”. Retiring a completed or abandoned project removes it from active work by default while retaining its permitted history and relationships. Reopening it rechecks time-sensitive facts.

An explicit forget operation removes the content from active knowledge, generated summaries, retrieval indexes and caches. Redact or delete retained copies within cestOn according to the requested scope; do not leave the forgotten text in a correction audit. Retain only the minimal non-content deletion marker needed to prevent automatic re-ingestion from the same source. Deliberately remembering it again requires a fresh explicit instruction.

Explain deletion scope and any backup retention limits before claiming completion. A restore must apply later deletion markers before serving restored knowledge; if it cannot, keep memory retrieval disabled until reconciled. Forgetting within cestOn does not delete original provider transcripts, project files or external backups. Do not promise physical erasure from copies cestOn cannot control.

## Authority and implementation boundaries

Discovery of a folder or session is not permission to ingest all its contents. Use authorized sources, expose coverage and exclusions, and support project-level exclusion. Do not store credentials as knowledge. Carry source access restrictions into summaries and retrieval; unrelated project context must not leak through a derived summary.

Memory supplies context, not permission. It cannot expand task scope, dispatch work, approve an external action or override project instructions. Recommendations require the same explicit action and authority checks as any other task instruction.

Use the existing SQLite foundation for versioned knowledge records, relationships, source references and deletion markers unless evidence requires another store. Implement atomic updates with revision checks, idempotent ingestion and derived-view invalidation. Knowledge freshness is distinct from the current task snapshot's 45-second freshness label. Do not apply the operational journal's retention period blindly to long-lived project facts.

The first delivery includes capture, correction, recall, relationships, explained importance/urgency, review of stale information and forgetting. It must exercise these through the user interface, not only a database API. Rich visual maps, speculative related-session suggestions and more sophisticated ranking can follow. Automatic semantic grouping remains deferred; explicit project relationships are required now.

## Required acceptance evidence

All tests below are pending. Use isolated synthetic projects and fixture evidence first; record native-provider and physical-device coverage separately. These gates supplement T01-T36.

| ID | Scenario | Required result |
|---|---|---|
| M01 | State a purpose and deadline; restart; open another session/provider context | Same sourced knowledge is recalled without repeating the original conversation. Unavailable retrieval is reported. |
| M02 | Link two projects; rename/move one; attach an unassigned goal | Confirmed identities and relationships survive; ambiguous matches stay unresolved; no automatic folder merge or execution authority. |
| M03 | Set high importance, low urgency; move the deadline; open a low-importance project recently | Importance, urgency and recency remain distinct; the recommendation explains its inputs and reflects the corrected deadline. |
| M04 | Ingest a contradictory inference and then an explicit correction | Inference cannot overwrite confirmed knowledge; conflict and sources are visible; correction supersedes the relevant fact. |
| M05 | Change source evidence, pass a review date, retire and reopen a project | Derived answers are invalidated; stale uncertainty is visible; old purpose is not deleted just for age; reopening reviews deadlines. |
| M06 | Forget a fact, rescan its source, restart and restore an older backup | No forgotten content is returned from facts, summaries, caches or indexes; re-ingestion is suppressed; restore reconciles deletion markers or blocks retrieval. |
| M07 | Race two corrections, duplicate ingestion, kill before/after commit | One atomic current revision; stale writes rejected; no duplicated facts or mismatched summaries; recovery reconciles uncertain commits. |
| M08 | Exclude a project or revoke source access; request a cross-project briefing | Excluded content and derived context are absent; scope and coverage are clear; no credential ingestion or widened task authority. |
| M09 | From desktop and phone, ask what matters, inspect why, correct and forget | Plain-language controls work in both themes, with keyboard access, offline freshness and reconnect revision checks. No blind replay of edits. |

## Baseline inspection and next implementation step

Source inspection on 2026-11-17: `apps/server/src/db/schema.ts` and `store.ts` contain task priorities, task dependencies, events, decisions and evidence. `apps/server/src/intents/assistant.ts` uses bounded task/conversation context. These establish an operational foundation, not the knowledge lifecycle specified here. No implementation acceptance is inferred from this inspection.

Before revising the daily-work application, add versioned storage and migration contracts to `03-data-and-api.md`, define source eligibility and retention defaults, then implement and verify M01-M09 in meaningful increments. Preserve the original baseline evidence and track this additional requirement separately in the implementation ledger.
