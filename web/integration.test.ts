import { afterAll, beforeAll, expect, test } from "bun:test";

const PORT = 5901;
const base = `http://localhost:${PORT}`;
let proc: Bun.Subprocess;

beforeAll(async () => {
  proc = Bun.spawn([process.execPath, "dev.ts"], {
    cwd: import.meta.dir,
    env: { ...process.env, PORT: String(PORT), API_URL: "" },
    stdout: "ignore",
    stderr: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/drops`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("web dev server did not start");
});
afterAll(() => proc.kill());

const SCREENS = ["s-map", "s-drop", "s-record", "s-preview", "s-review", "s-result", "s-share", "s-buy", "s-done"];

test("index has every screen, Leaflet and app.js", async () => {
  const html = await (await fetch(`${base}/`)).text();
  for (const id of SCREENS) expect(html).toContain(`id="${id}"`);
  expect(html).toContain("maplibre-gl@4.7.1/dist/maplibre-gl.js");
  expect(html).toContain('src="/app.js"');
  expect(html).toContain('id="debug"');
});

test("static assets are served", async () => {
  for (const path of ["/app.js", "/style.css", "/img/birkin.svg", "/img/baguette.svg", "/img/flats.svg", "/img/shell.svg", "/img/sneaker.svg", "/img/shirt.svg"]) expect((await fetch(base + path)).status).toBe(200);
  expect((await fetch(`${base}/nope.js`)).status).toBe(404);
});

test("app.js only calls contract routes", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  const calls = [...js.matchAll(/api\(`([^`]+)`/g), ...js.matchAll(/api\("([^"]+)"/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, ":id"));
  const allowed = ["/api/drops", "/api/drops/:id/state", "/api/drops/:id/attempts", "/api/reservations/:id/posted", "/api/reservations/:id/buy"];
  for (const c of calls) expect(allowed).toContain(c);
});

// The review verdict is held back for a timed reveal; a demo button must be able to skip the wait,
// and a reload mid-wait must be able to recover it from localStorage.
test("review wait screen, demo fast-forward and reload recovery are wired", async () => {
  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain('id="s-wait"');
  expect(html).toContain('id="w-skip"');
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("REVIEW_WAIT_MS");
  expect(js).toContain("dq_pending");
  expect(js.indexOf("loadPending()")).toBeLessThan(js.indexOf("/state`"));
});

test("every drop image in the mock is served", async () => {
  const { drops } = await (await fetch(`${base}/api/drops`)).json();
  for (const d of drops) expect((await fetch(base + d.image_url)).status).toBe(200);
});

test("mock serves the live drop the map needs", async () => {
  const { drops } = await (await fetch(`${base}/api/drops`)).json();
  const live = drops.find((d: any) => d.status === "live");
  expect(live.available).toBeGreaterThan(0);
  expect(typeof live.lat).toBe("number");
});

test("mock attempts alternate retry then pass with a held reservation", async () => {
  const form = () => {
    const f = new FormData();
    f.set("video", new File([new Uint8Array(10)], "clip.webm", { type: "video/webm" }));
    f.set("transcript", "hello");
    return f;
  };
  await fetch(`${base}/api/demo/reset`, { method: "POST" });
  const first = await (await fetch(`${base}/api/drops/1/attempts`, { method: "POST", body: form() })).json();
  expect(first.attempt.verdict).toBe("retry");
  expect(first.attempt.feedback.length).toBeGreaterThan(0);
  const second = await (await fetch(`${base}/api/drops/1/attempts`, { method: "POST", body: form() })).json();
  expect(second.reservation.status).toBe("held");
  expect(Date.parse(second.reservation.expires_at)).toBeGreaterThan(Date.now());
});

test("app.js sends the multipart fields the contract names", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  for (const field of ['"video"', '"transcript"', '"duration_ms"', '"debug"', '"lat"', '"lng"', "`frame${i}`"]) expect(js).toContain(field);
});

test("app.js enforces the caption suffix and uses posted then buy", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("#ad #FleekDropQuest");
  expect(js.indexOf("/posted`")).toBeGreaterThan(-1);
  expect(js.indexOf("/buy`")).toBeGreaterThan(-1);
  const posted = await (await fetch(`${base}/api/reservations/1/posted`, { method: "POST" })).json();
  expect(posted.status).toBe("posted");
  expect((await (await fetch(`${base}/api/reservations/1/buy`, { method: "POST" })).json()).status).toBe("purchased");
});

test("dashboard page and data are served", async () => {
  const html = await (await fetch(`${base}/dashboard.html`)).text();
  for (const id of ["stock", "funnel", "events", "reset"]) expect(html).toContain(`id="${id}"`);
  expect((await fetch(`${base}/dashboard.js`)).status).toBe(200);
  const d = await (await fetch(`${base}/api/dashboard`)).json();
  expect(Object.keys(d.stock)).toEqual(["total", "held", "posted", "sold", "available"]);
});
