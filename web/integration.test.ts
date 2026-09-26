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
  const html = await (await fetch(`${base}/mobile`)).text();
  for (const id of SCREENS) expect(html).toContain(`id="${id}"`);
  expect(html).toContain("maplibre-gl@4.7.1/dist/maplibre-gl.js");
  expect(html).toContain('src="/app.js"');
  expect(html).not.toContain('id="debug"'); // location gate removed: no "at venue" toggle
  expect(html).toContain("<title>HotDrop</title>");
});

test("static assets are served", async () => {
  for (const path of ["/app.js", "/style.css", "/img/birkin.svg", "/img/baguette.svg", "/img/flats.svg", "/img/shell.svg", "/img/sneaker.svg", "/img/shirt.svg"]) expect((await fetch(base + path)).status).toBe(200);
  expect((await fetch(`${base}/nope.js`)).status).toBe(404);
});

test("app.js only calls contract routes", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  const calls = [...js.matchAll(/api\(`([^`]+)`/g), ...js.matchAll(/api\("([^"]+)"/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, ":id"));
  const allowed = ["/api/drops", "/api/drops/:id/state", "/api/drops/:id/attempts", "/api/reservations/:id/posted", "/api/reservations/:id/buy", "/api/attempts/:id/approve", "/api/attempts/:id"];
  for (const c of calls) expect(allowed).toContain(c);
});

// Takes queue for the merchant (v3): the wait screen shows the real score and rank and polls the
// attempt until it is picked. A reload must resume polling, and a demo button must be able to skip it.
test("queue screen shows the score and polls the attempt, with a demo skip and reload recovery", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  for (const id of ["s-wait", "w-skip", "w-ring", "w-score", "w-metrics", "w-rank", "w-feedback", "res-ring", "res-metrics"]) expect(html).toContain(`id="${id}"`);
  expect(html).toContain("Skip review (demo)");
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).not.toContain("REVIEW_WAIT_MS"); // no fake timed reveal any more
  expect(js).toContain("api(`/api/attempts/${p.attempt_id}`)");
  expect(js).toContain("setInterval(pollAttempt, POLL_MS)");
  expect(js).toContain('verdict === "pending"');
  expect(js).toContain("dq_pending");
  expect(js.indexOf("loadPending()")).toBeLessThan(js.indexOf("/state`"));
  for (const key of ["outfit", "styling", "product_detail", "energy", "quality"]) expect(js).toContain(`"${key}"`);
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

test("mock queues attempts as pending, then polling returns a pass with a live hold", async () => {
  const form = () => {
    const f = new FormData();
    f.set("video", new File([new Uint8Array(10)], "clip.webm", { type: "video/webm" }));
    f.set("transcript", "hello");
    return f;
  };
  await fetch(`${base}/api/demo/reset`, { method: "POST" });
  const first = await (await fetch(`${base}/api/drops/1/attempts`, { method: "POST", body: form() })).json();
  expect(first.attempt.verdict).toBe("pending");
  expect(first.attempt.id).toBe(1);
  expect(first.attempt.score).toBeGreaterThan(0);
  expect(first.attempt.rank).toBeGreaterThan(0);
  expect(first.reservation).toBeNull();
  const second = await (await fetch(`${base}/api/drops/1/attempts`, { method: "POST", body: form() })).json();
  expect(second.attempt.id).toBe(2);
  const verdicts = [];
  let last;
  for (let i = 0; i < 3; i++) {
    last = await (await fetch(`${base}/api/attempts/1`)).json();
    verdicts.push(last.attempt.verdict);
  }
  expect(verdicts).toEqual(["pending", "pending", "pass"]);
  expect(last.reservation.status).toBe("held");
  expect(Date.parse(last.reservation.expires_at)).toBeGreaterThan(Date.now());
});

test("app.js sends the multipart fields the contract names", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  for (const field of ['"video"', '"transcript"', '"duration_ms"', "`frame${i}`"]) expect(js).toContain(field);
});

test("app.js enforces the caption suffix and uses posted then buy", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("#ad #HotDrop");
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

// Reels-style camera: the tool rail, shutter, live captions and hint chips must exist, and the
// existing ids the recording flow depends on must survive the redesign.
test("record and preview screens carry the Reels camera controls", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  const ids = ["r-live", "r-go", "r-stop", "r-clock", "r-note", "r-prompt", "r-close", "r-shutter", "r-flip", "r-timer", "r-hints", "r-guide", "r-guides", "r-captions", "r-count", "r-blocked", "r-retry", "r-fill1", "r-fill2", "r-chip-outfit", "r-chip-styling", "r-chip-detail", "p-video", "p-transcript", "p-submit", "p-retake", "p-back", "p-dur", "p-chip-outfit", "p-chip-styling", "p-chip-detail"];
  for (const id of ids) expect(html).toContain(`id="${id}"`);
  expect(html).toContain("Hints only — your stylist makes the call.");
});

// Interim results drive captions/chips only; the clip limits must match the contract (10–20 s).
test("app.js uses interim speech results and the contract's clip limits", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("interimResults = true");
  expect(js).toContain("MIN_MS = 10000, MAX_MS = 20000");
  expect(js).toMatch(/if \(e\.results\[i\]\.isFinal\) transcript \+=/);
});

// Native-feel navigation: every non-map screen except the in-flight review has a back chevron,
// and the browser/OS back gesture routes through the same parent map.
test("every non-map screen has a back button and history back is wired", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  const sections = html.split('<section id="').slice(1).map((s) => [s.slice(0, s.indexOf('"')), s] as const);
  for (const [id, body] of sections) {
    if (id === "s-map") continue;
    if (id === "s-review" || id === "s-wait") expect(body).not.toContain("data-back");
    else expect(body).toMatch(/class="back-btn" data-back aria-label="[^"]+"/);
  }
  expect(html).toContain("you can leave, we'll keep your spot");
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("history.pushState");
  expect(js).toContain('addEventListener("popstate", goBack)');
  expect(js).toContain('"s-buy": "s-share"');
});

// Motion pass: effects come from vanilla Motion (CDN) with a Web Animations fallback, and every
// JS-driven effect must bail out for people who asked the OS for reduced motion.
test("app motion loads Motion before app.js and respects prefers-reduced-motion", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  const motion = html.indexOf("cdn.jsdelivr.net/npm/motion@11");
  expect(motion).toBeGreaterThan(-1);
  expect(motion).toBeLessThan(html.indexOf('src="/app.js"'));
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  expect(js).toContain("window.Motion?.animate"); // optional: falls back to node.animate (WAAPI)
  expect(js.match(/if \(REDUCED\.matches/g)?.length).toBeGreaterThanOrEqual(5);
  const css = await (await fetch(`${base}/style.css`)).text();
  expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g)?.length).toBeGreaterThanOrEqual(2);
});

test("record screen burns the product sticker into the recording and frames", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  for (const id of ["r-sticker", "r-sticker-img", "r-sticker-toggle", "r-canvas"]) expect(html).toContain(`id="${id}"`);
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain('$("#r-canvas").captureStream(30)'); // recorder gets the composited canvas, not the raw camera
  expect(js).toMatch(/function drawSticker[\s\S]*drawImage\(im,/);
  expect(js).toMatch(/function grabFrame\(\) \{\s*const v = \$\("#r-canvas"\)/); // The AI's frames include the sticker
});

test("customer app uses real product photos, not the SVG placeholders", async () => {
  for (const path of ["/mobile", "/app.js"]) expect(await (await fetch(base + path)).text()).not.toMatch(/\/img\/(?!avatar\.svg)[\w-]+\.svg/); // avatar.svg is the map "you" marker, not a product
});

// Demo-only escape hatch: a presenter can force a pass from the result screen.
test("result screen has a demo approve button wired to the approve route", async () => {
  expect(await (await fetch(`${base}/mobile`)).text()).toContain('id="res-approve"');
  expect(await (await fetch(`${base}/app.js`)).text()).toContain("api(`/api/attempts/${st.approveId}/approve`");
  const body = await (await fetch(`${base}/api/attempts/1/approve`, { method: "POST" })).json();
  expect(body.attempt.verdict).toBe("pass");
  expect(body.reservation.status).toBe("held");
  expect(Date.parse(body.reservation.expires_at)).toBeGreaterThan(Date.now());
});

test("map clusters drops and has All drops / Near me controls", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("cluster: true");
  expect(js).toContain("getClusterExpansionZoom");
  expect(js).toContain("querySourceFeatures");
  const html = await (await fetch(`${base}/mobile`)).text();
  for (const id of ["map-all", "map-me"]) {
    expect(html).toContain(`id="${id}"`);
    expect(js).toContain(`$("#${id}")`);
  }
});

test("clean URLs: / is the landing page, /mobile the shopper app, /desktop Studio", async () => {
  const landing = await (await fetch(`${base}/`)).text();
  expect(landing).toContain('href="/mobile"');
  expect(landing).toContain('href="/desktop"');
  const page = async (path: string) => (await fetch(base + path)).text();
  expect(await page("/mobile/")).toBe(await page("/index.html"));
  expect(await page("/desktop")).toBe(await page("/studio.html"));
});

test("record screen offers a video upload that submits with its source, direct to Render on Vercel", async () => {
  const html = await (await fetch(`${base}/mobile`)).text();
  for (const id of ["r-upload", "r-upload-link", "r-file", "p-heard"]) expect(html).toContain(`id="${id}"`);
  expect(html).toContain('accept="video/*"');
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain('const UPLOAD_ORIGIN = "https://dropquest.onrender.com"');
  expect(js).toContain('f.set("source", c.source)');
  expect(js).toContain('source: "upload"');
  expect(js).toContain("Transcribing your video…");
});

// MapLibre positions marker elements absolutely; a `position` on the .pin/.you/.cluster root puts
// markers in normal flow, so each pin is offset by the ones before it and they drift or vanish.
test("map marker roots never set position (keeps pins on their coordinates)", async () => {
  const css = await (await fetch(`${base}/style.css`)).text();
  for (const m of css.matchAll(/(?:^|\})\s*([^{}]+)\{([^}]*)\}/g)) {
    const roots = m[1].split(",").map((s) => s.trim()).filter((s) => /^\.(pin|you|cluster)(\.[\w-]+)*$/.test(s));
    if (roots.length) expect(m[2]).not.toMatch(/(^|;)\s*position\s*:/);
  }
});
