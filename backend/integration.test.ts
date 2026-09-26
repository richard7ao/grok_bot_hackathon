import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "../contracts/fixtures");
const fixture = (name: string) => Bun.file(join(FIXTURES, name)).json();
const keys = (o: object) => Object.keys(o).sort();
const procs: Bun.Subprocess[] = [];

// Test servers run with DEMO_MODE=1; pass { DEMO_MODE: undefined } to start one with it unset.
// --no-env-file: the gitignored backend/.env must not leak settings (DEMO_MODE, OPENAI_*) into tests.
async function start(port: number, overrides: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dq-"));
  const env = { ...process.env, PORT: String(port), DB_PATH: join(dir, "t.db"), UPLOADS_DIR: join(dir, "up"), REVIEW_MODE: "fake", VENUE_LAT: "51.5237", VENUE_LNG: "-0.0785", DEMO_MODE: "1", ...overrides };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  procs.push(
    Bun.spawn([process.execPath, "--no-env-file", "server.ts"], {
      cwd: import.meta.dir,
      env,
      stdout: "ignore",
      stderr: "inherit",
    }),
  );
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/drops`)).ok) return base;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`server on ${port} did not start`);
}

// "hardware" comes from the seeded fact "Gold-plated hardware", so the fake review passes.
const PASS = "Beige trench and white jeans. I would carry it on my arm and show off the gold hardware.";
const RETRY = "Beige trench and white jeans. I would carry it on my arm.";

function entry(transcript: string, extra: Record<string, string> = {}, video = new Uint8Array(1000)) {
  const f = new FormData();
  f.set("video", new File([video], "clip.webm", { type: "video/webm" }));
  f.set("frame0", new File([new Uint8Array(10)], "frame0.jpg", { type: "image/jpeg" }));
  f.set("transcript", transcript);
  f.set("duration_ms", "15000");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

let api = "";
const post = (base: string, path: string, body?: BodyInit) => fetch(base + path, { method: "POST", body });
const json = (base: string, method: string, path: string, body: unknown) =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
// auto_review is off by default (takes wait as pending); tests that need an immediate pass/retry switch it on.
const setReview = async (base: string, id: number, review: Record<string, unknown>) => {
  const res = await json(base, "PATCH", `/api/campaigns/${id}`, { review });
  expect(res.status).toBe(200);
};
const reset = (allocation_total = 3) =>
  fetch(`${api}/api/demo/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allocation_total }) });

beforeAll(async () => {
  api = await start(3901);
  await setReview(api, 1, { auto_review: true });
});
beforeEach(async () => {
  await reset();
});
afterAll(() => procs.forEach((p) => p.kill()));

test("drops match the contract and show live stock", async () => {
  const body = await (await fetch(`${api}/api/drops`)).json();
  const fx = await fixture("drops.json");
  expect(keys(body)).toEqual(keys(fx));
  expect(keys(body.drops[0])).toEqual(keys(fx.drops[0]));
  const live = body.drops.find((d: any) => d.status === "live");
  expect(live.available).toBe(3);
  expect(body.drops.length).toBe(17);
  expect(body.drops.filter((d: any) => d.status === "preview").length).toBe(6);
});

test("pass → held → posted → purchased; repeated taps return the same state; dashboard counts it", async () => {
  const res = await post(api, "/api/drops/1/attempts", entry(PASS));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(keys(body)).toEqual(keys(await fixture("attempt-pass.json")));
  expect(keys(body.attempt)).toEqual(keys((await fixture("attempt-pass.json")).attempt));
  expect(body.attempt.verdict).toBe("pass");
  expect(keys(body.reservation)).toEqual(keys(await fixture("reservation-held.json")));
  expect(body.reservation.status).toBe("held");
  expect(body.reservation.caption.endsWith("#ad #HotDrop")).toBe(true);
  expect((await fetch(api + body.reservation.video_url)).status).toBe(200);

  const id = body.reservation.id;
  expect((await (await post(api, `/api/reservations/${id}/posted`)).json()).status).toBe("posted");
  expect((await (await post(api, `/api/reservations/${id}/posted`)).json()).status).toBe("posted");
  expect((await (await post(api, `/api/reservations/${id}/buy`)).json()).status).toBe("purchased");
  expect((await (await post(api, `/api/reservations/${id}/buy`)).json()).status).toBe("purchased");

  const dash = await (await fetch(`${api}/api/dashboard`)).json();
  const fx = await fixture("dashboard.json");
  expect(keys(dash)).toEqual(keys(fx));
  expect(keys(dash.stock)).toEqual(keys(fx.stock));
  expect(keys(dash.funnel)).toEqual(keys(fx.funnel));
  expect(dash.stock).toEqual({ total: 33, held: 0, posted: 0, sold: 1, available: 32 });
  expect(dash.funnel.purchased).toBe(1);
  expect(dash.events.map((e: any) => e.type)).toContain("hold_claimed");
});

test("checkout stays locked until the user says they posted", async () => {
  const { reservation } = await (await post(api, "/api/drops/1/attempts", entry(PASS))).json();
  const res = await post(api, `/api/reservations/${reservation.id}/buy`);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("BAD_STATE");
});

test("retry returns criterion feedback and holds no stock", async () => {
  const body = await (await post(api, "/api/drops/1/attempts", entry(RETRY))).json();
  expect(body.attempt.verdict).toBe("retry");
  expect(body.reservation).toBeNull();
  expect(body.attempt.feedback.length).toBeGreaterThan(0);
  expect(body.attempt.criteria.find((c: any) => c.id === "product_detail").result).toBe("unknown");
  const state = await (await fetch(`${api}/api/drops/1/state`)).json();
  expect(state).toEqual({ attempts_used: 1, max_attempts: 3, reservation: null });
});

test("a 4th counted attempt is refused", async () => {
  for (let i = 0; i < 3; i++) await post(api, "/api/drops/1/attempts", entry(RETRY));
  const res = await post(api, "/api/drops/1/attempts", entry(PASS));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("ATTEMPTS_EXHAUSTED");
});

test("no location gate: an entry from far away is accepted", async () => {
  // Anyone can enter a live drop from anywhere; lat/lng/debug are ignored if sent.
  const far = await post(api, "/api/drops/1/attempts", entry(PASS, { debug: "0", lat: "0", lng: "0" }));
  expect(far.status).toBe(200);
  expect((await far.json()).attempt.verdict).toBe("pass");
});

test("bad duration, preview drop and missing video are refused before review", async () => {
  const short = await post(api, "/api/drops/1/attempts", entry(PASS, { duration_ms: "5000" }));
  expect(short.status).toBe(422);
  expect((await short.json()).error).toBe("BAD_DURATION");
  const preview = await post(api, "/api/drops/5/attempts", entry(PASS));
  expect(preview.status).toBe(409);
  expect((await preview.json()).error).toBe("DROP_NOT_LIVE");
  const f = entry(PASS);
  f.delete("video");
  const missing = await post(api, "/api/drops/1/attempts", f);
  expect(missing.status).toBe(400);
  const blank = await post(api, "/api/drops/1/attempts", entry("   "));
  expect(blank.status).toBe(400);
  expect((await blank.json()).error).toBe("BAD_REQUEST");
  const state = await (await fetch(`${api}/api/drops/1/state`)).json();
  expect(state.attempts_used).toBe(0);
});

test("an auto-stopped 20 s clip is accepted; a much longer one is refused", async () => {
  const ok = await post(api, "/api/drops/1/attempts", entry(PASS, { duration_ms: "20100" }));
  expect(ok.status).toBe(200);
  const long = await post(api, "/api/drops/1/attempts", entry(PASS, { duration_ms: "25000" }));
  expect(long.status).toBe(422);
  expect((await long.json()).error).toBe("BAD_DURATION");
});

test("second pass while holding is ALREADY_RESERVED and stock is unchanged", async () => {
  await post(api, "/api/drops/1/attempts", entry(PASS));
  const res = await post(api, "/api/drops/1/attempts", entry(PASS));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("ALREADY_RESERVED");
  expect((await (await fetch(`${api}/api/dashboard`)).json()).stock.held).toBe(1);
});

test("no stock left: a passing entry gets NO_STOCK and holds nothing", async () => {
  await reset(0);
  const res = await post(api, "/api/drops/1/attempts", entry(PASS));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.attempt.verdict).toBe("pass");
  expect(body.reservation).toBeNull();
  expect(body.error).toBe("NO_STOCK");
});

test("last unit: two simultaneous passing entries produce exactly one hold", async () => {
  await reset(1);
  const [a, b] = await Promise.all([post(api, "/api/drops/1/attempts", entry(PASS)), post(api, "/api/drops/1/attempts", entry(PASS))]);
  const bodies = await Promise.all([a.json(), b.json()]);
  expect(bodies.filter((x) => x.reservation).length).toBe(1);
  const dash = await (await fetch(`${api}/api/dashboard`)).json();
  expect(dash.stock).toEqual({ total: 11, held: 1, posted: 0, sold: 0, available: 10 });
});

test("expired hold frees stock and blocks posting", async () => {
  const base = await start(3902, { HOLD_MS: "300" });
  await setReview(base, 1, { auto_review: true });
  const { reservation } = await (await post(base, "/api/drops/1/attempts", entry(PASS))).json();
  await Bun.sleep(500);
  expect((await (await fetch(`${base}/api/reservations/${reservation.id}`)).json()).status).toBe("expired");
  const res = await post(base, `/api/reservations/${reservation.id}/posted`);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("HOLD_EXPIRED");
  const drops = await (await fetch(`${base}/api/drops`)).json();
  expect(drops.drops[0].available).toBe(3);
});

test("review failure is an error verdict that does not count as an attempt", async () => {
  const base = await start(3903, { REVIEW_MODE: "openai", OPENAI_URL: "http://localhost:1/unreachable", OPENAI_API_KEY: "test" });
  for (let i = 0; i < 4; i++) {
    const body = await (await post(base, "/api/drops/1/attempts", entry(PASS))).json();
    expect(body.attempt.verdict).toBe("error");
    expect(body.reservation).toBeNull();
  }
  expect((await (await fetch(`${base}/api/drops/1/state`)).json()).attempts_used).toBe(0);
});

test("a restart applies a moved venue pin to an existing database", async () => {
  const shared = join(mkdtempSync(join(tmpdir(), "dq-")), "pin.db");
  const first = await start(3904, { DB_PATH: shared });
  await start(3905, { DB_PATH: shared, VENUE_LAT: "51.6" });
  expect((await (await fetch(`${first}/api/drops`)).json()).drops[0].lat).toBe(51.6);
});

test("oversized video is refused with 413", async () => {
  const res = await post(api, "/api/drops/1/attempts", entry(PASS, {}, new Uint8Array(51 * 1024 * 1024)));
  expect(res.status).toBe(413);
});

test("upload path traversal and unknown routes return 404 JSON", async () => {
  expect((await fetch(`${api}/uploads/..%2Ft.db`)).status).toBe(404);
  const res = await fetch(`${api}/api/nope`);
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("NOT_FOUND");
});

// Campaign tests run on their own server so created campaigns never touch the shared one's drops.
const CAMPAIGN = {
  brand: "Fleek Luxe", title: "Chanel Classic Flap — Black Caviar", description: "A black caviar Classic Flap with gold hardware.",
  price_pence: 920000, allocation_total: 1, image_url: "/img/baguette.svg", lat: 51.5237, lng: -0.0785, radius_m: 150, hold_minutes: 2,
  prompt: "Show your outfit and say how you'd style the Flap.", facts: ["Black caviar leather", "Gold-tone hardware"],
  rubric: [{ id: "outfit", label: "Outfit" }, { id: "styling_idea", label: "Styling" }, { id: "product_detail", label: "Detail" }, { id: "suitable", label: "Suitable" }],
  status: "draft", public_launch_at: "2026-10-03T10:00:00.000Z",
};
let campaigns = "";
const liveIds = async (base: string) => (await (await fetch(`${base}/api/drops`)).json()).drops.map((d: any) => d.id);

test("campaign list and detail match the contract", async () => {
  campaigns = await start(3906);
  await setReview(campaigns, 1, { auto_review: true });
  await post(campaigns, "/api/drops/1/attempts", entry(PASS));
  const list = await (await fetch(`${campaigns}/api/campaigns`)).json();
  const fx = await fixture("campaigns.json");
  expect(keys(list)).toEqual(keys(fx));
  expect(keys(list.campaigns[0])).toEqual(keys(fx.campaigns[0]));
  expect(keys(list.campaigns[0].stats)).toEqual(keys(fx.campaigns[0].stats));
  expect(list.campaigns.map((c: any) => c.id)).toEqual([17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const detail = await (await fetch(`${campaigns}/api/campaigns/1`)).json();
  const dfx = await fixture("campaign-detail.json");
  expect(keys(detail)).toEqual(keys(dfx));
  expect(keys(detail.campaign)).toEqual(keys(dfx.campaign));
  expect(keys(detail.campaign.review)).toEqual(keys(dfx.campaign.review));
  expect(keys(detail.campaign.review.thresholds)).toEqual(keys(dfx.campaign.review.thresholds));
  expect(detail.campaign.review).toEqual({ auto_review: true, thresholds: dfx.campaign.review.thresholds, scoring_prompt: "" });
  expect(keys(detail.reviews[0])).toEqual(keys(dfx.reviews[0]));
  expect(keys(detail.events[0])).toEqual(keys(dfx.events[0]));
  expect(detail.stats).toEqual({ attempts: 1, passed: 1, held: 1, posted: 0, sold: 0 });
  expect(detail.reviews[0].feedback.length).toBeGreaterThan(0);
  expect((await (await fetch(`${campaigns}/api/campaigns/5`)).json()).events).toEqual([]);
  expect((await fetch(`${campaigns}/api/campaigns/999`)).status).toBe(404);
});

test("a draft campaign stays hidden until PATCHed live", async () => {
  const res = await json(campaigns, "POST", "/api/campaigns", CAMPAIGN);
  expect(res.status).toBe(201);
  const created = await res.json();
  expect(keys(created)).toEqual(keys((await fixture("drops.json")).drops[0]));
  expect(await liveIds(campaigns)).not.toContain(created.id);
  const patched = await (await json(campaigns, "PATCH", `/api/campaigns/${created.id}`, { status: "live" })).json();
  expect(patched.status).toBe("live");
  expect(patched.title).toBe(CAMPAIGN.title);
  expect(await liveIds(campaigns)).toContain(created.id);
  const live = await (await json(campaigns, "POST", "/api/campaigns", { ...CAMPAIGN, status: "live" })).json();
  expect(await liveIds(campaigns)).toContain(live.id);
});

test("bad campaign fields are 400s that name the field", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ price_pence: 0 }, "price_pence"], [{ price_pence: 1.5 }, "price_pence"], [{ image_url: "/img/evil.svg" }, "image_url"],
    [{ rubric: [{ id: "Bad Id", label: "x" }] }, "rubric"], [{ facts: [] }, "facts"], [{ status: "gone" }, "status"],
    [{ public_launch_at: "soon" }, "public_launch_at"], [{ lat: "51" }, "lat"], [{ title: " " }, "title"],
  ];
  for (const [patch, field] of cases) {
    const res = await json(campaigns, "PATCH", "/api/campaigns/1", patch);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("BAD_REQUEST");
    expect(body.message).toContain(field);
  }
  const { hold_minutes, ...missing } = CAMPAIGN;
  expect((await (await json(campaigns, "POST", "/api/campaigns", missing)).json()).message).toContain("hold_minutes");
  const invalid = await fetch(`${campaigns}/api/campaigns`, { method: "POST", body: "{nope" });
  expect(invalid.status).toBe(400);
  expect((await json(campaigns, "PATCH", "/api/campaigns/999", { status: "live" })).status).toBe(404);
});

test("draft endpoint (fake mode) returns a prompt and the 4 rubric ids", async () => {
  const res = await json(campaigns, "POST", "/api/campaigns/draft", { brand: "Chanel", title: "Classic Flap", description: "Black caviar leather. Gold-tone CC turn-lock." });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(keys(body)).toEqual(keys(await fixture("campaign-draft.json")));
  expect(body.prompt).toContain("Classic Flap");
  expect(body.rubric.map((c: any) => c.id)).toEqual(["outfit", "styling_idea", "product_detail", "suitable"]);
  expect(body.facts.length).toBeGreaterThan(0);
  expect((await json(campaigns, "POST", "/api/campaigns/draft", { brand: "Chanel" })).status).toBe(400);
});

test("a new live campaign queues a take; the merchant's approval holds for its own hold_minutes", async () => {
  const drop = await (await json(campaigns, "POST", "/api/campaigns", { ...CAMPAIGN, status: "live" })).json();
  const pending = (await (await post(campaigns, `/api/drops/${drop.id}/attempts`, entry("Black jeans, and I'd wear the caviar flap crossbody."))).json()).attempt;
  expect(pending.verdict).toBe("pending");
  const { attempt, reservation } = await (await json(campaigns, "POST", `/api/campaigns/${drop.id}/decisions`, { attempt_id: pending.id, decision: "approve" })).json();
  expect(attempt.verdict).toBe("pass");
  expect(reservation.status).toBe("held");
  expect(reservation.price_pence).toBe(CAMPAIGN.price_pence);
  const holdMs = Date.parse(reservation.expires_at) - Date.now();
  expect(holdMs).toBeGreaterThan(110_000);
  expect(holdMs).toBeLessThanOrEqual(120_000);
  const detail = await (await fetch(`${campaigns}/api/campaigns/${drop.id}`)).json();
  expect(detail.stats.held).toBe(1);
  expect(detail.events.map((e: any) => e.type)).toContain("hold_claimed");
});

test("demo approve turns the latest retry into a pass with a held reservation", async () => {
  const retry = (await (await post(api, "/api/drops/1/attempts", entry(RETRY))).json()).attempt;
  const res = await post(api, `/api/attempts/${retry.id}/approve`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(keys(body)).toEqual(keys(await fixture("attempt-pass.json")));
  expect(body.attempt.verdict).toBe("pass");
  expect(body.attempt.criteria.every((c: any) => c.result === "pass")).toBe(true);
  expect(body.reservation.status).toBe("held");
  expect(body.error).toBeNull();
  const state = await (await fetch(`${api}/api/drops/1/state`)).json();
  expect(state.attempts_used).toBe(1);
  expect(state.reservation.status).toBe("held");
  const events = (await (await fetch(`${api}/api/dashboard`)).json()).events;
  expect(events.some((e: any) => e.type === "demo_approved")).toBe(true);
});

test("demo approve refuses a pass or an older attempt with 409 BAD_STATE, unknown with 404", async () => {
  const older = (await (await post(api, "/api/drops/1/attempts", entry(RETRY))).json()).attempt;
  const passed = (await (await post(api, "/api/drops/1/attempts", entry(PASS))).json()).attempt;
  for (const id of [passed.id, older.id]) {
    const res = await post(api, `/api/attempts/${id}/approve`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("BAD_STATE");
  }
  expect((await post(api, "/api/attempts/99999/approve")).status).toBe(404);
});

test("demo bypasses are off unless DEMO_MODE=1: approve is 404 and demo_pass is ignored", async () => {
  for (const [port, mode] of [[3909, undefined], [3910, "0"], [3911, "true"]] as const) {
    const base = await start(port, { DEMO_MODE: mode });
    const pending = (await (await post(base, "/api/drops/1/attempts", entry(RETRY))).json()).attempt;
    const res = await post(base, `/api/attempts/${pending.id}/approve`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("NOT_FOUND");
    // demo_pass=1 is ignored: an empty transcript is still refused, and a real one is reviewed normally.
    const blank = await post(base, "/api/drops/2/attempts", entry("", { demo_pass: "1" }));
    expect(blank.status).toBe(400);
    const reviewed = await (await post(base, "/api/drops/2/attempts", entry(RETRY, { demo_pass: "1" }))).json();
    expect(reviewed.attempt.verdict).toBe("pending");
    expect(reviewed.attempt.score).not.toBe(100);
    expect(reviewed.reservation).toBeNull();
  }
});

test("demo skip: empty transcript with demo_pass=1 is a pass and holds stock", async () => {
  const res = await post(api, "/api/drops/1/attempts", entry("", { demo_pass: "1" }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.attempt.verdict).toBe("pass");
  expect(body.reservation.status).toBe("held");
  const noSkip = await post(api, "/api/drops/2/attempts", entry(""));
  expect(noSkip.status).toBe(400);
});

// v3: scored takes and merchant approval. Drop 4 (XT-6) keeps auto_review off on the shared server.
const DETAIL4 = "Navy cargos and a grey fleece. I'd wear them with the laces pulled tight using the quicklace."; // score 72
const PLAIN4 = "Navy cargos and a grey fleece. I'd wear them with white socks."; // score 60

test("with auto_review off a take is pending: scored, ranked, and holds no stock", async () => {
  const res = await post(api, "/api/drops/4/attempts", entry(DETAIL4));
  expect(res.status).toBe(200);
  const body = await res.json();
  const fx = await fixture("attempt-pending.json");
  expect(keys(body)).toEqual(keys(fx));
  expect(keys(body.attempt)).toEqual(keys(fx.attempt));
  expect(keys(body.attempt.scores)).toEqual(keys(fx.attempt.scores));
  expect(body.attempt).toMatchObject({ verdict: "pending", score: 72, rank: 1, scores: { outfit: 7, styling: 7, product_detail: 8, energy: 7, quality: 7 } });
  expect(body.reservation).toBeNull();
  expect(body.error).toBeNull();
  // A pending take counts as an attempt.
  expect((await (await fetch(`${api}/api/drops/4/state`)).json()).attempts_used).toBe(1);
  expect((await (await fetch(`${api}/api/dashboard`)).json()).stock.held).toBe(0);
});

test("pending takes rank by score (ties: earlier first); campaign detail lists them first, then the rest newest first", async () => {
  const ids: number[] = [];
  for (const t of [PLAIN4, DETAIL4, DETAIL4]) ids.push((await (await post(api, "/api/drops/4/attempts", entry(t))).json()).attempt.id);
  const [low, high, tie] = ids;
  const rank = async (id: number) => (await (await fetch(`${api}/api/attempts/${id}`)).json()).attempt.rank;
  expect([await rank(high), await rank(tie), await rank(low)]).toEqual([1, 2, 3]);
  await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: high, decision: "reject" });
  expect([await rank(tie), await rank(low), await rank(high)]).toEqual([1, 2, null]);
  const detail = await (await fetch(`${api}/api/campaigns/4`)).json();
  const dfx = await fixture("campaign-detail.json");
  expect(keys(detail.reviews[0])).toEqual(keys(dfx.reviews[0]));
  expect(detail.reviews.map((r: any) => [r.attempt_id, r.verdict, r.rank])).toEqual([[tie, "pending", 1], [low, "pending", 2], [high, "retry", null]]);
  expect(detail.reviews[0].score).toBe(72);
  expect(keys(detail.campaign.review)).toEqual(keys(dfx.campaign.review));
  expect(detail.campaign.review.auto_review).toBe(false);
});

test("merchant approve: pass + held hold, visible on GET /api/attempts/:id; deciding again is 409", async () => {
  const { attempt } = await (await post(api, "/api/drops/4/attempts", entry(DETAIL4))).json();
  const before = await (await fetch(`${api}/api/attempts/${attempt.id}`)).json();
  expect(before).toEqual({ attempt, reservation: null });
  const res = await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: attempt.id, decision: "approve" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(keys(body)).toEqual(keys(await fixture("decision-approve.json")));
  expect(body.attempt).toMatchObject({ verdict: "pass", score: 72, rank: null });
  expect(body.reservation).toMatchObject({ status: "held", attempt_id: attempt.id });
  expect(body.error).toBeNull();
  const after = await (await fetch(`${api}/api/attempts/${attempt.id}`)).json();
  expect(after.reservation.id).toBe(body.reservation.id);
  const detail = await (await fetch(`${api}/api/campaigns/4`)).json();
  expect(detail.events.map((e: any) => e.type)).toContain("take_approved");
  const again = await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: attempt.id, decision: "reject" });
  expect(again.status).toBe(409);
  expect((await again.json()).error).toBe("BAD_STATE");
});

test("merchant reject: retry with the note, or the default message", async () => {
  const a = (await (await post(api, "/api/drops/4/attempts", entry(DETAIL4))).json()).attempt;
  const b = (await (await post(api, "/api/drops/4/attempts", entry(PLAIN4))).json()).attempt;
  const withNote = await (await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: a.id, decision: "reject", note: "  Show the shoes on foot.  " })).json();
  expect(withNote).toMatchObject({ attempt: { verdict: "retry", feedback: "Show the shoes on foot.", rank: null }, reservation: null, error: null });
  const plain = await (await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: b.id, decision: "reject" })).json();
  expect(plain.attempt.feedback).toBe("Thanks for entering — the merchant didn't pick this take. Try another angle.");
  const detail = await (await fetch(`${api}/api/campaigns/4`)).json();
  expect(detail.events.filter((e: any) => e.type === "take_rejected").map((e: any) => e.detail.drop_id)).toEqual([4, 4]);
});

test("decisions: non-pending or another campaign's take is 409; bad body 400; unknown 404", async () => {
  const passed = (await (await post(api, "/api/drops/1/attempts", entry(PASS))).json()).attempt; // auto_review on for drop 1
  const onOther = await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: passed.id, decision: "approve" });
  expect(onOther.status).toBe(409);
  const done = await json(api, "POST", "/api/campaigns/1/decisions", { attempt_id: passed.id, decision: "reject" });
  expect(done.status).toBe(409);
  expect((await done.json()).error).toBe("BAD_STATE");
  expect((await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: passed.id, decision: "maybe" })).status).toBe(400);
  expect((await json(api, "POST", "/api/campaigns/4/decisions", { decision: "approve" })).status).toBe(400);
  expect((await json(api, "POST", "/api/campaigns/4/decisions", { attempt_id: 99999, decision: "approve" })).status).toBe(404);
  expect((await json(api, "POST", "/api/campaigns/999/decisions", { attempt_id: passed.id, decision: "approve" })).status).toBe(404);
  expect((await fetch(`${api}/api/attempts/99999`)).status).toBe(404);
});

test("auto_review on: low thresholds pass and hold; product_detail threshold 10 turns the same take into a retry", async () => {
  await setReview(api, 9, { auto_review: true, thresholds: { outfit: 2, styling: 2, product_detail: 2, energy: 2, quality: 2 } });
  const lenient = await (await post(api, "/api/drops/9/attempts", entry("Denim jacket and loafers, I'd wear it daily."))).json();
  expect(lenient.attempt).toMatchObject({ verdict: "pass", score: 60, rank: null });
  expect(lenient.reservation.status).toBe("held");
  await reset();
  await setReview(api, 9, { thresholds: { product_detail: 10 } });
  const strict = await (await post(api, "/api/drops/9/attempts", entry("Denim jacket and loafers, I'd wear the bioceramic case daily."))).json();
  expect(strict.attempt.verdict).toBe("retry");
  expect(strict.attempt.scores.product_detail).toBe(8);
  expect(strict.attempt.feedback).toContain("product detail 8/10 (needs 10)");
  expect(strict.reservation).toBeNull();
  const detail = await (await fetch(`${api}/api/campaigns/9`)).json();
  expect(detail.campaign.review.thresholds).toEqual({ outfit: 2, styling: 2, product_detail: 10, energy: 2, quality: 2 });
});

test("PATCH review is validated before anything is written", async () => {
  const cases: [unknown, string][] = [
    [{ thresholds: { energy: 11 } }, "review.thresholds.energy"], [{ thresholds: { energy: 5.5 } }, "review.thresholds.energy"],
    [{ thresholds: { charisma: 5 } }, "review.thresholds"], [{ auto_review: "yes" }, "review.auto_review"],
    [{ scoring_prompt: "x".repeat(1001) }, "review.scoring_prompt"], ["on", "review"],
  ];
  for (const [review, field] of cases) {
    const res = await json(api, "PATCH", "/api/campaigns/2", { review });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain(field);
  }
  // A bad campaign field rejects the whole PATCH, review included.
  expect((await json(api, "PATCH", "/api/campaigns/2", { price_pence: 0, review: { auto_review: true } })).status).toBe(400);
  const ok = await json(api, "PATCH", "/api/campaigns/2", { review: { thresholds: { energy: 3 }, scoring_prompt: "Reward layering." } });
  expect(keys(await ok.json())).toEqual(keys((await fixture("drops.json")).drops[0]));
  const { review } = (await (await fetch(`${api}/api/campaigns/2`)).json()).campaign;
  expect(review).toEqual({ auto_review: false, thresholds: { outfit: 6, styling: 6, product_detail: 6, energy: 3, quality: 6 }, scoring_prompt: "Reward layering." });
});

test("demo approve and demo skip jump a pending take to a pass scored 100", async () => {
  const pending = (await (await post(api, "/api/drops/4/attempts", entry(PLAIN4))).json()).attempt;
  const approved = await (await post(api, `/api/attempts/${pending.id}/approve`)).json();
  expect(approved.attempt).toMatchObject({ verdict: "pass", score: 100, rank: null, scores: { outfit: 10, styling: 10, product_detail: 10, energy: 10, quality: 10 } });
  expect(approved.reservation.status).toBe("held");
  const skipped = await (await post(api, "/api/drops/3/attempts", entry("", { demo_pass: "1" }))).json();
  expect(skipped.attempt).toMatchObject({ verdict: "pass", score: 100 });
  expect(skipped.reservation.status).toBe("held");
});
