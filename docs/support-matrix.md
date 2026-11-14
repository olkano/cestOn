# Support and acceptance boundaries

| Component | Locally exercised | Remaining gate |
|---|---|---|
| Windows x64, Node 24.14.0, npm 11.9 | Native SQLite, owner ACL/DPAPI, private IPC, exact process ownership, package and recovery fixtures | Actual sign-in, locked desktop, reboot and persistent pilot acceptance |
| Chromium desktop and phone viewports | Production bundle, dark/light/system, keyboard, 200% zoom, five-task journeys, offline drafts, reconnect and two-device conflict | Physical browser/assistive-device behavior |
| Android and iOS PWA | Manifest, supplied icons, static-only worker and controlled refresh fixtures | Physical standalone install, real microphone and lock-screen push on each platform |
| Codex 0.160.0 | Owned transport and fail-closed policies tested with fixtures; zero-turn native handshake | Windows sandbox setup, authenticated dedicated home, actual denial and capped live work |
| Claude 2.1.317, Agent SDK 0.3.325 | Session targeting, restrictive tools, billing observation and denied-tool hooks tested with fixtures | Dedicated authentication and actual native denial/start/resume/interruption |
| Requested local updates | Real separate-process fixture regression, independent rebuild, activation, 120-second observation, refusal and rollback | Real coding-provider self-update certification; never inferred from fixture success |
| Speech and notifications | Bounded WAV/transcript handling, deliberate read/stop controls, durable inbox, encrypted delivery/retry/removal | Explicit optional service configuration and actual device delivery/audio |
| cestDone | Disabled capability and isolation boundary | Optional adapter has no certified isolated-result contract |
| Linux/macOS hosts, other browsers, native app wrappers | No support claim | Platform acceptance and OS credential/ownership support |

The [acceptance ledger](../zz_Specifications/implementation-status.md) and [test matrix](../zz_Specifications/acceptance-evidence.md) contain current results. A blocked gate is not a passing test. Native models are never silently replaced with fixtures. Sleep/sign-out can stop host availability; closing a browser does not stop acknowledged broker work on an awake host.

Ordinary UI changes can be eligible for automatic local application after certification and explicit request authority. The current independent policy conservatively protects broad execution, authorization and persistence surfaces. Schema changes need old/new compatibility proof; unsupported migrations stop. Public signing/distribution, shared hosting and account integrations are separate work.

This source is available in the authorized public repository, but the application package remains private and unlicensed for redistribution pending the owner's license choice and release review. No persistent installation or public application release is implied by a source push.
