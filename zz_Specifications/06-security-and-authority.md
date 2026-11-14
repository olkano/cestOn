# Authentication, authority, and data boundaries

## Threat model

Protect a single-owner installation from unauthenticated internet access, cross-site requests, lost-device sessions, malicious source documents, confused task targeting, accidental scope expansion, duplicate delivery, and failed updates. The host OS, installed provider runtimes, operator, and local administrator are trusted. Same-user malware or a hostile unrestricted agent is not contained by an application-level policy. State that limitation in deployment documentation; do not describe logical allowlists as a complete OS sandbox.

Keep the remote API narrow even on a trusted host. Never expose arbitrary shell, raw provider RPC, arbitrary filesystem browse/write, environment reads, or supervisor configuration editing. Source documents and model outputs are untrusted data. Only authenticated operator actions or valid standing task scope grant authority.

## Device enrollment

On first setup, `ceston pair` creates a random 256-bit, one-use invitation, stores only its hash, and displays a QR/manual code in the local interactive console. Expire it in 10 minutes and invalidate it after redemption. Do not write it to logs, browser history, or a query string; use a URL fragment consumed into a POST and then cleared. First setup binds a new owner device; later pairing requires the local console or an existing authorized device's explicit action.

Issue a random per-device session token in an HttpOnly, SameSite=Strict cookie, Secure outside loopback development. Store only its keyed hash server-side. Use a 7-day idle expiry and 30-day absolute expiry; renewal requires an active authorized session before absolute expiry, otherwise re-pair. Show device name and last seen time, and allow immediate revocation. Test pairing races so one token cannot enroll two devices.

For cookie writes require a per-session CSRF token plus exact allowed Origin and Host checks. SameSite alone is not the entire CSRF defense. Disable cross-origin API CORS by default. Validate proxy headers only from the configured loopback proxy. Reject DNS rebinding/host-header variants. Rate-limit pairing to five failed attempts per 15 minutes per source and installation, and authenticated command creation to 60/minute per device with a clear retry response.

Cloudflare Access is an optional additional gate. If enabled, validate issuer, audience, signature using trusted JWKS, expiry, and the configured owner allowlist server-side. Do not trust an email header alone or reuse another app's audience. A tunnel is transport, not authentication. No tunnel is provisioned by these specs.

## Authority records

Every task has immutable scope revisions containing permitted operation classes, registered roots, resource locks, provider profile, caps, and completion boundary. The authority source is a direct user command or an operator-accepted standing policy reference. Retain the exact request hash and human-readable interpretation.

Model-generated intents can propose scope but cannot grant it. Project instructions can narrow execution and supply existing authority; they cannot override a more restrictive active request. Source content cannot become an instruction to change credentials, policies, recipients, repository targets, or deployment scope.

An external action approval includes exact target identity, current value/hash, proposed value/hash, associations and effects, expiry, and read-back procedure. Freeze it before asking. Changes to the prepared action invalidate approval. Before execution, re-read current state and reject drift. Record outcome as verified, failed, or uncertain; never retry an uncertain external write without reconciliation.

## Execution controls

The broker checks task scope before each supported operation and before dispatching provider work. Use provider-native sandbox and tool policies where available, with tests showing the intended denial. Filesystem tools accept registered roots and resolve symlinks/junctions before use. External writes route through explicit adapters with structured inputs and deterministic authority checks. Unknown tools default to denied.

Do not claim to parse arbitrary shell text safely. Prefer structured `execFile` argument arrays and named tool recipes for test/build operations. Treat project build scripts as executable code; they can have external side effects. The operator's registered project profile explicitly authorizes known scripts and network policy. Run self-update and public demo tests in isolated roots with no operational credentials. Block managed write capability if the selected provider cannot honor its declared control profile; offer observe-only or an explicitly labelled trusted unrestricted profile requiring separate operator scope.

An unrestricted profile is not eligible for automatic self-update activation or silent external approvals. The application can provide workflow safety but cannot prevent all same-user OS actions by an unrestricted provider. Never weaken a permission setting globally to fix one task.

## Protected data

Keep credentials in provider-supported stores or the operator's configured secret store, outside source and release bundles. Read them only in the backend that needs them. Build child environments from an allowlist; do not inherit all secrets from the coordinator. Keep speech, push, and source connector credentials separate from coding provider credentials.

Serve only sanitized summaries and explicit evidence to authenticated devices. Render Markdown with raw HTML disabled; sanitize links; use a restrictive CSP with no third-party scripts; never execute uploaded HTML. Downloads use opaque evidence IDs and validated paths. Limit uploads by size, actual content type, archive expansion, and parser timeout. Version 1 accepts plain text, Markdown, and PDF text extraction in a bounded worker; reject executables and archives. Paste URLs as references unless a later connector defines SSRF-safe fetching.

Logs contain request IDs, operation classes, durations, result codes, and hashes, not messages, tokens, audio, raw provider output, or full local paths. Debug capture is explicit, local, bounded, and excluded from Git. Test redaction with synthetic secrets. Encrypt push subscription secrets and private backups using the configured OS protection facility; document portability and recovery limits.

## Self-update authority

A direct request to improve cestOn authorizes the requested local source change, tests, compilation, and eligible local activation. The assistant records that interpretation before starting. Do not ask again at each stage. A vague report without desired behavior may need one clarification, but a clear imperative fix is sufficient.

The grant does not include publishing a new public release, pushing a repository, changing another product, widening tool permissions, disabling checks, migrating credentials, or replacing the supervisor. Protected changes become a concrete proposal requiring authority for that changed scope. The exact eligibility checks and rollback rules are in `07-self-improvement.md`.

## Required security tests

Exercise unauthorized reads/writes/SSE, expired/replayed pairing, revoked devices, CSRF, origin/host spoofing, path traversal including Windows junctions, oversized uploads, Markdown/script injection, synthetic secret redaction, forged provider completion, stale action approval, and source-prompt injection. A source document saying “publish now” must remain source content. Failure of any authentication, scope, update-integrity, or wrong-target test blocks activation and public-release readiness.
