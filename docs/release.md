# Prepare a release

Run `npm run check:export`, inspect the actual public file inventory and reachable-history scan, then run `npm run test:clean-export`. Check that source/setup has no sibling dependency, private references, provider homes, state, credentials or personal paths. Review any pattern findings without printing their matched content. Pattern coverage alone is not a secret audit.

Run `npm run package:local` from the reviewed source. It verifies all local gates, records source commit and content hash, preserves the pinned production dependency tree and license files, independently verifies every manifest entry, writes a ZIP and reads back each archived file hash. Check its `.sha256`, dependency notices and support matrix. Reproducible static assets and compiled bytes do not imply byte-identical ZIPs across requests: request IDs and manifest timestamps are deliberate provenance.

Run `npm exec -- tsx scripts/rehearse-package.ts BUNDLE` to exercise a new disposable owner-only installation, packaged API/broker canary, stable supervisor, read-back, startup plan and owned removal. Run `npm run test:self-update:fixture` separately for actual success, failure, protected-change and health-rollback scenarios; it performs isolated activations, never persistent operator installation. Live-provider and physical-device gates remain separate.

Before distribution, the owner must choose the application license, review third-party notices and confirm repository/package names again. Registry availability is time-sensitive and does not reserve a name. Keep package `private: true` and `UNLICENSED` until that decision. External executable use does not authorize redistribution of provider runtimes or cestDone source.

Publishing a signed application release, uploading archives, changing repository visibility, configuring a tunnel or registering a persistent pilot requires its own explicit target and authority. CI generates a local bundle on its disposable runner without uploading it. A source push is recorded separately from application publication.
