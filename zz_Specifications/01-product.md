# Product requirements

## Product identity and delivery

Build `cestOn`, a single-owner, self-hosted coordination application. Each installation belongs to one operator and can have several authenticated devices. No multi-tenant hosted SaaS, billing system, shared organization workspace, or app store is required for version 1. Public source and redistributable installation packages are a release goal, not a dependency on Olkano infrastructure.

Use “assistant” in conversation and help text. Use “relay” only as a technical component description if needed. Keep cestDone as a distinct product. Use the supplied icon. Include system, dark, and light theme choices.

## Required user journeys

| ID | User intent | Required observable result |
|---|---|---|
| U01 | Open on desktop or phone | One authenticated workspace; installed phone icon opens a standalone app. Setup explains the awake host dependency. |
| U02 | What are we working on? | List running, waiting, ready for review, blocked, and unknown tasks with project, next action, evidence time, and attention count. |
| U03 | Explain this task | Recover goal, current phase, last verified result, pending choice, history, and evidence without requiring provider/window knowledge. |
| U04 | Start work | Capture outcome, registered project, scope, autonomy limits, and completion boundary; create one durable task. |
| U05 | Direct a busy worker | Show queued, accepted, running, or unresolved delivery separately. Use live steering only when the adapter proves it. |
| U06 | Choose option two | Bind to the exact task, decision, option ID, revision, and displayed meaning. Reject stale or ambiguous commands. |
| U07 | Continue independently | Execute authorized phases, verify results, stop on genuine decisions, cap attempts and resource use. |
| U08 | Review the outcome | Show changed artifacts, actual verification, unresolved items, and an action to request an adjustment or accept the result. |
| U09 | Talk and listen | Push-to-talk, transcript, target context, spoken briefing, interruption of playback, and visible acknowledgement. Text remains available. |
| U10 | Respond to a notification | Generic lock-screen alert deep-links to the current decision after authentication; duplicate clicks do not duplicate execution. |
| U11 | Continue an existing session | Observe first; explicitly stop or hand off ownership; use exact provider IDs or a new-session brief, never an assumed live attachment. |
| U12 | Host or network unavailable | Explain freshness; preserve local unsent draft; reconnect, revalidate target, and explicitly send. No background blind replay. |
| U13 | Set priorities and dependencies | Reorder eligible work; retain dependencies and resource locks; show why work waits. |
| U14 | Bring in source material | Paste text, upload an allowed document, or link an existing local artifact; deduplicate source IDs; propose bounded work. No automatic customer reply. |
| U15 | Pause, stop, resume | Stop new dispatch immediately; display pending acknowledgements and remaining processes; resume only selected scope. |
| U16 | Approve an external action | Show exact target, current/proposed state, effects, and verification; one approval applies to one immutable action revision. |
| U17 | Recover a failure | Preserve evidence; bounded retries; route a fresh investigation; keep the task unverified until checks pass. |
| U18 | Improve cestOn itself | A direct fix request creates a candidate, tests and builds it, applies it locally when eligible, verifies it, and reports the result with rollback. |

## Conversation behavior

The assistant uses the task database and bounded evidence retrieval to answer; it never infers task identity from the most recently modified transcript. Display the active task beside the composer. “Tell me more” can use the current task. “Option two” is valid only against the one presented decision revision. If two targets are plausible, ask one concise question without dispatching either.

Support free text for overview, explanation, new task, instruction, decision, pause/resume, prioritization, review, and improvement. The model proposes schema-validated intents. The coordinator resolves IDs, checks authority, and executes. No direct shell command or filesystem path is accepted from a browser as an execution instruction. Unknown intents remain conversation, not commands.

Keep a short activity timeline that separates user instruction, assistant interpretation, broker acceptance, provider completion, verification, and user review. A provider saying “done” does not imply deployment or verified success. Each summary includes freshness and evidence links; summaries are invalidated when their underlying event cursor changes.

## Autonomy defaults

Default global concurrency is two managed runs, one writer per canonical workspace, two attempts per failed phase, 45 minutes per run, and eight phases per task. Defaults are operator-configurable and stored in the task's immutable scope revision. A metered provider needs a configured monetary ceiling before unattended use; subscription providers still have run/time/turn ceilings and report unknown monetary cost honestly.

Local read/edit/test/build may be included in task authority. Repository instructions remain binding. Git commits, pushes, publishing, customer communication, operational writes, deployment, and infrastructure changes require their own task authority. A generic “continue” never enlarges scope.

## Version 1 boundaries

Support Windows host operation first; make contracts and path handling portable and run pure logic tests on Linux in CI. Linux/macOS host installers are subsequent compatibility work. Support current Chrome/Edge desktop, Android Chrome, and iOS Safari/Home Screen on tested versions. Record actual versions in release evidence, not a permanent “all browsers” claim.

Implement generic source intake and optional cestDone batch execution. Direct Help Scout, Gmail, Drive, CRM, and accounting connectors are later adapters; version 1 can use operator-provided evidence and registered local folders. Do not scan every local drive or silently reorganize folders.

## Acceptance goals

With five synthetic tasks across two providers, the operator can find the one pending decision and understand it within two interactions from Today. A phone can direct it without selecting a provider or finding a VS Code window. Across restart and reconnect tests there are zero wrong-target commands and zero duplicate external effects. Record timings from the repeatable fixture instead of asserting production productivity gains.
