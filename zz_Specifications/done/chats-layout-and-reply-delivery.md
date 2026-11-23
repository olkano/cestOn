# Compact Chats and reply delivery

Status: implemented and deployed to the existing Windows installation on 2026-11-19.

Chats opens across all folders. A folder selector and search field narrow the list. Recent conversations remain one click away, and a selector and pagination reach the rest. Keep activity and recency visible while giving the opened conversation the full content width.

The transcript scrolls independently of its heading and reply box. Opening a conversation and following a live reply show the newest messages. Reading older messages keeps the reader's position. Render Markdown in both saved and cestOn messages, including lists, links, code and tables. Treat message content as untrusted and suppress raw HTML and remote images.

Accept a reply once against the selected original conversation. If its provider definitively refuses before starting a turn because the session is open, keep the reply queued and resume the same session when available. Show where it is waiting and let the user cancel a waiting reply. Only retry after a recorded pre-turn refusal. An uncertain delivery stays in reconciliation. Keep the existing read-only and subscription limits.

Verify the compact layout, scrolling, Markdown, and exact-session delivery with synthetic Codex and Claude threads at desktop and phone widths. Include duplicate, waiting, cancel and release checks. Rehearse the release, restart the existing installation, and verify the deployed build at the owner's HTTPS address.

## Verification and remaining limit

The final package passed 126 automated tests and archive verification. In fixtures, pending replies survived browser reload and broker/database reopen, could be cancelled, and went to their original threads exactly once after release. Desktop and phone-sized Edge tests also covered earlier messages during live updates, Markdown, and selecting a chat outside the recent chips. On the PC, both native providers recalled prior context in disposable exact-thread replies, and a separate Codex server reproduced its open-writer refusal before a turn started.

Immediate delivery into an already-open provider session remains unavailable on this installation. The default Codex queue acknowledged a prompt without an observed turn on the original separate server. Claude's documented inbox direction requires a receiving session with messaging enabled and per-session Windows authentication. See the [Codex queue contract](https://learn.chatgpt.com/docs/developer-commands#codex-queue) and [Claude inbox contract](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

The isolated package started, served the authenticated workspace, backed up and restored, and stopped cleanly. The existing PC now serves the verified bundle at `https://ceston.troho.net/`. Desktop and phone-sized Edge reached Cloudflare sign-in. Physical-phone acceptance remains open. See the [implementation ledger](../implementation-status.md) for release, test, and read-back evidence.
