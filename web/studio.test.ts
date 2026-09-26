import { afterAll, beforeAll, expect, test } from "bun:test";

const PORT = 5921;
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
      if ((await fetch(`${base}/api/campaigns`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("web dev server did not start");
});
afterAll(() => proc.kill());

const json = (path: string, init?: RequestInit) => fetch(base + path, init).then((r) => r.json());
const post = (path: string, body: unknown, method = "POST") =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("studio.html has the shell, editor and detail hooks studio.js needs", async () => {
  const html = await (await fetch(`${base}/studio.html`)).text();
  for (const id of ["sidebar", "new-campaign", "campaign-grid", "filters", "campaign-form", "draft-ai", "editor-map", "kpis", "funnel", "reviews", "activity", "reset-demo"])
    expect(html).toContain(`id="${id}"`);
  expect(html).toContain('src="/studio.js"');
  expect(html).toContain("maplibre-gl@4.7.1/dist/maplibre-gl.js");
});

test("studio assets are served", async () => {
  for (const path of ["/studio.js", "/studio.css"]) expect((await fetch(base + path)).status).toBe(200);
});

test("mock campaigns list carries stats for the card funnels", async () => {
  const { campaigns } = await json("/api/campaigns");
  expect(campaigns.length).toBeGreaterThan(0);
  for (const c of campaigns) expect(Object.keys(c.stats).sort()).toEqual(["attempts", "held", "passed", "posted", "sold"]);
});

test("mock detail has campaign, stats, reviews and events", async () => {
  const d = await json("/api/campaigns/1");
  expect(d.campaign.id).toBe(1);
  expect(d.reviews.length).toBeGreaterThan(0);
  expect(d.events.length).toBeGreaterThan(0);
});

test("AI draft returns the four fixed Grok check ids", async () => {
  const d = await (await post("/api/campaigns/draft", { brand: "Chanel", title: "Classic Flap", description: "Pre-loved" })).json();
  expect(d.rubric.map((r: { id: string }) => r.id)).toEqual(["outfit", "styling_idea", "product_detail", "suitable"]);
  expect(d.prompt.length).toBeGreaterThan(0);
});

test("mock create echoes the body with full stock available; PATCH merges", async () => {
  const res = await post("/api/campaigns", { title: "New", allocation_total: 5 });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ id: 99, title: "New", available: 5 });
  const patched = await (await post("/api/campaigns/1", { title: "Renamed" }, "PATCH")).json();
  expect(patched).toMatchObject({ id: 1, title: "Renamed", brand: "Fleek Luxe" });
});

test("studio.js only calls contract routes", async () => {
  const js = await (await fetch(`${base}/studio.js`)).text();
  const calls = [...js.matchAll(/api\(`([^`]+)`/g), ...js.matchAll(/api\("([^"]+)"/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, ":id"));
  expect(calls.length).toBeGreaterThan(3);
  const allowed = ["/api/campaigns", "/api/campaigns/:id", "/api/campaigns/draft", "/api/demo/reset"];
  for (const c of calls) expect(allowed).toContain(c);
  expect(js).not.toContain("innerHTML");
});

test("dashboard.html points merchants to the studio", async () => {
  const html = await (await fetch(`${base}/dashboard.html`)).text();
  expect(html).toContain("/studio.html");
  expect(html).toContain("location.replace");
});

// Motion pass: Studio animates with the Web Animations API and must skip it under reduced motion;
// polling must only animate reviews/events it has not seen before.
test("studio motion uses WAAPI behind a prefers-reduced-motion guard", async () => {
  const js = await (await fetch(`${base}/studio.js`)).text();
  expect(js).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  expect(js).toMatch(/if \(REDUCED\.matches \|\| !node\?\.animate\) return;/);
  expect(js).toContain("state.seen.has(");
  const css = await (await fetch(`${base}/studio.css`)).text();
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});
