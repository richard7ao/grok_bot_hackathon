# API contract (frozen on `main`)

Backend (`backend/`, port 3000) implements it. Web (`web/`, port 5173) consumes it through `web/dev.ts`, which proxies `/api/*` and `/uploads/*` to `API_URL`, or serves `fixtures/` when `API_URL` is unset.

**Ownership, so branches never conflict:**
- `feat/backend` touches only `backend/`.
- `feat/frontend` touches only `web/`.
- `contracts/`, `docs/`, root files change only on `main`. Then both branches `git rebase main`.

Times are ISO-8601 UTC strings. Money is integer pence. Image paths are served by the web origin.

## Types

```ts
type Drop = { id: number; brand: string; title: string; description: string;
  status: "live" | "preview" | "draft" | "ended"; price_pence: number; hold_minutes: number; public_launch_at: string;
  image_url: string; lat: number; lng: number; radius_m: number; prompt: string;
  facts: string[]; rubric: { id: string; label: string }[];
  allocation_total: number; available: number };

type Criterion = { id: string; result: "pass" | "fail" | "unknown"; evidence: string };

type Attempt = { id: number; n: number; verdict: "pass" | "retry" | "error";
  criteria: Criterion[]; feedback: string; suggested_caption: string | null };

// "expired" is computed: status not purchased and expires_at <= now
type Reservation = { id: number; drop_id: number; attempt_id: number;
  status: "held" | "posted" | "purchased" | "expired"; expires_at: string;
  caption: string; price_pence: number; video_url: string };

type ApiError = { error: ErrorCode; message: string };
// Merchant campaign input (create = all fields required; PATCH = any subset)
type CampaignInput = { brand: string; title: string; description: string; price_pence: number;
  allocation_total: number; image_url: string; lat: number; lng: number; radius_m: number;
  hold_minutes: number; prompt: string; facts: string[]; rubric: { id: string; label: string }[];
  status: "live" | "preview" | "draft" | "ended"; public_launch_at: string };
type Stats = { attempts: number; passed: number; held: number; posted: number; sold: number };
type Review = { attempt_id: number; n: number; verdict: "pass" | "retry" | "error" | null;
  feedback: string; transcript: string; created_at: string; video_url: string };

type ErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "DROP_NOT_LIVE" | "BAD_DURATION"
  | "ATTEMPTS_EXHAUSTED" | "ALREADY_RESERVED" | "HOLD_EXPIRED" | "BAD_STATE" | "TOO_LARGE" | "INTERNAL";
```

## Routes

| Method, path | Request | 200 response | Errors |
| --- | --- | --- | --- |
| GET /api/drops | — | `{ server_time, drops: Drop[] }` (live + preview only; drafts and ended hidden) | — |
| GET /api/drops/:id/state | — | `{ attempts_used, max_attempts, reservation: Reservation \| null }` | 404 |
| POST /api/drops/:id/attempts | multipart: `video` (file), `frame0..frame3` (jpeg), `transcript`, `duration_ms` (no location check: any `lat`/`lng`/`debug` fields are ignored) | `{ attempt: Attempt, reservation: Reservation \| null, error: null \| "NO_STOCK" \| "ALREADY_RESERVED" }` | 400 BAD_REQUEST, 409 DROP_NOT_LIVE / ATTEMPTS_EXHAUSTED / ALREADY_RESERVED, 413 TOO_LARGE, 422 BAD_DURATION |
| POST /api/attempts/:id/approve | — (demo only; enabled only when `DEMO_MODE=1`) | same as POST /api/drops/:id/attempts: the latest `retry`/`error` attempt becomes `pass` and a hold is claimed | 404 NOT_FOUND (no attempt, or `DEMO_MODE` is not `1`), 409 BAD_STATE (not the latest attempt, or already pass) |
| GET /api/reservations/:id | — | `Reservation` | 404 |
| POST /api/reservations/:id/posted | — | `Reservation` (status posted, expires_at = now + 5 min) | 409 HOLD_EXPIRED / BAD_STATE |
| POST /api/reservations/:id/buy | — | `Reservation` (status purchased) | 409 HOLD_EXPIRED / BAD_STATE |
| GET /api/dashboard | — | `{ stock: {total, held, posted, sold, available}, funnel: {attempts, passed, held, posted, purchased}, events: {at, type, detail}[] }` | — |
| POST /api/demo/reset | optional JSON `{ allocation_total }` | `{ ok: true }` | — |
| GET /api/campaigns | — | `{ campaigns: (Drop & { stats: Stats })[] }` (all statuses, newest first) | — |
| GET /api/campaigns/:id | — | `{ campaign: Drop, stats: Stats, reviews: Review[], events }` | 404 |
| POST /api/campaigns | JSON `CampaignInput` | 201 `Drop` | 400 BAD_REQUEST (message names the field) |
| PATCH /api/campaigns/:id | JSON partial `CampaignInput` | `Drop` | 400, 404 |
| POST /api/campaigns/draft | JSON `{ brand, title, description, facts? }` | `{ prompt, facts: string[], rubric: {id,label}[] }` written by the LLM | 400; 502 INTERNAL if the model fails |
| GET /uploads/:file | — | video bytes | 404 |

Image options for `image_url`: `/img/birkin.svg`, `/img/baguette.svg`, `/img/flats.svg`, `/img/jacket.svg`, `/img/shell.svg`, `/img/sneaker.svg`, `/img/shirt.svg`, and the photos `/img/photos/{birkin,arcteryx,carhartt,xt6,stoneisland,football,baguette,flats}.jpg` (Unsplash/Pexels, see `web/public/img/photos/CREDITS.md`). Hold length per drop is `hold_minutes` (env `HOLD_MS` overrides it for tests).

Rules: max 3 counted attempts per drop (`error` verdicts do not count); duration 10000–20000 ms; video ≤ 50 MB; hold 10 min; purchase window 5 min; one active reservation per drop (single demo user). Several drops can be live at once, each at its own location; `VENUE_LAT`/`VENUE_LNG` move drop 1 only.

## v3 — scored takes and merchant approval

The model **scores** every take; it no longer decides pass/fail on its own. The merchant approves takes in Studio, highest score first. A campaign can switch on **auto-review**, where the scores are checked against the merchant's thresholds instead.

```ts
type Metric = "outfit" | "styling" | "product_detail" | "energy" | "quality";
type Scores = Record<Metric, number>;            // each 0–10
type ReviewSettings = { auto_review: boolean;     // default false
  thresholds: Scores;                             // minimum per metric, 0 (lenient) – 10 (brutal); default 6 each
  scoring_prompt: string };                       // merchant's extra scoring instructions, ≤ 1000 chars, default ""

// Attempt gains (Review items in campaign detail gain the same fields):
//   verdict: "pending" | "pass" | "retry" | "error"
//   score: number | null   (0–100 overall)
//   scores: Scores | null
//   rank: number | null    (1 = highest-scoring pending take in this campaign; null unless pending)
```

Flow for `POST /api/drops/:id/attempts` (response shape unchanged: `{ attempt, reservation, error }`):
- The model returns `scores`, `score`, `criteria` and `feedback`. Transcript and frames stay untrusted input.
- `auto_review` off: `verdict: "pending"`, `reservation: null`. No stock is held until the merchant approves.
- `auto_review` on: `pass` (and a hold is claimed) when every metric meets its threshold; otherwise `retry` with feedback.
- `error` is unchanged (model failure; doesn't count as an attempt). A pending take counts as an attempt.
- Demo skip (`demo_pass=1`) and `POST /api/attempts/:id/approve` jump straight to `pass` with a hold, only when `DEMO_MODE=1`; otherwise `demo_pass` is ignored and approve returns 404.

| Method, path | Request | 200 response | Errors |
| --- | --- | --- | --- |
| GET /api/attempts/:id | — | `{ attempt: Attempt, reservation: Reservation \| null }` (customer polls this while pending) | 404 |
| POST /api/campaigns/:id/decisions | JSON `{ attempt_id, decision: "approve" \| "reject", note? }` | `{ attempt, reservation, error }`. Approve claims a hold (`error` may be `NO_STOCK` / `ALREADY_RESERVED`); reject sets `retry`, with `feedback` = note or a default | 400, 404, 409 BAD_STATE (not pending) |
| GET /api/campaigns/:id | — | as before, plus `campaign.review: ReviewSettings`. `reviews` lists pending takes by score (highest first), then the rest newest first | 404 |
| PATCH /api/campaigns/:id | as before, plus optional `review: Partial<ReviewSettings>` | `Drop` | 400 |
