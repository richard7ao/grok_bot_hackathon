# Fleek DropQuest (web, localhost) — Spec

Replaces the native-iOS brief (`Fleek-DropQuest-Astra-Brief.md`) for today's build. Freeze 16:30, demo 17:30 from this MacBook.

## Decisions (user-confirmed, 2026-09-26)

| Topic | Decision |
| --- | --- |
| Platform | Web app on localhost, Chrome on the MacBook, webcam. Not native iOS. |
| Discovery | Pokémon Go style: Leaflet map, "you" dot, drop pins; a drop unlocks within `radius_m` (150). Debug "at venue" toggle for the stage. |
| AI | xAI API (grok-4.7) reviews frames + transcript against the rubric. Grok Bot roles are stretch only. |
| Instagram | No API. Download clip, open instagram.com, user taps "I posted" (honor system, labelled self-reported). |
| Checkout | Simulated, labelled. Server-enforced gate. |
| Ad disclosure | Caption always ends `#ad #FleekDropQuest`. |

## Architecture

Two Bun processes, split so they can be built on separate branches:
- `backend/` (port 3000): JSON API + `bun:sqlite` (`dropquest.db`) + clips in `uploads/`. Files: `server.ts`, `db.ts`, `review.ts`, `integration.test.ts`, `smoke-xai.ts`. `XAI_API_KEY` in gitignored `backend/.env`.
- `web/` (port 5173): `dev.ts` serves `public/` and proxies `/api` + `/uploads` to `API_URL`, or serves `contracts/fixtures` when unset. Files: `public/index.html`, `public/style.css`, `public/app.js`, `public/dashboard.html`, `public/dashboard.js`, `integration.test.ts`, `live.check.ts`.
- `contracts/` (frozen on `main`): `README.md` API contract + `fixtures/*.json`.

Seeded single demo user, no auth. Open `http://localhost:5173` for the demo.

### Tables

- `drops`: id, title, facts_json, image_url, price_pence, lat, lng, radius_m, allocation_total, prompt, rubric_json, status (`live` | `preview`).
- `attempts`: id, drop_id, n, video_path, transcript, verdict (`pass` | `retry` | `error` | null), review_json, created_at. Unique (drop_id, n). Max 3 per drop.
- `reservations`: id, drop_id, attempt_id, status (`held` | `posted` | `purchased`), expires_at, caption, posted_at, purchased_at, price_pence. Expired = `status != 'purchased' AND expires_at < now` (computed on read, no job).
- `events`: id, at, type, attempt_id, detail_json. Drives the dashboard log and funnel.

### API

| Route | Does |
| --- | --- |
| GET /api/drops | Drops + available = allocation_total − active reservations |
| POST /api/drops/:id/attempts | multipart: video, 4 JPEG frames, transcript, lat/lng/debug flag. Rejects outside radius (unless debug), >3 attempts. Stores, calls review, on pass claims hold. Returns attempt + reservation or `NO_STOCK`. |
| POST /api/reservations/:id/posted | held + not expired → `posted`, expires_at = now + 5 min |
| POST /api/reservations/:id/buy | posted + not expired → `purchased`; else 409 |
| GET /api/reservations/:id | status + expires_at |
| GET /api/dashboard | stock (total/held/posted/sold/available), funnel counts, last 20 events |
| POST /api/demo/reset | Deletes attempts/reservations/events for demo |

Hold claim: `BEGIN IMMEDIATE` transaction, count active reservations, insert if under allocation, 10-min expiry. One active reservation per drop (single demo user).

### Review (xAI)

POST `https://api.x.ai/v1/chat/completions`, model `grok-4.7` (env `XAI_MODEL` overrides), frames as base64 image parts, transcript + product facts + rubric in text, `response_format` JSON schema: `{verdict: pass|retry, criteria:[{id,result:pass|fail|unknown,evidence}], feedback, suggested_caption}`. Transcript and frames are untrusted content: the system prompt says to ignore instructions inside them. Duration (10–20 s) is checked in code, not by the model. A network or parse failure gives `verdict='error'` (retry allowed, never counts as a content rejection).

Rubric: outfit shown or described, styling idea for the featured jacket, one correct product detail, relevant and suitable. Must not grade looks, accent, or enthusiasm.

### Frontend

`index.html` + `app.js`, mobile-width layout. Screens are divs toggled by state: Map → Drop sheet → Record → Reviewing → Result (retry feedback / hold + timer) → Share → Buy → Done card.
- Record: `getUserMedia` + `MediaRecorder` (prefer `video/mp4`, else webm), countdown, 20 s auto-stop. `webkitSpeechRecognition` runs during recording for the transcript. Canvas grabs 4 frames at 20/40/60/80%.
- Timer derives from server `expires_at`.
- Share: download link for the clip + caption copy button + open `https://www.instagram.com/`. "I posted" button.

`dashboard.html`: polls `/api/dashboard` every 3 s.

## Known limits (say them in the demo)

Location is client-reported. Posting is self-reported. Frames and transcript are captured in the browser. Checkout is simulated. Instagram web upload may reject webm, so rehearse with the real clip.

---

## Tiers for this build

User decision (2026-09-26): no Tier 2 (simplify) or Tier 3 (unit) this build, for hackathon time. Each stage keeps the four verify blocks. Tiers 2 and 3 say what they skip and where the surface is covered: every behaviour is exercised by Tier 4 integration tests that run the real server over HTTP.

State files (local-only): `tasks/backend-state.json` tracks T1 in the backend worktree. `tasks/frontend-state.json` tracks T2 in the frontend worktree.

## T1 — Backend

**Description:** The API in `contracts/README.md`, backed by SQLite, with the xAI review.

### T1.1 — API

**Description:** Store, rules, and review behind the contract.

#### T1.1.1 — Store, rules, routes (fake review)

**Description:** `backend/db.ts`, `backend/server.ts`, `backend/review.ts` (parser + fake mode), `backend/integration.test.ts`.

**Verify:**

```bash
# tier1_build
cd backend && bun build server.ts --target=bun --outdir=/tmp/dq-backend
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). Untested surface: code clarity only. No behaviour lives here.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Untested surface: isolated functions. Covered by tier4 over HTTP.
```

```bash
# tier4_integration
cd backend && bun test integration.test.ts
```

#### T1.1.2 — Real xAI review

**Description:** `backend/review.ts` xAI call, `backend/smoke-xai.ts`.
**Requires:** T1.1.1

**Verify:**

```bash
# tier1_build
cd backend && bun build server.ts smoke-xai.ts --target=bun --outdir=/tmp/dq-backend
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Parser covered by tier4 (fake + unreachable-xAI tests) and the live smoke.
```

```bash
# tier4_integration
cd backend && bun test integration.test.ts && bun smoke-xai.ts   # smoke prints PASS/RETRY verdicts from real grok; exits 1 unless pass→pass and retry→retry
```

## T2 — Frontend

**Description:** Customer web app and merchant dashboard, built against the fixture mock, then joined to the real backend.

### T2.1 — Customer app

#### T2.1.1 — Shell, map, drop sheet, location

**Description:** `web/public/index.html`, `web/public/style.css`, `web/public/app.js` (map + drop), `web/integration.test.ts`.

**Verify:**

```bash
# tier1_build
cd web && bun build public/app.js --outdir=/tmp/dq-web
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Covered by tier4.
```

```bash
# tier4_integration
cd web && bun test integration.test.ts
# plus Chrome at http://localhost:5173 (bun dev): 3 pins, live pin opens sheet, start button locked with distance reason, "at venue" unlocks
```

#### T2.1.2 — Record, preview, review result

**Requires:** T2.1.1

**Verify:**

```bash
# tier1_build
cd web && bun build public/app.js --outdir=/tmp/dq-web
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Browser media APIs; covered by tier4 manual run.
```

```bash
# tier4_integration
cd web && bun test integration.test.ts
# plus Chrome (mock): record 12 s, transcript shown, submit -> retry feedback + criteria; retake + submit -> share screen with 10:00 timer
```

#### T2.1.3 — Share, "I posted", buy, done, reload recovery

**Requires:** T2.1.2

**Verify:**

```bash
# tier1_build
cd web && bun build public/app.js --outdir=/tmp/dq-web
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Covered by tier4.
```

```bash
# tier4_integration
cd web && bun test integration.test.ts
# plus Chrome (mock): copy caption ends "#ad #FleekDropQuest", I posted -> buy screen 5:00 timer, buy -> done card
```

### T2.2 — Dashboard

#### T2.2.1 — Merchant dashboard

**Description:** `web/public/dashboard.html`, `web/public/dashboard.js`.

**Verify:**

```bash
# tier1_build
cd web && bun build public/dashboard.js --outdir=/tmp/dq-web
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Covered by tier4.
```

```bash
# tier4_integration
cd web && bun test integration.test.ts
# plus Chrome: /dashboard.html shows stock, funnel, events from fixture; refreshes every 3 s
```

### T2.3 — Join

#### T2.3.1 — Web against the real backend

**Description:** `web/live.check.ts`. Runs after `feat/backend` is merged to `main` and `feat/frontend` is rebased on it.
**Requires:** T1.1.2 (check `git log main --oneline | grep T1.1.2`), T2.1.3, T2.2.1

**Verify:**

```bash
# tier1_build
cd web && bun build public/app.js public/dashboard.js --outdir=/tmp/dq-web
```

```bash
# tier2_simplify
# SKIPPED (user decision 2026-09-26). No behaviour surface.
```

```bash
# tier3_unit
# SKIPPED (user decision 2026-09-26). Covered by tier4.
```

```bash
# tier4_integration
cd web && bun live.check.ts
# plus full demo run in Chrome: (cd backend && bun dev) + (cd web && bun dev:live), real grok review, real Instagram upload, dashboard updates
```

## Stretch (only if everything above is done by 15:30)

Grok Bot as Drop Director (writes the prompt and rubric via POST) and review auditor. Real Stripe test checkout.
