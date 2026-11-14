# cestOn

cestOn is a self-hosted assistant in development for coordinating coding and operational agents from a desktop or phone. It brings tasks, decisions, progress, voice interaction, and requested improvements to cestOn itself into one workspace.

**Current state:** durable tasks, bounded scheduling, separate broker and supervisor, authenticated device access, desktop/phone PWA, voice/notification contracts and requested local updates are implemented and locally fixture-tested. Native provider certification and physical-device/operational acceptance remain blocked. No persistent pilot or application package release is active.

## Start here

- [Start using cestOn](docs/getting-started.md): launch the demo, try your first task, and prepare for your own projects.
- [Implementation entry point](zz_Specifications/00-start-here.md): reading order, scope, authority, and completion rules.
- [Product contract](zz_Specifications/01-product.md): what cestOn must do.
- [Interactive experience](design/cestOn-experience.html): desktop and mobile examples, dark and light themes, and self-improvement.
- [Implementation phases](zz_Specifications/08-implementation-phases.md) and [acceptance tests](zz_Specifications/09-acceptance-tests.md).
- [Implementation ledger](zz_Specifications/implementation-status.md) and [resume checkpoint](zz_Specifications/implementation-run.md): verified work, remaining gates, and next steps.

## Product and repository boundaries

The public source home is [olkano/cestOn](https://github.com/olkano/cestOn), alongside `olkano/cestDone` in the Olkano GitHub organization. cestOn does not belong inside the Olkano safety app monorepo.

cestOn owns the UI, task database, authorization, durable command routing, provider adapters, and its local update workflow. cestDone remains an optional batch execution backend. Use its explicit integration contract rather than importing its private source or connecting to its operational scheduler. See [architecture](zz_Specifications/02-architecture.md) and [adapters](zz_Specifications/04-provider-adapters.md).

The first release targets a Windows host running under its owner's identity, a desktop browser, and installable mobile web apps. Work continues on the host while the phone is closed. The host must be awake and connected. Native wrappers are an extension, not a prerequisite for a phone icon.

No customer account, repository, workspace path, or credential is built into the product. Operators register their own projects and providers. There is no direct ITM Platform integration in this release; registered projects are generic workspaces.

## Design assets and prior work

[The supplied icon](assets/cestOn-icon.svg) is the canonical source. Use the product name `cestOn` and refer to its conversational interface as “the assistant.” Do not use Companion as current branding.

The original requirements, exploration, and first mockup have been moved unchanged into `zz_Specifications/reference-private/`. They contain personal environment details and are intentionally ignored by Git. The new specifications are authoritative; the historical exploration is context, not an execution plan. Those local originals are not part of a public package.

## Development

Use Node 24 LTS and npm 11. Run `npm ci --ignore-scripts`, verify the distributed addon with `node scripts/check-native.mjs`, then `npx playwright install chromium` once for browser verification. `npm run dev` starts the loopback UI at `http://127.0.0.1:4317` and API at port 4318 in a marked temporary synthetic installation. Use the one-use pairing code printed in its console. It runs a separate fixture broker and registered synthetic artifact check, without connecting a native provider. Stop the process to clean up its owned test data; it does not install persistence.

Run `npm run verify` for typecheck, lint, unit, integration, Chromium E2E, build, and documentation checks. Security and update checks are separate: `npm run test:security` and `npm run test:updates`. All tests use synthetic data. `npm run doctor` reports local runtime readiness without executing provider work.

Use `npm run checkpoint` to inspect resumable implementation state. Read `AGENTS.md` and the [implementation entry point](zz_Specifications/00-start-here.md) before making changes. `npm run package:local` verifies and creates an immutable local bundle with checksums. The [operations guide](docs/operations.md) covers the owner CLI, startup preparation, backup and frozen recovery. Native provider execution and automatic application remain disabled without live certification.

See [setup](docs/setup.md), [support and acceptance boundaries](docs/support-matrix.md), [contributing](docs/contributing.md), and [release preparation](docs/release.md). `npm run check:export` scans the public source/history; `npm run test:clean-export` verifies independent setup. The application remains `UNLICENSED` and private for package distribution pending the owner's license choice. Public source pushes, application publication and persistent activation are tracked separately.
