# User experience, themes, and mobile installation

## Navigation and layout

Desktop has an activity rail, task/project sidebar, central task or Today view, optional assistant panel, and a thin status bar. It should feel familiar beside VS Code without copying its branding or editor controls that cestOn does not implement. At widths below 768 px use one content column and bottom navigation: Today, Work, Needs me, Assistant. Preserve route, selected task, draft, and scroll position on navigation.

Routes: `/today`, `/tasks`, `/tasks/:id`, `/decisions/:id`, `/assistant`, `/updates/:id`, `/settings`, and `/install`. Deep links authenticate before fetching private data. Missing/deleted/revoked items show an explanation and return path. Never expose a raw local path in a URL or notification.

Today prioritizes decisions and blockers, then running work and review-ready outcomes. Each task card shows project alias, title, current phase, status, evidence age, and next action. Detailed provider identity is available but not required to issue instructions. Show observed-only sessions distinctly from managed tasks.

## Theme tokens

Implement CSS variables; no scattered literal colors in components. Default `system`, with explicit `dark` and `light`, persisted per device. Resolve before first paint to prevent a bright flash. Reduced-motion and high-contrast settings remain effective. The icon keeps its supplied cyan/blue colors in both themes.

| Token | Dark | Light |
|---|---|---|
| background | `#1e1e1e` | `#ffffff` |
| sidebar | `#252526` | `#f3f3f3` |
| panel | `#2d2d30` | `#f8f8f8` |
| border | `#454545` | `#c8c8c8` |
| text | `#d4d4d4` | `#242424` |
| muted | `#ababab` | `#616161` |
| accent/button | `#007acc` | `#0067b8` |
| focus | `#75beff` | `#005fb8` |
| success text | `#89d185` | `#176b29` |
| warning text | `#cca700` | `#795e00` |
| error text | `#f48771` | `#a1260d` |

Verify contrast for actual text/background combinations, especially white button labels; adjust tokens if they fail WCAG AA. Use Segoe UI/system sans-serif and a system monospace for code, 14 px desktop body and 16 px phone inputs. Use 4-8 px corners, restrained shadows, compact desktop density, and at least 44-by-44 px mobile targets. Labels and icons accompany every status color.

## Essential screens

Implement all U01-U18 flows in the product contract. A task page has Overview, History, and Evidence sections; a scoped instruction composer; visible command acknowledgement; and a small scope/limits panel. Decision cards show alternatives, recommendation with reason, affected scope, and expiry. Review packets show the actual change summary, test outcomes, and unresolved work. Diff views support wrapping on phones and a full artifact download.

Settings covers registered projects, provider capability health, devices/revocation, theme, voice, notification permission, autonomy limits, installation status, and local release/rollback history. Sensitive setup uses the local console flow; do not offer arbitrary host path/executable editing to a paired mobile device in version 1.

The “Improve cestOn” action is accessible from the assistant and Settings. Capture current page, release, expected/actual behavior, optional user-selected screenshot, and acceptance criteria. Exclude conversation text and private project details unless explicitly selected. Show reproduction, implementation, verification, applying, and verified/rolled-back stages, with the new release ID in expandable details.

## PWA contract

Provide a manifest with stable `id: "/"`, `name` and `short_name: "cestOn"`, `start_url: "/today"`, `scope: "/"`, `display: "standalone"`, theme/background colors, and supplied-icon derivatives: 192/512 PNG, maskable 192/512 PNG with safe padding, and 180 PNG Apple touch icon. Keep the SVG master unchanged; generate derivatives reproducibly. Inspect the icon at small launcher sizes and against both backgrounds. A favicon alone does not satisfy installation.

HTTPS is required for remote installation and microphone access. Loopback is the development exception; an HTTP LAN URL is not the production mobile path. Add browser-specific installation help, a Chromium install action only when its install event is available, and iOS Home Screen instructions appropriate to the tested OS. Detect standalone mode and hide redundant installation advice.

Use a service worker to cache versioned static application assets and an offline shell only. Do not cache authenticated API responses, provider history, audio, or evidence by default. Pending drafts may be stored in IndexedDB per installation/device; clear them on logout/revocation and expire after 24 hours. A disconnected draft is labelled unsent and requires explicit send after revalidation. No background sync of mutating commands.

Keep the active UI bundle compatible with its API protocol. An update downloads into a waiting worker, preserves drafts, and activates after the server confirms release readiness and there is no active voice recording or unsent transition. On 426/protocol mismatch show a refresh banner and block writes until refreshed. Rollback can serve the previous static bundle; clear only obsolete cache namespaces, not every origin cache.

## Voice and notifications

Version 1 uses push-to-talk, not always-on listening. Capture audio only after a deliberate tap and permission grant; show recording time, stop/cancel, and the selected task. Negotiate MediaRecorder MIME support. Transcribe through a configured server-side speech adapter; no provider key enters the client. Offer an editable transcript and send action. For a clear direct voice instruction, an operator-enabled fast mode may send after showing interpretation; ambiguous or external approval commands still require an explicit choice bound to the current action.

Read-aloud uses a configured server voice or browser speech synthesis when supported, with visible transcript, stop, and replay. No automatic playback before a user gesture. Do not promise background microphone operation or speech after the phone locks. Provider absence or denial leaves text fully usable. Temporary audio is deleted after transcription or within 15 minutes after failure; never log it.

Persist in-app notifications independently of push delivery. Request push permission only from a user gesture after explaining its purpose. Send generic text such as “cestOn needs a decision,” not customer/task content, unless the operator explicitly chooses detailed previews. Deduplicate by decision revision/event ID. Open a task/decision route and revalidate it; do not execute an approval from a lock-screen action. Retry transient delivery at most three times; remove 404/410 subscriptions. “Submitted to push service” is not “seen on device.”

## Native wrapper decision

The installed PWA is the required mobile app for version 1 and satisfies the icon/standalone-window requirement. Capacitor can later package the web UI for stores and native integrations. Do not add a wrapper merely to obtain an icon. If requested later, add native push/device lifecycle/storage tests, signing and store release procedures, and platform-specific update policy review. A Windows development host cannot establish an iOS native release by browser emulation.

## Accessibility and failure states

Support keyboard-only navigation, visible focus, meaningful labels, live regions for command results, reduced motion, and screen-reader names for icon buttons. Restore focus after dialogs and return to the invoking control. Test 200% zoom, long text, virtual keyboard, safe-area insets, landscape, and touch targets. Show loading, empty, permission-denied, stale, offline, revoked-device, provider-expired, partial-stop, failed-update, and recovery screens with an actionable next step.
