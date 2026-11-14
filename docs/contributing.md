# Contributing

Read the self-contained root `AGENTS.md`, README, specification entry point and implementation ledger. The specifications own behavior; design HTML is illustrative. Never edit historical private references. Keep changes scoped to the owning contract and use synthetic marked data roots.

Use the pinned runtime and lockfile. Installation can suppress dependency lifecycle scripts with `npm ci --ignore-scripts`; verify the distributed `better-sqlite3` addon with `node scripts/check-native.mjs` before tests. Browser verification uses the locked Playwright dependency and its Chromium build. Check [setup](setup.md) for the exact commands.

Add a failing behavior test for substantive domain changes. Run the affected suite, types and lint, then `npm run verify`, security and update checks. UI changes require desktop/phone browser checks in both themes. Actual microphone, installed PWA, push and native-provider evidence stay separate from fixtures. Include commands, results, cleanup and unresolved gates in the implementation ledger.

`npm run check:export` inspects the public allowlist and reachable Git blobs for private paths, common credential patterns and personal home paths. It prints paths and issue codes, never matched secret bytes. `npm run test:clean-export` copies only the public source, installs dependencies into a disposable checkout with an empty home, loads the distributed SQLite binary and runs all local gates. It is deliberately separate from routine verification to avoid recursion. Pattern scans supplement review and cannot recognize every secret format.

CI runs on a disposable Windows runner with read-only repository access, no persisted Git credential, no provider secrets and no deployment or artifact publication. Pull requests never use operator homes or schedules. A local passing run does not prove a remote CI run passed; inspect that run separately.

Do not weaken authentication, task scope, command idempotency, native isolation, mandatory tests or the independent update policy to make a gate pass. Unexpected external outcomes require reconciliation. Documentation changes belong in their focused owner, with the root README limited to actual setup, architecture and usage.

The source currently declares `UNLICENSED`. Do not infer an application license from dependency licenses or publish a package until the owner selects one. Report security concerns privately through a channel agreed with the repository owner; never attach private state or credentials to public issues.
