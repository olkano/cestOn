# cestOn

cestOn is a planned, self-hosted assistant for coordinating coding and operational agents from a desktop or phone. It brings tasks, decisions, progress, voice interaction, and requested improvements to cestOn itself into one workspace.

**Current state:** specifications and interactive design only. There is no running application, installer, provider connection, or application release. This repository publishes the specification and design baseline.

## Start here

- [Implementation entry point](zz_Specifications/00-start-here.md): reading order, scope, authority, and completion rules.
- [Product contract](zz_Specifications/01-product.md): what cestOn must do.
- [Interactive experience](design/cestOn-experience.html): desktop and mobile examples, dark and light themes, and self-improvement.
- [Implementation phases](zz_Specifications/08-implementation-phases.md) and [acceptance tests](zz_Specifications/09-acceptance-tests.md).
- [Implementation ledger](zz_Specifications/implementation-status.md): starts with every phase pending.

## Product and repository boundaries

The public source home is [olkano/cestOn](https://github.com/olkano/cestOn), alongside `olkano/cestDone` in the Olkano GitHub organization. cestOn does not belong inside the Olkano safety app monorepo.

cestOn owns the UI, task database, authorization, durable command routing, provider adapters, and its local update workflow. cestDone remains an optional batch execution backend. Use its explicit integration contract rather than importing its private source or connecting to its operational scheduler. See [architecture](zz_Specifications/02-architecture.md) and [adapters](zz_Specifications/04-provider-adapters.md).

The first release targets a Windows host running under its owner's identity, a desktop browser, and installable mobile web apps. Work continues on the host while the phone is closed. The host must be awake and connected. Native wrappers are an extension, not a prerequisite for a phone icon.

No customer account, repository, workspace path, or credential is built into the product. Operators register their own projects and providers. There is no direct ITM Platform integration in this release; registered projects are generic workspaces.

## Design assets and prior work

[The supplied icon](assets/cestOn-icon.svg) is the canonical source. Use the product name `cestOn` and refer to its conversational interface as “the assistant.” Do not use Companion as current branding.

The original requirements, exploration, and first mockup have been moved unchanged into `zz_Specifications/reference-private/`. They contain personal environment details and are intentionally ignored by Git. The new specifications are authoritative; the historical exploration is context, not an execution plan. Those local originals are not part of a public package.

## Development

Read `AGENTS.md`, then the implementation entry point. Build and setup commands in the specs are contracts to implement, not commands that exist today. Phase 0 creates the runnable scaffold and lockfile. Keep this README accurate as commands become available.

Public release, package publication, tunnel provisioning, and app-store submission remain distinct operations. The release checklist describes their prerequisites; writing these specifications performs none of them.
