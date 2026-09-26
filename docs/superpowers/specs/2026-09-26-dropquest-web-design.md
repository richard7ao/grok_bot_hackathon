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

One Bun process, `server.ts`: static files + JSON API + `bun:sqlite` (`dropquest.db`) + clips in `uploads/`. Seeded single demo user, no auth. `XAI_API_KEY` in gitignored `.env`.

Files: `server.ts`, `db.ts` (schema, seed, hold/checkout logic), `review.ts` (xAI call), `public/index.html`, `public/app.js`, `public/dashboard.html`, `public/dashboard.js`, `server.test.ts`.

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

## T1 — DropQuest web slice

**Description:** Full vertical slice: map → record → Grok review → hold → share → buy → dashboard.

### T1.1 — Backend

**Description:** Server, DB, hold and checkout logic, review.

#### T1.1.1 — DB + hold/checkout logic + API skeleton

**Description:** `db.ts`, `server.ts` (all routes except review wiring), seed, `server.test.ts`.

**Verify:**

```bash
# tier1_build
bun build server.ts --target=bun --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files; pass = no issues or all fixed
```

```bash
# tier3_unit
bun test   # last unit: 2 concurrent claims → exactly 1 hold; buy before posted → 409; expired hold frees stock; 4th attempt rejected
```

```bash
# tier4_integration
bun server.ts & sleep 1; curl -sf localhost:3000/api/drops | grep -q '"available"'; curl -sf localhost:3000/api/dashboard >/dev/null; kill %1
```

#### T1.1.2 — xAI review

**Description:** `review.ts`, wired into POST attempts.
**Requires:** T1.1.1

**Verify:**

```bash
# tier1_build
bun build server.ts --target=bun --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files
```

```bash
# tier3_unit
bun test   # parser: valid JSON → verdict; garbage/timeout → 'error'; duration out of range rejected before model call
```

```bash
# tier4_integration
bun server.ts & sleep 1; curl -sf -F video=@fixtures/pass.mp4 -F transcript="$(cat fixtures/pass.txt)" -F frame0=@fixtures/f0.jpg -F debug=1 localhost:3000/api/drops/1/attempts | grep -q '"verdict"'; kill %1
```

### T1.2 — Customer web app

#### T1.2.1 — Map + drop sheet + location

**Description:** `public/index.html`, `public/app.js` map screen.
**Requires:** T1.1.1

**Verify:**

```bash
# tier1_build
bun build public/app.js --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files
```

```bash
# tier3_unit
bun test   # haversine helper: venue point inside radius, 1 km away outside
```

```bash
# tier4_integration
# manual in Chrome: pins render, distance gate blocks, debug toggle unlocks
```

#### T1.2.2 — Record + transcript + frames + review UI

**Requires:** T1.1.2, T1.2.1

**Verify:**

```bash
# tier1_build
bun build public/app.js --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files
```

```bash
# tier3_unit
# no pure logic added; browser media APIs covered by tier4
```

```bash
# tier4_integration
# manual in Chrome: record 15 s → transcript non-empty → retry clip gets feedback → pass clip gets hold
```

#### T1.2.3 — Hold timer, share, "I posted", buy, done card

**Requires:** T1.2.2

**Verify:**

```bash
# tier1_build
bun build public/app.js --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files
```

```bash
# tier3_unit
bun test   # buy gate already covered in T1.1.1
```

```bash
# tier4_integration
# manual: download clip, upload to Instagram web, tap I posted, buy → purchased; reload keeps timer
```

### T1.3 — Dashboard

#### T1.3.1 — Merchant dashboard

**Requires:** T1.1.1

**Verify:**

```bash
# tier1_build
bun build public/dashboard.js --outdir=/tmp/dq-build
```

```bash
# tier2_simplify
# code-simplifier agent on changed files
```

```bash
# tier3_unit
bun test   # /api/dashboard counts match seeded reservations
```

```bash
# tier4_integration
# manual: run the full flow, dashboard stock/funnel/log update within 3 s
```

## Stretch (only if everything above is done by 15:30)

Grok Bot as Drop Director (writes the prompt and rubric via POST) and review auditor. Real Stripe test checkout.
