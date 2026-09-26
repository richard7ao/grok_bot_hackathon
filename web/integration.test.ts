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
  expect(html).toContain("leaflet@1.9.4/dist/leaflet.js");
  expect(html).toContain('src="/app.js"');
  expect(html).toContain('id="debug"');
});

test("static assets are served", async () => {
  for (const path of ["/app.js", "/style.css", "/img/birkin.svg", "/img/baguette.svg", "/img/flats.svg"]) expect((await fetch(base + path)).status).toBe(200);
  expect((await fetch(`${base}/nope.js`)).status).toBe(404);
});

test("app.js only calls contract routes", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  const calls = [...js.matchAll(/api\(`([^`]+)`/g), ...js.matchAll(/api\("([^"]+)"/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, ":id"));
  const allowed = ["/api/drops", "/api/drops/:id/state", "/api/drops/:id/attempts", "/api/reservations/:id/posted", "/api/reservations/:id/buy"];
  for (const c of calls) expect(allowed).toContain(c);
});

test("mock serves the live drop the map needs", async () => {
  const { drops } = await (await fetch(`${base}/api/drops`)).json();
  const live = drops.find((d: any) => d.status === "live");
  expect(live.available).toBeGreaterThan(0);
  expect(typeof live.lat).toBe("number");
});
