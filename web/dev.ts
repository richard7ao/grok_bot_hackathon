// Web dev server: static files from public/, plus /api and /uploads.
// API_URL set   -> proxy to the real backend.
// API_URL unset -> serve contracts/fixtures (attempts alternate retry, pass).
const API_URL = process.env.API_URL;
const PORT = Number(process.env.PORT ?? 5173);
const PUBLIC = new URL("./public/", import.meta.url).pathname;
const FIXTURES = new URL("../contracts/fixtures/", import.meta.url).pathname;

let attemptCount = 0;

const fixture = (name: string) => Bun.file(FIXTURES + name).json();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

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
    await req.formData();
    await Bun.sleep(1500);
    const body = await fixture(++attemptCount % 2 ? "attempt-retry.json" : "attempt-pass.json");
    if (body.reservation) body.reservation.expires_at = inMs(600_000);
    return Response.json(body);
  }
  if (m === "POST" && /^\/api\/reservations\/\d+\/posted$/.test(p))
    return Response.json({ ...(await fixture("reservation-posted.json")), expires_at: inMs(300_000) });
  if (m === "POST" && /^\/api\/reservations\/\d+\/buy$/.test(p))
    return Response.json(await fixture("reservation-purchased.json"));
  if (m === "GET" && /^\/api\/reservations\/\d+$/.test(p))
    return Response.json({ ...(await fixture("reservation-held.json")), expires_at: inMs(600_000) });
  if (m === "GET" && p === "/api/dashboard") return Response.json(await fixture("dashboard.json"));
  if (m === "POST" && p === "/api/demo/reset") {
    attemptCount = 0;
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
