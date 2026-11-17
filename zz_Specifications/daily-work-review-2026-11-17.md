# Daily workflow revision and discovery evidence

This note records the owner’s daily-work decisions and original discovery research. The Windows application now implements local history browsing, General conversations and project memory. The [implementation ledger](implementation-status.md) records evidence and outstanding acceptance. The [HTML preview](../design/cestOn-session-first.html) illustrates the proposed complete experience.

## Product decisions reflected in the preview

- Discover working folders from the connected Codex and Claude history sources automatically. One initial connection/scope setup is reasonable; requiring manual registration of every existing folder is not the proposed daily flow.
- Use **Your folders → Conversations → Conversation**. A folder can be a Git checkout, a subfolder or a non-Git working directory. Git is optional. Preserve exact working-directory identity for now; do not collapse nested projects into a large parent repository automatically.
- Sort conversations by last recorded activity, descending. Sort each folder by the maximum conversation activity within it. Opening the UI must not update these timestamps. Date provenance and missing dates matter; neither discovery time nor session creation time is a substitute for recent use.
- Show original provider messages in the selected conversation. Use the provider's title when available. Do not generate an unsolicited summary. The research snapshot deliberately omits titles and messages and uses neutral provider labels.
- The intended away-from-PC workflow is to continue the same conversation inside cestOn. Read-only discovery is an intermediate implementation milestone, not acceptance of the complete product. Do not make switching to a vendor's remote-control app the ordinary cestOn flow.
- Replace “Observe only” in product copy with “Can’t reply to this conversation,” explaining the specific connection limitation. Never silently fork, resume a second competing writer or create a different task when the user expects the original live conversation.
- Defer unsolicited related-session suggestions and conversation recaps. U19 still requires useful remembered context and answers to requested project briefings; this deferral does not prohibit their internal summaries. Keep agent diagnostics out of the main screen. Automation attribution/filtering still needs its own evidence.

## Architecture, starting without a folder and response delivery

The [visual architecture and workflow guide](../design/cestOn-how-it-works.html) is linked from the daily-work preview and its reply example. It separates the existing managed-task architecture from proposed conversation interactions. The current private view is `artifacts/daily-work-view-KLy0kV/cestOn-your-daily-work.html`, with its guide alongside. It reuses the recorded 742-session snapshot below without reading provider homes again. The capture timestamp is retained; this is a new presentation of that snapshot, not a fresh inventory.

- Use “Can't reach your PC” for an unavailable phone-to-host connection. Do not infer that the PC is powered off: the service, phone network or configured remote path could be unavailable. This prevents delivery/fresh updates for all sessions on that host. Cached history is available only if actually retained on that device; full offline conversation caching remains unverified.
- Use “Can't reply to this conversation” when the host is reachable but the particular session cannot accept a prompt. Preserve the distinction from provider-wide unavailability, missing authentication, and deleted/missing history. Do not suggest that waking the PC repairs an unsupported session connection.
- Propose a permanent New conversation entry, with the preferred provider visible and a General context before project selection. Internally it still needs an app-owned working directory and a bounded execution profile. General must not grant all-project read/write access. A later workspace change may require an explicit new provider session; preserve the existing conversation and disclose context transfer.
- Propose global search over indexed titles/folder metadata, including unresolved session locations. Explicitly scoped message search is later work; the research snapshot has neither messages nor titles. PMPilot/MCP example candidates are owner-supplied names, not verified topic matches. Do not infer the owning repo from a name alone.
- Home Assistant is an illustrative service action, not a repository integration. Resolve the actual target and distinguish restarting Home Assistant from rebooting its host. Require an authorized tool/connection and applicable action authority; request clarification or approval only where needed. Verify recovery before reporting success. No Home Assistant discovery, credential access or action was performed here.
- Proposed response UX: append the user's message, show delivery receipt, provider acceptance, actual progress, then response in the same conversation. Partial text can appear as it arrives where supported. Show approval/questions/errors there too. If the agent is busy, expose whether delivery is queued or immediate; do not promise cross-provider steering parity.
- Do not equate receipt with execution success. On lost acknowledgement, reconcile the original command identity; never blindly replay. Preserve an unsent draft while disconnected instead of implying automatic queueing. Do not promise full private model thoughts; optionally present provider-exposed explanations or reasoning summaries and factual tool progress.

Source verification for these distinctions: [architecture](02-architecture.md); [command/outbox services](../apps/server/src/commands/); [HTTP event channel](../apps/server/src/http/routes.ts); [current UI](../apps/web/src/main.tsx); [Codex adapter](../packages/adapters/src/codex/index.ts); [Claude adapter](../packages/adapters/src/claude/index.ts); [worker event persistence](../apps/server/src/scheduler/broker-worker.ts).

Observed implementation: Codex maps agentMessage/delta to text events. Claude emits assistant message objects and tool-progress events, without enabling includePartialMessages in its current query options. The worker persists task events; its stored message excerpt uses data.text, so Claude message-object content is not represented by that excerpt. The UI subscribes to selected state-change events and refreshes task snapshots; it does not assemble provider text into the proposed existing-session chat stream. These are foundations, not evidence of end-to-end streaming parity. No dedicated reasoning-summary renderer was established. Existing managed Claude profiles explicitly use empty MCP servers and restricted tools, so an IDE's Home Assistant integration must not be assumed to carry over.

Recommendation: Yes to the clarified guide and state labels (impact Medium, complexity Low, side effects Contained). General conversations/global search are proposed follow-up work (impact High, complexity High, side effects Contained, recommendation Yes after scope and provider feasibility contracts). Same-session streaming stays part of provider/UI acceptance; no application behavior was changed in this documentation task.

Guide verification: `node design/check-daily-work.mjs artifacts/daily-work-view-KLy0kV/cestOn-your-daily-work.html` passed; evidence is `artifacts/daily-work-browser-1794936574631/result.json`. The run checks the existing 32-folder/742-record view plus all four guide panels at 1440, 390 and 320 pixels in both themes, clickable architecture nodes, General/search/file-work examples, keyboard tabs, all six delivery stages/reset, both failure scenarios, local links and static offline reload. Zero browser errors or external requests were observed; representative desktop/phone screenshots were inspected. The first guide run exposed a rotated mobile arrow intercepting node clicks; the arrow box was constrained and the complete browser check then passed. No real provider or Home Assistant action was part of these tests. Regenerate the private view without rescanning with `node design/render-daily-work.mjs artifacts/daily-work-1794933514788/discovery.json`.

The numbered baseline specifications still describe the earlier implemented application. They are not yet sufficient to implement this revised workflow: project/provider association, auto-discovery, activity ordering and existing-session command authority need coordinated contract changes. Do not treat approval of a visual direction as approval of an unproven control mechanism.

## Actual local check

Command: `node --import tsx design/inspect-local-history.mjs --inspect-local-history`. Explicit opt-in is required. The probe is not called by application startup, builds, CI or tests. It reads current local history sources and writes a new ignored artifact directory.

The recorded run is `artifacts/daily-work-1794933514788/discovery.json`. Its private HTML is `cestOn-your-daily-work.html` in that directory. Personal paths, activity dates and screenshots stay ignored. No transcript text, conversation titles, native session IDs or credentials are embedded in these deliverables.

| Check | Observed result | What it establishes |
|---|---|---|
| Codex bounded JSONL metadata discovery | 567 files considered; 566 usable session headers; one file without usable metadata | Real saved sessions provide working folders. The incomplete file is not silently counted as discovered. |
| Claude SDK 0.3.325 listSessions | 192 records with includeProgrammatic:false; 176 have cwd; 16 do not; zero archived in the returned set | Provider-supported enumeration works here without a model turn or manually selected folder. Missing-folder records remain an unresolved coverage count. |
| Combined folder index | 742 distinct provider/session records associated with 32 case-normalized working directories | The proposed automatic folder list can be derived from this machine's actual history. |
| Existing cestOn reader, given the derived roots | Codex: all 566 IDs matched. Claude: all 176 selected IDs matched among 637 reader results | The app's current parser can recognize the selected records. Its reader exposes additional records and lacks the SDK's equivalent programmatic filtering; 637 is not an interactive-session count. |
| Filesystem presence/type | Existing paths checked; only .git markers in the cwd/ancestor chain examined | Folder availability and Git classification are observed, not invented. No project source was read or modified. |

Examples found through those methods, with personal absolute paths omitted from this public note:

| Working folder | Codex and/or Claude records | Filesystem finding |
|---|---|---|
| cestOn | 1, Codex | Existing Git repository |
| ITM.PMPilot | 18, both providers | Existing Git repository |
| itmplatform.com | 34, both providers | Existing Git repository |
| Lead gen analysis mid-2026 | 25, both providers | Existing G-drive folder with a Git marker; do not assume it is non-Git because it contains documents |
| Obras | 10 | Existing working folder with no Git marker found in its parent chain |

The HTML's private version contains all 32 discovered folders and individual dated records. No fake Platform path is presented as local evidence. The checked-in version is explicitly a shareable layout example; it carries no personal directory inventory. Re-running the probe regenerates a new private HTML from the current template.

## Methods and boundaries

Codex: at most 4,000 JSONL candidates under the selected CODEX_HOME sessions directory, recursion limited to eight levels and symbolic links skipped. Read at most 64 KiB at the head and tail of each file. Extract session ID/cwd/source from session_meta; take the maximum parseable timestamp from the tail, falling back to file mtime with an approximate-date label. Archived sessions and other accounts/homes are outside this run. A bounded tail can miss a large final record, so this is not exact user-interaction recency.

Claude: call the installed SDK without a directory filter, with pages of 200 and a 4,000-result cap. Exclude programmatic sessions through the SDK option, then omit archived entries and count entries without cwd. Use lastModified as an explicitly approximate activity timestamp. The SDK can inspect local transcript content internally; the probe selects metadata only and neither outputs nor copies messages.

Deduplicate by provider/session ID; group by case-normalized absolute cwd. This research script is not the final identity algorithm: aliases, junctions, WSL/SSH paths, worktrees, moved folders and missing metadata still need handling. Parent Git-marker checks preserve subfolder identities. No repo contents are crawled. Source timestamps can change during this non-atomic snapshot. Source provenance alone does not prove that a session was human-started.

Run the actual SessionDiscovery implementation against the automatically derived roots and compare provider IDs in memory. That proves parser overlap, not that the current app already discovers unregistered folders. It still requires supplied projects and filters by configured provider.

The production preference remains version-matched supported provider APIs. [Codex app-server](https://learn.chatgpt.com/docs/app-server) documents thread listing with directory metadata, pagination, update/recency sorting and an index-only option; that app-server listing was not exercised in this run. [Claude session documentation](https://code.claude.com/docs/en/agent-sdk/sessions) identifies the listing/history APIs; its installed listSessions function was exercised here. No assumption of one cross-provider central registry is needed.

## Acceptance still needed

1. Implement automatic source discovery in the app, with accurate coverage/error reporting, durable identities, pagination and incremental refresh. Compare with independently sampled records and titles from each actual client, including unresolved entries and nested/non-Git folders.
2. Validate recent-activity semantics against actual user interaction; test equal/missing timestamps and prevent a scan, title update or UI visit from falsely moving a conversation to the top.
3. Prove continuation of a specific existing running Codex conversation and a specific existing running Claude conversation, separately. Demonstrate delivery, acknowledgement and returned response in the same conversation, permissions, reconnect and no competing writer. If unsupported, document that boundary before claiming this workflow is usable.
4. Test the whole away-from-PC journey on a real phone: initial pairing, secure connectivity, awake/asleep/offline host, read history, send, receive and reconnect. The PC must stay awake and connected for agent work.

The previous 106 automated tests are evidence for the baseline application and fixture scenarios. They do not certify this revised workflow, live provider control, an installed phone experience or automation classification.

## Mandatory memory foundation added after this review

The owner subsequently required maintained project knowledge from the first usable revised workflow. [U19](13-project-memory.md) includes explicit project relationships and explained importance/urgency. This does not reinstate speculative related-session suggestions: those remain deferred, while remembering confirmed project connections is now required. The original test and discovery evidence below does not verify memory.

## Recommendation and tradeoffs

| Proposed change | Impact | Complexity | Side effects | Recommendation |
|---|---|---|---|---|
| Simplify the illustrative UX and explain verified examples | Medium | Low | Contained | Yes; implemented in the prototype to resolve the owner's navigation and terminology confusion. |
| Automatic provider-neutral folder discovery and recency | High | Medium | Contained | Yes as the next agreed application revision; the real metadata probe establishes feasibility, not production readiness. |
| Treat same-conversation remote replies as a required acceptance gate | High | High | Broad | Yes; feasibility must be established with both providers before promising the complete daily workflow. |
| Add related-session suggestions or unsolicited AI recaps now | Low | Medium | Contained | No; owner explicitly deferred them to focus on the daily flow. |

## Verification and resume

Browser command: `node design/check-daily-work.mjs artifacts/daily-work-1794933514788/cestOn-your-daily-work.html`. The checker reads the supplied HTML only and does not access provider homes. It covers desktop and phone layouts, both themes, every discovered folder's counts and ordering, provider filters, search, successive phone screens, keyboard dialog/Escape, unavailable/offline reply states, escaped user text, offline static reload and local links. Browser evidence goes into a new ignored daily-work-browser directory. Static offline behavior is not PWA or remote-reconnect acceptance.

Verified result: artifacts/daily-work-browser-1794933544468/result.json is passed for all 32 folders and 742 records, at 1440, 390 and 320 pixels in light/dark themes. Desktop, phone and reply-example screenshots were inspected. There were zero browser errors or external network requests. The probe refused execution without its explicit flag and created no output directory in that refusal check. Node syntax checks, typecheck, lint, build, documentation and public-export checks passed. The full application test suite was not rerun for this prototype/research change.

The first snapshot contained 741 records; a subsequent run found one additional Codex record in Lead gen analysis mid-2026. Both are retained privately. The current deliverable uses the later 742-record snapshot, illustrating why refresh and clear capture times matter.

Resume from [implementation-run.md](implementation-run.md). The discovery probe and HTML checks above remain dated predecessor evidence. Current runtime discovery, memory and General have their own tests and package evidence. Same-conversation control and physical-phone use still require direct evidence.
