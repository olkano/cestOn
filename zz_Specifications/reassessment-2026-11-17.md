# Reassessment of the project and session workflow

Research date: 2026-11-17. This is a proposal for discussion, not a replacement for the numbered specifications. No application redesign, provider-setting change, history migration or daemon restart is included. Open the [interactive proposal](../design/cestOn-session-first.html) to compare the current flow with the proposed experience.

## Assessment

Your expected entry point should be the product's entry point: **project or folder → existing AI sessions**. You should not have to create a task to see a conversation you already use in VS Code. The current implementation does require too much preparation and places existing sessions behind a task-oriented screen. This is a product-model mismatch, not just a missing explanation in the manual.

The useful foundations can remain: private device access, the durable command journal, provider adapters, process ownership and the separate update supervisor. Tasks and verification jobs can remain internal machinery for work cestOn starts. They should not be the compulsory container for existing sessions.

## Comments on your feedback

### 1. Synthetic workspaces

You are right that these do not belong in your normal working experience. They are disposable test fixtures created by the development launcher, not a requirement to reorganize your real files. The mistake was presenting that test environment as the practical starting experience while saved installation and real-provider acceptance were still incomplete.

Recommendation: retain fixtures for development and tests. Make normal first launch connect approved local history sources, suggest existing folders and explain any unavailable provider. Do not create fake projects in a personal installation.

### 2. Projects, folders and existing sessions

The current app already has projects and observe-only session discovery, but the UI puts discovery inside the Work screen and offers a new task as the continuation path. Its discovery backend only considers projects assigned to the selected provider, and its fallback matches the reported working directory exactly. This can hide Claude sessions for a project assigned to Codex, or miss sessions opened in subfolders and worktrees. Titles and useful source information are also absent from the current session-list response.

Recommendation: separate a project's identity from its preferred execution provider. One folder can contain Codex and Claude sessions. Give each session a provider ID, source home, provider session ID, working-directory evidence, title and last-observed timestamp. A local index represents your existing organization; it does not copy or move your projects.

Discover candidates from approved Codex/Claude history locations, then optionally search approved parent folders for repositories. A folder picker or a message such as “Show sessions for this folder…” should preview the resolved path and ask you to confirm the discovery scope. That confirmation permits observation, not unrestricted agent writes.

### 3. Related sessions and workstreams

Automatic suggestions are practical. First use recorded parent/fork relationships, canonical folder, Git worktree identity, branch, titles, issue references and shared file/entity names. Preserve separate checkout identities even when repositories share a remote. Repository membership alone is not enough to infer a shared topic.

Show “Possibly related” with its reasons. Let you keep or reject the link, without merging sessions, rewriting their histories or requiring a task. A workstream is an optional view over independent sessions.

Conversation-based similarity needs more development and a representative evaluation set. A first version can use local titles and bounded, explicitly requested excerpts. Semantic analysis should be opt-in, with clear disclosure of any model use, cost and content sent outside the PC. No grouping accuracy has been measured in this review. Concurrent unrelated work, generic titles and copied prompts will produce false matches.

### 4. Claude Code and Codex

Both support a useful project/session index. Codex showing a global history list does not imply its sessions lack folder information.

| Question | Codex | Claude Code |
|---|---|---|
| Persistent local history | State under CODEX_HOME, including sessions; the default is the user's .codex directory. The current client also uses indexed state and paginated history. | Transcripts under .claude/projects, with session metadata; alternate homes and other runtimes need explicit source configuration. |
| Supported discovery | App-server thread/list supports cwd and source-kind filters. Use version-matched APIs before a JSONL fallback. | The installed Agent SDK exposes listSessions, getSessionInfo and getSessionMessages. Directory filtering can include Git worktrees. |
| Interactive versus background | Source kinds include CLI, VS Code, exec and subagents. Current documentation defaults thread/list to interactive sources; custom scheduler attribution still needs provenance. | The installed SDK supports includeProgrammatic; a session browser can deliberately separate headless/SDK sessions. |
| Directory evidence | Reported cwd is useful, but is not proof of every folder touched during the conversation. | SDK metadata can contain cwd, branch, summary and timestamps. These fields can be incomplete. |
| Live state | App-server exposes state/events for threads it actually knows about. Another server's notLoaded state is not proof that the IDE's session stopped. | A connected SDK/IDE process can emit running/idle/requires-action signals. Historical metadata alone cannot establish live state. |
| Existing-session control | Resume and steer APIs exist. Using an existing live IDE session needs the correct owning transport or an explicitly supported bridge; a new app-server is not automatically that connection. | Native Remote Control can continue existing CLI and VS Code sessions in Claude's own web/mobile clients, subject to eligibility. That does not establish a tested third-party control API for cestOn. |

The practical control distinction is **history-only**, **live observation connected**, and **control connected with explicit authority**. These are separate capabilities. Reading a transcript neither grants control nor proves that a session is idle. Start with visibility and a route back to the original provider UI; enable send, approval and interruption only after an adapter proves support for that exact session.

Claude's supported Remote Control is also an immediate vendor-native option worth considering for phone interaction with eligible Claude sessions. It does not provide the unified cross-provider project view you want from cestOn. No Remote Control session was activated during this review.

Sources: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables), [Claude session APIs](https://code.claude.com/docs/en/agent-sdk/sessions), [Claude local data](https://code.claude.com/docs/en/claude-directory), [Claude Remote Control](https://code.claude.com/docs/en/remote-control). Current documentation is not a claim that every feature has been verified against cestOn's pinned runtime.

### 5. cestDone and history clutter

There are two separate outcomes: hide automation by default in cestOn, and prevent new scheduled sessions from entering the interactive client's history.

The inspected cestDone backend already resolves its home in this order: explicit backend option, otherwise CESTDONE_CODEX_HOME, CODEX_HOME, then the invoking account's default .codex. It passes that home to its Codex child. It also supplies threadSource: cestdone for new threads; the installed Codex SDK maps that option to --thread-source. These are existing mechanisms, not features that first need to be invented.

However, the inspected dotenv/configuration, current shell and saved PM2 daemon dump showed no matching home override. The saved dump does not prove the live service environment. A bounded sample of the interactive history found no cestdone tag. Therefore this review does **not** establish which scheduled sessions are appearing in the IDE, or that a shared home is their confirmed cause. Old sessions, another launching path, client filtering, and account-scoped views need correlation with known scheduler session IDs. No history was deleted or reclassified.

Recommendation: classify explicit scheduler provenance first, then known automation homes, with generic exec/headless sources as broader automation hints. Never call every exec session “cestDone,” and keep “origin unknown” available. In cestOn, interactive sessions appear by default and an Automations switch reveals background work.

For operational isolation, first verify the effective live launcher home and correlate a known job/session pair. If it is shared, provision a dedicated persistent automation home and authentication through the approved service identity, preserving its required settings and tools. Set the override only for cestDone's launcher; do not change the user's global CODEX_HOME. Verify new-job persistence, resume, attribution and exclusion from the installed IDE's history. This is a separate cestDone deployment change requiring an idle window and appropriate authorization. Existing history would remain unchanged.

An ephemeral run can avoid saving history, but it sacrifices resumability. It is a poor default for cestDone's resumable jobs. Separate persistent state is the better starting proposal, subject to the verification above. OpenAI documents independent batch homes and the ephemeral tradeoff in [independent batch jobs](https://learn.chatgpt.com/docs/environments/network-file-systems#run-independent-batch-jobs).

### 6. Folders outside Code and Google Drive

Your document folders are valid projects. Git should be optional. Sessions whose cwd points into a locally available Google Drive folder can be associated with it without moving anything. The application database and provider state should remain outside synchronized project folders.

Index approved metadata first, retain the provider's original path, resolve Windows casing and junctions, and handle missing/offline/cloud-placeholder paths without silently discarding sessions. When a session reports a subfolder, use the most specific approved project root; when it spans several contexts or has conflicting metadata, expose that ambiguity and let you correct the association. WSL, SSH and other accounts require separate approved sources, not an assumption that the Windows scanner sees everything.

### 7. Recommended experience

1. First launch asks which local history sources and parent folders to observe, and shows the exact read scope.
2. The home screen lists existing projects with recent sessions from both providers. No task creation is required.
3. Selecting a project shows titles, provider, checkout/branch, interactive/automation origin, last recorded activity and independently labelled control availability.
4. A missing folder can be added by picker or natural language with a path confirmation.
5. Related-session suggestions are optional, explained and reversible. Original conversations stay accessible.
6. A session detail shows history immediately where available. Its send/approval/stop controls depend on an actual provider connection and explicit authority. Unsupported controls explain why.
7. Work started through cestOn can still use the durable broker, permissions, verification and update machinery. That machinery should not dictate the primary navigation.

## Implementation proposal and tradeoffs

These ratings assess future work. Nothing in this table is an instruction to implement before agreement.

| Change | Impact | Complexity | Side effects | Recommendation |
|---|---|---|---|---|
| Make existing project/session visibility the main experience | High | High | Contained | Yes, as an agreed product revision; current task/command assumptions require more than a homepage replacement. |
| Replace narrow fallback discovery with provider-specific, incremental metadata indexing | High | Medium | Contained | Yes; preserve bounded reads and make unsupported formats visible. |
| Separate automation in the session browser using provenance | High | Medium | Contained | Yes; directly addresses the clutter without deleting provider history. |
| Change cestDone's effective home if a shared-home cause is verified | Medium | High | Contained | Conditional; coordinate service authentication, tools, resumability and a safe deployment window in that repository. |
| Suggest related sessions from local metadata, with review | Medium | Medium | Contained | Yes as a later optional feature; evaluate false matches before deeper semantic analysis. |
| Promise control of every existing live IDE session from transcript access | Low | High | Broad | No; provider transport, ownership and permissions are not established by a history file. |

Suggested sequence: agree the product model; implement read-only discovery and the project/session UI; add provenance and automation isolation with a separately verified cestDone change if needed; evaluate related-session suggestions; then add and certify provider-specific live-control integrations. Do not make complete live-control parity a prerequisite for useful visibility.

Acceptance for the first revision should include: open both providers' existing sessions without creating a task; find a nested repository and a non-Git document folder; preserve ambiguous/missing paths; distinguish source and control capability; reject a false related-session suggestion; paginate large histories; and show background sessions only when requested.

## Evidence and limits

- cestOn source reviewed at 5eead32: [discovery reader](../packages/adapters/src/discovery.ts), [broker discovery selection](../apps/broker/src/runtime.ts), [session routes](../apps/server/src/http/routes.ts), [current session UI](../apps/web/src/sessions.tsx), and the architecture/adapter contracts. No app source changed.
- Local Codex header sample: 566 candidate JSONL files, 565 readable session-metadata records, all 565 containing cwd. Eight reported a G-drive cwd. All sampled source kinds were vscode; thread_source was absent in 557 and user in eight. These counts establish metadata availability, not a complete inventory, current running state, or scheduler attribution. Account-scoped headers were present, so actual client-view isolation must be verified rather than inferred solely from directories.
- Local Claude sample: 55 project directories were visible; 160 bounded transcript-header reads contained a session ID, and 108 exposed cwd within the sampled prefix. Missing cwd in that prefix is not proof it is absent from the whole session. No conversation text was copied into the deliverables.
- Installed local declaration files expose the Claude session-listing options above in Agent SDK 0.3.325. The cestDone Codex SDK was 0.155.1 and exposes threadSource. The inspected cestDone source was based on f326f4c, with unrelated local changes present; those files were left untouched.
- Inspection read selected nonsecret home-setting keys and a saved daemon environment snapshot, not credentials. The effective live daemon environment, job/session attribution, current IDE filter behavior, provider deep links and a third-party live-control bridge remain unverified. One guessed documentation URL was inaccessible; the official Claude directory page linked from its architecture guide was then opened successfully.
- No provider model turn, login, live session takeover, daemon restart, scheduled job, history modification or major redesign was performed. The visual proposal uses illustrative rows only.
