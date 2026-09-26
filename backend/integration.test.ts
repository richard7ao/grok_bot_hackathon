import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "../contracts/fixtures");
const fixture = (name: string) => Bun.file(join(FIXTURES, name)).json();
const keys = (o: object) => Object.keys(o).sort();
const procs: Bun.Subprocess[] = [];

async function start(port: number, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dq-"));
  procs.push(
    Bun.spawn([process.execPath, "server.ts"], {
      cwd: import.meta.dir,
      env: { ...process.env, PORT: String(port), DB_PATH: join(dir, "t.db"), UPLOADS_DIR: join(dir, "up"), REVIEW_MODE: "fake", VENUE_LAT: "51.5237", VENUE_LNG: "-0.0785", ...env },
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
  f.set("debug", "1");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

let api = "";
const post = (base: string, path: string, body?: BodyInit) => fetch(base + path, { method: "POST", body });
const reset = (allocation_total = 3) =>
  fetch(`${api}/api/demo/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allocation_total }) });

beforeAll(async () => {
  api = await start(3901);
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
  expect(body.drops.filter((d: any) => d.status === "preview").length).toBe(2);
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
  expect(body.reservation.caption.endsWith("#ad #FleekDropQuest")).toBe(true);
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
  expect(dash.stock).toEqual({ total: 3, held: 0, posted: 0, sold: 1, available: 2 });
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

test("location gate: far away is refused, at the venue is accepted", async () => {
  const far = await post(api, "/api/drops/1/attempts", entry(PASS, { debug: "0", lat: "0", lng: "0" }));
  expect(far.status).toBe(403);
  expect((await far.json()).error).toBe("OUTSIDE_ZONE");
  const near = await post(api, "/api/drops/1/attempts", entry(PASS, { debug: "0", lat: "51.5238", lng: "-0.0786" }));
  expect(near.status).toBe(200);
});

test("bad duration, preview drop and missing video are refused before review", async () => {
  const short = await post(api, "/api/drops/1/attempts", entry(PASS, { duration_ms: "5000" }));
  expect(short.status).toBe(422);
  expect((await short.json()).error).toBe("BAD_DURATION");
  const preview = await post(api, "/api/drops/2/attempts", entry(PASS));
  expect(preview.status).toBe(409);
  expect((await preview.json()).error).toBe("DROP_NOT_LIVE");
  const f = entry(PASS);
  f.delete("video");
  const missing = await post(api, "/api/drops/1/attempts", f);
  expect(missing.status).toBe(400);
  const state = await (await fetch(`${api}/api/drops/1/state`)).json();
  expect(state.attempts_used).toBe(0);
});

test("second pass while holding is ALREADY_RESERVED and stock is unchanged", async () => {
  await post(api, "/api/drops/1/attempts", entry(PASS));
  const res = await post(api, "/api/drops/1/attempts", entry(PASS));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("ALREADY_RESERVED");
  expect((await (await fetch(`${api}/api/dashboard`)).json()).stock.held).toBe(1);
});

test("last unit: two simultaneous passing entries produce exactly one hold", async () => {
  await reset(1);
  const [a, b] = await Promise.all([post(api, "/api/drops/1/attempts", entry(PASS)), post(api, "/api/drops/1/attempts", entry(PASS))]);
  const bodies = await Promise.all([a.json(), b.json()]);
  expect(bodies.filter((x) => x.reservation).length).toBe(1);
  const dash = await (await fetch(`${api}/api/dashboard`)).json();
  expect(dash.stock).toEqual({ total: 1, held: 1, posted: 0, sold: 0, available: 0 });
});

test("expired hold frees stock and blocks posting", async () => {
  const base = await start(3902, { HOLD_MS: "300" });
  const { reservation } = await (await post(base, "/api/drops/1/attempts", entry(PASS))).json();
  await Bun.sleep(500);
  expect((await (await fetch(`${base}/api/reservations/${reservation.id}`)).json()).status).toBe("expired");
  const res = await post(base, `/api/reservations/${reservation.id}/posted`);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("HOLD_EXPIRED");
  const drops = await (await fetch(`${base}/api/drops`)).json();
  expect(drops.drops[0].available).toBe(3);
});

test("Grok failure is an error verdict that does not count as an attempt", async () => {
  const base = await start(3903, { REVIEW_MODE: "xai", XAI_URL: "http://localhost:1/unreachable", XAI_API_KEY: "test" });
  for (let i = 0; i < 4; i++) {
    const body = await (await post(base, "/api/drops/1/attempts", entry(PASS))).json();
    expect(body.attempt.verdict).toBe("error");
    expect(body.reservation).toBeNull();
  }
  expect((await (await fetch(`${base}/api/drops/1/state`)).json()).attempts_used).toBe(0);
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
