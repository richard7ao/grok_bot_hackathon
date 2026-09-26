# API contract (frozen on `main`)

Backend (`backend/`, port 3000) implements it. Web (`web/`, port 5173) consumes it through `web/dev.ts`, which proxies `/api/*` and `/uploads/*` to `API_URL`, or serves `fixtures/` when `API_URL` is unset.

**Ownership, so branches never conflict:**
- `feat/backend` touches only `backend/`.
- `feat/frontend` touches only `web/`.
- `contracts/`, `docs/`, root files change only on `main`. Then both branches `git rebase main`.

Times are ISO-8601 UTC strings. Money is integer pence. Image paths are served by the web origin.

## Types

```ts
type Drop = { id: number; title: string; status: "live" | "preview"; price_pence: number;
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
type ErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "DROP_NOT_LIVE" | "OUTSIDE_ZONE" | "BAD_DURATION"
  | "ATTEMPTS_EXHAUSTED" | "ALREADY_RESERVED" | "HOLD_EXPIRED" | "BAD_STATE" | "TOO_LARGE" | "INTERNAL";
```

## Routes

| Method, path | Request | 200 response | Errors |
| --- | --- | --- | --- |
| GET /api/drops | — | `{ server_time, drops: Drop[] }` | — |
| GET /api/drops/:id/state | — | `{ attempts_used, max_attempts, reservation: Reservation \| null }` | 404 |
| POST /api/drops/:id/attempts | multipart: `video` (file), `frame0..frame3` (jpeg), `transcript`, `duration_ms`, `lat`, `lng`, `debug` ("1"/"0") | `{ attempt: Attempt, reservation: Reservation \| null, error: null \| "NO_STOCK" \| "ALREADY_RESERVED" }` | 400 BAD_REQUEST, 403 OUTSIDE_ZONE, 409 DROP_NOT_LIVE / ATTEMPTS_EXHAUSTED / ALREADY_RESERVED, 413 TOO_LARGE, 422 BAD_DURATION |
| GET /api/reservations/:id | — | `Reservation` | 404 |
| POST /api/reservations/:id/posted | — | `Reservation` (status posted, expires_at = now + 5 min) | 409 HOLD_EXPIRED / BAD_STATE |
| POST /api/reservations/:id/buy | — | `Reservation` (status purchased) | 409 HOLD_EXPIRED / BAD_STATE |
| GET /api/dashboard | — | `{ stock: {total, held, posted, sold, available}, funnel: {attempts, passed, held, posted, purchased}, events: {at, type, detail}[] }` | — |
| POST /api/demo/reset | optional JSON `{ allocation_total }` | `{ ok: true }` | — |
| GET /uploads/:file | — | video bytes | 404 |

Rules: max 3 counted attempts per drop (`error` verdicts do not count); duration 10000–20000 ms; video ≤ 50 MB; hold 10 min; purchase window 5 min; one active reservation per drop (single demo user).
