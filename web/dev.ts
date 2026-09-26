// Web dev server: static files from public/, plus /api and /uploads.
// API_URL set   -> proxy to the real backend.
// API_URL unset -> serve contracts/fixtures (attempts queue as pending; polling passes on the 3rd GET).
const API_URL = process.env.API_URL;
const PORT = Number(process.env.PORT ?? 5173);
const PUBLIC = new URL("./public/", import.meta.url).pathname;
const FIXTURES = new URL("../contracts/fixtures/", import.meta.url).pathname;

let attemptCount = 0;
const polls = new Map<string, number>(); // attempt id -> GETs so far

const fixture = (name: string) => Bun.file(FIXTURES + name).json();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

async function passFor(id: number) {
  const body = await fixture("attempt-pass.json");
  body.attempt.id = body.reservation.attempt_id = id;
  body.reservation.expires_at = inMs(600_000);
  return body;
}

function proxy(req: Request, url: URL): Promise<Response> {
  return fetch(API_URL + url.pathname + url.search, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" ? undefined : req.body,
  });
}

async function mock(req: Request, url: URL): Promise<Response> {
  const { pathname: p } = url;
  const m = req.method;
  if (m === "GET" && p === "/api/drops")
    return Response.json({ ...(await fixture("drops.json")), server_time: new Date().toISOString() });
  if (m === "GET" && /^\/api\/drops\/\d+\/state$/.test(p)) return Response.json(await fixture("drop-state.json"));
  if (m === "POST" && /^\/api\/drops\/\d+\/attempts$/.test(p)) {
    const form = await req.formData();
    await Bun.sleep(1500);
    if (form.get("demo_pass")) return Response.json(await passFor(++attemptCount));
    const body = await fixture("attempt-pending.json");
    body.attempt.id = body.attempt.n = ++attemptCount;
    return Response.json(body);
  }
  const attempt = p.match(/^\/api\/attempts\/(\d+)$/);
  if (m === "GET" && attempt) {
    const n = (polls.get(attempt[1]) ?? 0) + 1;
    polls.set(attempt[1], n);
    if (n > 2) return Response.json(await passFor(Number(attempt[1])));
    const body = await fixture("attempt-pending.json");
    body.attempt.id = Number(attempt[1]);
    return Response.json(body);
  }
  const approve = p.match(/^\/api\/attempts\/(\d+)\/approve$/);
  if (m === "POST" && approve) return Response.json(await passFor(Number(approve[1])));
  if (m === "POST" && /^\/api\/reservations\/\d+\/posted$/.test(p))
    return Response.json({ ...(await fixture("reservation-posted.json")), expires_at: inMs(300_000) });
  if (m === "POST" && /^\/api\/reservations\/\d+\/buy$/.test(p))
    return Response.json(await fixture("reservation-purchased.json"));
  if (m === "GET" && /^\/api\/reservations\/\d+$/.test(p))
    return Response.json({ ...(await fixture("reservation-held.json")), expires_at: inMs(600_000) });
  if (m === "GET" && p === "/api/dashboard") return Response.json(await fixture("dashboard.json"));
  if (m === "POST" && p === "/api/demo/reset") {
    attemptCount = 0;
    polls.clear();
    return Response.json({ ok: true });
  }
  if (m === "GET" && p === "/api/campaigns") return Response.json(await fixture("campaigns.json"));
  if (m === "POST" && p === "/api/campaigns/draft") {
    await Bun.sleep(1200);
    return Response.json(await fixture("campaign-draft.json"));
  }
  if (m === "POST" && p === "/api/campaigns") {
    const body = await req.json();
    return Response.json({ ...body, id: 99, available: body.allocation_total }, { status: 201 });
  }
  if (/^\/api\/campaigns\/\d+$/.test(p)) {
    const detail = await fixture("campaign-detail.json");
    if (m === "GET") return Response.json(detail);
    if (m === "PATCH") return Response.json({ ...detail.campaign, ...(await req.json()) });
  }
  return Response.json({ error: "NOT_FOUND", message: `mock has no ${m} ${p}` }, { status: 404 });
}

// Clean URLs: the landing page at "/", the shopper app at /mobile, merchant Studio at /desktop.
const PAGES: Record<string, string> = { "/": "landing.html", "/mobile": "index.html", "/desktop": "studio.html" };

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/"))
      return API_URL ? proxy(req, url) : mock(req, url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const path = PAGES[pathname] ?? pathname.slice(1).replaceAll("..", "");
    const file = Bun.file(PUBLIC + path);
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`web on http://localhost:${PORT} (${API_URL ? `proxy -> ${API_URL}` : "fixture mock"})`);
