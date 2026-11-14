# Requirement and verification map

| User requirement / use case | Owning contract | Phase | Required tests |
|---|---|---|---|
| Public standalone product alongside cestDone | 01 product; 10 release | 0, 9 | T01, T36 |
| Local workspace, README, AGENTS, specs, moved originals | Root README; 00 entry; 11 evidence | Documentation delivery | Link, migration hash, Git scope, and private-export checks |
| U01 desktop and phone entry/icon | 05 mobile | 4, 5 | T17, T21, T28 |
| U02 overview of concurrent sessions/tasks | 01 product; 03 state | 1, 2, 4 | T03, T08, T17 |
| U03 context and history | 03 data; 04 adapters | 2, 3, 4 | T08, T14, T18 |
| U04 create task | 03 commands; 06 authority | 1, 3, 4 | T03, T04, T12 |
| U05 instruct running/idle/resumed agents | 04 adapters | 2, 3 | T09, T10 |
| U06 exact decisions | 03 decisions | 1, 3, 4 | T06, T14 |
| U07 multi-phase autonomy | 01 limits; 08 phase 3 | 3 | T12, T13 |
| U08 review and adjustment | 01 journeys; 05 screens | 3, 4 | T12, T17 |
| U09 voice and read aloud | 05 voice | 5 | T22 |
| U10 notifications | 05 notifications | 5 | T23 |
| U11 existing-session discovery/handoff | 04 ownership | 2 | T08, T11 |
| U12 offline/reconnect | 03 SSE; 05 PWA | 4, 5 | T18, T19, T28 |
| U13 priorities/dependencies | 03 state; 02 locks | 1, 3 | T07, T12, T16 |
| U14 support/document intake | 01 scope; 06 data | 3 | T15, T27 |
| U15 pause/stop/resume | 03 state; 04 cancellation | 2, 3 | T09, T16 |
| U16 external-action approval | 06 authority | 3 | T06, T15, T27 |
| U17 blocked/failure recovery | 03 state; 04 errors | 2, 3 | T05, T12, T13 |
| U18 self-improve, build, apply locally | 07 self-improvement | 6, 7 | T29-T35 |
| VS Code-style dark and light | 05 theme | 4 | T17, T20, manual A/B |
| Name and supplied icon | 01 identity; 05 PWA | 0, 4, 5 | T17, T21, T36 |
| Weaker implementer can finish all phases | 00 procedure; 08 phases; status ledger | All | Complete gate evidence and honest blocked prerequisites |
| Manual testing performed by agent where possible | 09 manual A-D | 4-9 | Browser inspection, provider smoke, physical device evidence |
| No duplicate/wrong-target work after crash | 02 recovery; 03 commands | 1-8 | T04-T07, T18, T29-T35 |
| Public distribution excludes personal context | 06 data; 10 release | 9 | T27, T36 |

## Version-1 exclusions, deliberately visible

Native app-store wrapper, shared hosted service, multi-owner collaboration, automatic control of arbitrary live IDE sessions, direct CRM/email/accounting connectors, autonomous public releases, and unrestricted self-modification of the supervisor are outside version 1. The required PWA, generic source intake, supported session handoff, and requested local update workflow cover the current user journeys without claiming those extensions exist.

## Handoff prompt

Use this prompt to start an implementation session after reviewing the specs:

> Implement cestOn from `zz_Specifications/00-start-here.md`. Follow AGENTS.md, execute phases 0-9, run the automated and manual checks available to you, update `implementation-status.md` after each verified phase, and continue without routine phase approvals. Preserve unrelated work. Do not publish, alter operational systems, or activate a persistent pilot unless separately authorized. Record unavailable live-provider or physical-device gates as blocked and complete all independent work. Do not mark required unverified behavior as passed.

To include the local pilot, explicitly add: “Install and activate the verified local cestOn pilot under my user account, including its startup entry and requested-local-update policy; verify the result and rollback.” Remote origin provisioning and public publication need their exact targets separately.
