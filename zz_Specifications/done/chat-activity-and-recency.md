# Conversation activity and recency

Status: implemented and locally verified on 2026-11-18.

## What Chats shows

- Show a blue **Working** indicator in the conversation list and in the thread for a reply cestOn is processing or for activity the provider confirms. Show **Needs input** when the provider reports that it is waiting for the user.
- Show **Likely working** when the saved transcript has a recent turn start or an unfinished exchange without a terminal event. Expire that estimate after three minutes without relevant updates. A selected thread can show **Activity unconfirmed** where evidence is missing or stale. A provider app can remain open after its turn ends.
- Show new visible messages from the selected Codex or Claude transcript while the thread is open. Read new snapshots on a short authenticated polling interval and keep the existing connection and authorization rules. Show public progress messages and assistant replies as the provider saves them. Keep private reasoning, tool payloads and other sessions out. Preserve earlier pages and loaded messages during refresh or disconnect, and avoid duplicate copies of replies already in saved history.
- Give conversation rows and the selected thread a clock label, with the full local timestamp available on the time element. Use a provider turn-completion time where available and label a last-message or estimated time when it is the best available evidence. A folder row uses the newest conversation across that folder, including when a search narrows the visible results. Keep folders and conversations ordered by newest activity.
- Under an hour, show whole minutes with strong emphasis. Change emphasis at one hour, five hours, twelve hours, one day, two days, four days and seven days. Use whole days from one day onward and muted gray rows from seven days onward. Keep active indicators visible on old rows and preserve legibility in both themes. Represent status and elapsed time with text as well as color.

## Sources and refresh

Observe exact-session Codex turn markers and Claude assistant stop reasons in the bounded transcript reader. Where the configured Claude executable supports it, read its local session roster and map exact session IDs to working, waiting or idle. The [Claude roster contract](https://code.claude.com/docs/en/agent-view#read-session-state-from-a-script) documents these fields. Codex App Server status belongs to a loaded thread on that server. cestOn observes the external saved transcript without loading or resuming it. [Codex App Server lifecycle](https://learn.chatgpt.com/docs/app-server#track-thread-status-changes)

Recheck the selected transcript about every two seconds and refresh visible rows about every five seconds while Chats is connected and visible. Keep broad discovery on its existing slower cadence. Preserve exact-ID and path validation, ordered pagination and bounded reads. Refreshes perform reads only. They never dispatch commands, start a model turn or clear an offline draft.

## Acceptance

1. Start a synthetic saved turn, add two visible messages across separate writes, and end it. The list and selected thread show changing status, both messages appear without reopening, and the terminal time replaces the running cue. Repeat with provider-specific evidence for Codex and Claude.
2. Confirm an idle Claude roster entry does not show **Working**. Check stale and interrupted turns, unrelated session data, partial records and unavailable status sources.
3. Check the time-range boundaries and folder recency under search. Verify desktop and phone-sized layouts in both themes, keyboard selection, an earlier page retained while live messages arrive, and reconnect without duplicates.
4. Run the repository checks and record native runtime or physical-device coverage separately.

## Verification

The independent clean export passed typecheck, lint, build and 125 automated checks. The four focused Edge scenarios passed. The browser covered 1440 px and 390 px in light and dark, keyboard selection, older history retained when several messages arrived, a gap larger than one history page, reconnect, and the Claude roster transitions. The [first-use guide](../../docs/first-use.html) explains the new activity labels.

A read-only PC check sampled 30 chats per provider. It found turn-end evidence in 29 Codex and 25 Claude chats, and the Claude roster identified two working sessions. The check started zero model turns. Fixtures exercised live transitions. Physical-phone testing remains open, and the live installation serves the prior saved-chat build.

See [the ledger](../implementation-status.md) for the verified candidate and private evidence references.
