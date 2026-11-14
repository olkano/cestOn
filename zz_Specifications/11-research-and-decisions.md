# Design decisions and evidence

Baseline inspected 2026-11-14. Refresh provider/browser compatibility during phase 0 and before releases. Sources establish available building blocks; they do not establish that cestOn has been implemented or that this operator's devices/accounts support every feature.

## Decisions fixed by this specification

| Decision | Rationale and consequence |
|---|---|
| Separate local `cestOn` repository, proposed `olkano/cestOn` public home | Existing cestDone remote is `https://github.com/olkano/cestDone.git`; Olkano app remote is `https://github.com/olkano/olkano.git`. “Alongside” means a sibling repository in the organization, with independent releases. |
| Self-hosted single-owner app | Fits the existing desktop workflow and permits public distribution without building shared hosting, tenant billing, or account administration. |
| PWA first | Provides the requested home-screen icon and standalone experience with one UI codebase. Native wrapper remains optional. |
| Provider-neutral durable task model | A task can outlive a provider session. Discovery, resume, steering, and ownership are separate capabilities. |
| Owned provider processes plus optional cestDone batch adapter | Avoids treating the operational scheduler as a remote interactive API; keeps existing scheduled work independent. |
| Separate supervisor and broker | A coordinator update can recover without losing the process that owns active work or the component that can roll it back. |
| Local requested improvements apply after verification | Fulfils the direct-fix workflow while preserving scope and recovery. Public release and protected policy changes remain distinct actions. |
| VS Code-inspired tokens and supplied icon | Matches the user's preferred workspace appearance; both themes are required, with ordinary web accessibility. |

## Opened official references

- [Codex app-server lifecycle](https://learn.chatgpt.com/docs/app-server#lifecycle-overview): initialize a connection, create/resume a thread, start/steer/interrupt turns, and consume completion events. This supports the chosen owned-process adapter; it does not prove takeover of an unrelated running IDE process.
- [Claude session management](https://code.claude.com/docs/en/agent-sdk/sessions): exact-ID resume, forks, session enumeration and history. Session history and filesystem state are separate concerns. Certify the installed version rather than assuming every helper exists.
- [Claude permission evaluation](https://code.claude.com/docs/en/agent-sdk/permissions): permission mode, rules, hooks, and callbacks have an evaluation order. The implementation must test effective denial, not assume one callback intercepts every operation.
- [PWA installation](https://web.dev/learn/pwa/installation): installed web apps can have launcher icons and their own window; installation flows vary. Some platform details on that page lag newer Safari behavior, so use current WebKit guidance for Apple-specific instructions.
- [Safari 26 web app behavior](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados): Home Screen web app behavior is available on current iOS/iPadOS described there. Test the actual supported device version before finalizing screenshots or install steps.
- [Web Push for iOS Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): push support and user-gesture permission requirements establish the mobile notification approach. Delivery and installed-device behavior still require physical testing.
- [Capacitor installation](https://capacitorjs.com/docs/getting-started): a native wrapper can be added to a web project. This is a later packaging option, not part of the version-1 acceptance scope.

## Local evidence and limits

Read the source repository guides, cestDone package metadata, CLI, backend types, and Codex/Claude backend source at local cestDone revision `fb30d27`. These show useful provider execution patterns but no stable public cestOn bridge. No existing job, provider session, daemon, tunnel, account setting, or external service was changed or tested as part of specification authoring.

The historical exploration and first mockup were moved byte-for-byte into ignored `reference-private/`; the source folder now contains a relocation pointer. The current design prototype is a separately revised artifact with generic sample project names. No historical report was rewritten to make old observations look current.

## Documentation placement review

The new root README owns current workspace status and entry links. The short AGENTS file owns agent behavior and repository boundaries. Detailed product, API, provider, security, update, test, and release requirements are split into focused specifications rather than embedded in those living documents. This explicitly reviews the addition of more than ten new lines to a new README/AGENTS. Neither exceeds its parent soft length threshold.

No application code, live remote access, public repository, package publication, or operational self-update is authorized by this documentation delivery. Implementation commands in the specs become real only when phase 0 creates them.
