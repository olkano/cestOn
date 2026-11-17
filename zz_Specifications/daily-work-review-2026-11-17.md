# Daily workflow revision and discovery evidence

Status: UX proposal updated after owner feedback; production redesign has not started. This note supersedes the daily-flow recommendations in the earlier [reassessment](reassessment-2026-11-17.md). The [HTML preview](../design/cestOn-session-first.html) explains the experience for the owner; this document is for implementation and resumption.

## Product decisions reflected in the preview

- Discover working folders from the connected Codex and Claude history sources automatically. One initial connection/scope setup is reasonable; requiring manual registration of every existing folder is not the proposed daily flow.
- Use **Your folders → Conversations → Conversation**. A folder can be a Git checkout, a subfolder or a non-Git working directory. Git is optional. Preserve exact working-directory identity for now; do not collapse nested projects into a large parent repository automatically.
- Sort conversations by last recorded activity, descending. Sort each folder by the maximum conversation activity within it. Opening the UI must not update these timestamps. Date provenance and missing dates matter; neither discovery time nor session creation time is a substitute for recent use.
- Show original provider messages in the selected conversation. Use the provider's title when available. Do not generate an unsolicited summary. The research snapshot deliberately omits titles and messages and uses neutral provider labels.
- The intended away-from-PC workflow is to continue the same conversation inside cestOn. Read-only discovery is an intermediate implementation milestone, not acceptance of the complete product. Do not make switching to a vendor's remote-control app the ordinary cestOn flow.
- Replace “Observe only” in product copy with “Reply unavailable for this conversation,” explaining the specific connection limitation. Never silently fork, resume a second competing writer or create a different task when the user expects the original live conversation.
- Defer related-session suggestions and automatic summaries. Keep agent diagnostics out of the main screen. Automation attribution/filtering still needs its own evidence.

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

Resume from this note and the latest browser result. Preserve the separation between the shareable template and private discovered data. The application ledger remains blocked on real-provider/device/operational gates. No app redesign, provider control, service activation or history migration has been performed.
