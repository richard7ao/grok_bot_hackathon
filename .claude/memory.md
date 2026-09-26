## Decisions

- [2026-09-26] Build is a localhost web app (Chrome + webcam), not native iOS; user chose speed over the brief's native requirement.
- [2026-09-26] Review uses the xAI chat API (grok-4.7) directly; Grok Bot roles are stretch only.
- [2026-09-26] Instagram posting is an honor-system "I posted" tap; checkout is simulated. Both labelled in UI and dashboard.
- [2026-09-26] User decision: skip Tier 2 (simplify) and Tier 3 (unit) for this build; every stage keeps Tier 1 build + Tier 4 integration.
- [2026-09-26] Repo split backend/ (feat/backend) and web/ (feat/frontend); contracts/, docs/ and this file change only on main, so the branches never conflict. This overrides the global "commit memory.md per stage" step; branch discoveries go in commit bodies and are copied here after merge.

## Patterns

- [2026-09-26] web/dev.ts serves contracts/fixtures when API_URL is unset, so the UI never waits on the backend. Tests assert backend responses match fixture keys.

## Gotchas

- [2026-09-26] Bun was not installed on this Mac (installed 1.4.2 to ~/.bun/bin); node shim is broken (_load_nvm). Xcode is not installed.

## Open Questions

- [2026-09-26] Real venue coordinates for VENUE_LAT/VENUE_LNG.
- [2026-09-26] Does Instagram web upload accept the Chrome MediaRecorder output (mp4 vs webm)? Check in T2.3.1.
