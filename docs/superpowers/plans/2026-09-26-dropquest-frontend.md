# DropQuest Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Pokémon Go-style web app on localhost. Map with drop pins, then a webcam challenge, Grok review, hold, Instagram share, "I posted", simulated buy. Plus a merchant dashboard.

**Architecture:** Static files in `web/public/` (no framework, no build step) served by `web/dev.ts` (port 5173). `dev.ts` serves `contracts/fixtures` when `API_URL` is unset, so the whole UI is built before the backend exists. `bun dev:live` proxies to the real backend on :3000. Leaflet from unpkg for the map.

**Tech Stack:** HTML/CSS/vanilla JS, Leaflet 1.9.4, `MediaRecorder`, `webkitSpeechRecognition` (Chrome), Bun 1.4 for the dev server and tests.

**Spec:** `docs/superpowers/specs/2026-09-26-dropquest-web-design.md` (stages T2.1.1 – T2.3.1). **Contract:** `contracts/README.md` + `contracts/fixtures/`.

**Where:** worktree `../dropquest-web` on branch `feat/frontend`. Touch only `web/`. State file: `tasks/frontend-state.json` in that worktree.

## Global Constraints

- **Visual design is `C3 — Clean girl matcha`** (reference: `/Users/richardlao/Documents/GitHub/personal/dropquest-mock-c/web/public/mockup-v3.html`). It overrides the CSS and markup styling in the tasks below; keep the element ids, screens, behaviour and tests exactly as written.
- Product images are inline-drawn SVGs in `web/public/img/`: `birkin.svg`, `baguette.svg`, `flats.svg` (referenced by the fixtures). UI shows "Demo listing — not affiliated with the brand." on the drop sheet.

- Only `web/` changes on this branch. `contracts/`, `docs/`, `.claude/memory.md` change only on `main`.
- Call only routes in `contracts/README.md`; read only fields shown in `contracts/fixtures/`.
- Any text from the model, the user or the API goes in via `textContent`, never `innerHTML`.
- Demo browser: desktop Chrome (speech recognition and mp4 `MediaRecorder` need it).
- Recording 10–20 s; stop button enabled at 10 s; auto-stop at 20 s.
- Caption copied for Instagram always ends `#ad #FleekDropQuest`.
- Honest labels: "at venue (demo)" toggle, "Posting is self-reported", "simulated checkout".
- Timers derive from server `expires_at`, never a client countdown start.
- Tiers 2 and 3 are skipped by user decision; Tier 4 is `bun test integration.test.ts` plus the stage's Chrome checklist.

## Review Focus

1. Camera or mic denied → clear message, record button disabled, no stuck screen. Chrome checklist T2.1.2 item 1.
2. Browser without speech recognition → recording still works, note says Grok sees frames only. Checklist T2.1.2 item 2.
3. Page reload while holding → app reopens on the share/buy screen with the same timer. Checklist T2.1.3 item 4 (mock `state` fixture edited to a held reservation).
4. Timer hits zero → "Hold expired" screen, no buy button. Checklist T2.1.3 item 5.
5. Location denied → hint to use the "at venue (demo)" toggle; start button shows the reason. Checklist T2.1.1 item 3.

---

### Task 1 (T2.1.1): Shell, map, drop sheet, location

**Files:**
- Create: `web/public/index.html`, `web/public/style.css`, `web/public/app.js`, `web/integration.test.ts`
- Existing (scaffold, do not rewrite): `web/dev.ts`, `web/package.json`, `web/public/img/jacket.svg` (unused now; create `birkin.svg`, `baguette.svg`, `flats.svg` in this task)

**Interfaces:**
- Consumes: `GET /api/drops`, `GET /api/drops/:id/state` (see contract).
- Produces (in `app.js`, used by Tasks 2–3): `$`, `st` (`{ drops, drop, pos, res, clip, timer, attemptsLeft, durationMs }`), `show(id)`, `toast(msg)`, `api(path, opts)` (throws `Error` with `.code`), `pounds(pence)`, `openDrop(id)`, `renderDrop()`, `resume(reservation)`, `debugBox`. Screen ids: `s-map s-drop s-record s-preview s-review s-result s-share s-buy s-done`.

- [ ] **Step 1: Session start.** In the worktree: `bun --version` (1.4.x). Create `tasks/frontend-state.json` (see the end of this plan). Set T2.1.1 `in_progress`.

- [ ] **Step 2: Write the integration test** — `web/integration.test.ts`

```ts
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
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd web && bun test integration.test.ts`
Expected: FAIL on "index has every screen" (404, no `index.html`).

- [ ] **Step 4: Write `web/public/index.html`** (all screens now, so later tasks only add JS)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fleek DropQuest</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<main id="app">
  <header class="bar">
    <strong>DropQuest</strong><span class="by">by Fleek</span>
    <label class="debug"><input type="checkbox" id="debug"> at venue (demo)</label>
  </header>

  <section id="s-map" class="screen">
    <div id="map"></div>
    <p id="loc-status" class="hint">Finding you…</p>
  </section>

  <section id="s-drop" class="screen" hidden>
    <button class="link" data-go="s-map">← Map</button>
    <img id="d-img" class="product" alt="Drop item">
    <h1 id="d-title"></h1>
    <p class="price"><span id="d-price"></span> · <span id="d-stock"></span></p>
    <h2>Your challenge</h2><p id="d-prompt"></p>
    <h2>Drop card</h2><ul id="d-facts"></ul>
    <h2>Grok checks for</h2><ul id="d-rubric"></ul>
    <p class="rules">Pass Grok's review to hold one item for 10 minutes. Post your clip to Instagram to unlock early access at the listed price. Stock is limited, so qualifying does not guarantee a unit.</p>
    <button id="d-start" class="cta">Start challenge</button>
    <p id="d-why" class="hint"></p>
  </section>

  <section id="s-record" class="screen" hidden>
    <div class="cam"><video id="r-live" autoplay muted playsinline></video><p id="r-prompt" class="overlay"></p><p id="r-clock" class="clock">0s</p></div>
    <button id="r-go" class="cta">Record</button>
    <button id="r-stop" class="cta" hidden disabled>Stop</button>
    <p id="r-note" class="hint"></p>
  </section>

  <section id="s-preview" class="screen" hidden>
    <video id="p-video" controls playsinline></video>
    <p class="hint">Grok heard: <span id="p-transcript"></span></p>
    <button id="p-submit" class="cta">Submit to Grok</button>
    <button id="p-retake" class="link">Retake</button>
  </section>

  <section id="s-review" class="screen" hidden>
    <div class="spinner" aria-hidden="true"></div>
    <p id="rv-stage" role="status">Uploading your clip…</p>
  </section>

  <section id="s-result" class="screen" hidden>
    <h1 id="res-title"></h1>
    <p id="res-feedback"></p>
    <ul id="res-criteria" class="criteria"></ul>
    <button id="res-retry" class="cta" hidden>Try again</button>
    <button id="res-map" class="link" data-go="s-map" hidden>Back to map</button>
  </section>

  <section id="s-share" class="screen" hidden>
    <p class="timer">Held for <span id="sh-timer"></span></p>
    <h1>Post your Reel to unlock</h1>
    <ol class="steps">
      <li><a id="sh-download" download>Download your clip</a></li>
      <li>Copy the caption <button id="sh-copy" class="link">Copy</button></li>
      <li><a href="https://www.instagram.com/" target="_blank" rel="noopener">Open Instagram</a> and post it as a Reel</li>
    </ol>
    <textarea id="sh-caption" rows="3" aria-label="Caption"></textarea>
    <button id="sh-posted" class="cta">I posted it</button>
    <p class="hint">Posting is self-reported in this demo.</p>
  </section>

  <section id="s-buy" class="screen" hidden>
    <p class="timer">Early access ends in <span id="b-timer"></span></p>
    <img class="product" src="/img/birkin.svg" alt="">
    <h1 id="b-title"></h1>
    <p id="b-price" class="price"></p>
    <button id="b-buy" class="cta">Buy now (simulated checkout)</button>
  </section>

  <section id="s-done" class="screen" hidden>
    <div class="card"><p class="tag">DropQuest collectible</p><h1 id="dn-title"></h1><p>Early access · purchased</p></div>
    <p>Pick up at the Fleek venue. Payment was simulated.</p>
    <button class="link" data-go="s-map">Back to map</button>
  </section>

  <p id="toast" class="toast" role="status" hidden></p>
</main>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 5: Write `web/public/style.css`**

```css
:root { --bg: #0e0d0b; --panel: #1b1916; --ink: #f4efe6; --muted: #a39b8d; --accent: #e8b04b; --ok: #6fcf7f; --bad: #ef6b5b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
#app { max-width: 430px; min-height: 100vh; margin: 0 auto; background: var(--panel); position: relative; }
.bar { display: flex; gap: 8px; align-items: baseline; padding: 12px 16px; border-bottom: 1px solid #2c2923; }
.bar strong { font-size: 20px; letter-spacing: -0.02em; } .by { color: var(--muted); font-size: 13px; }
.debug { margin-left: auto; font-size: 12px; color: var(--muted); }
.screen { padding: 16px; } #s-map { padding: 0; }
#map { height: calc(100vh - 100px); background: #222; }
h1 { font-size: 24px; margin: 8px 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 18px 0 4px; }
.price { color: var(--accent); font-weight: 600; } .hint, .rules { color: var(--muted); font-size: 14px; }
.cta { display: block; width: 100%; padding: 14px; margin-top: 16px; border: 0; border-radius: 12px; background: var(--accent); color: #1b1305; font-weight: 700; font-size: 17px; cursor: pointer; }
.cta:disabled { opacity: .4; cursor: not-allowed; }
.link { background: none; border: 0; color: var(--accent); padding: 8px 0; font-size: 15px; cursor: pointer; }
a { color: var(--accent); }
.product { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 16px; background: #2b2118; }
.cam { position: relative; border-radius: 16px; overflow: hidden; background: #000; }
.cam video, #p-video { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block; border-radius: 16px; background: #000; }
.overlay { position: absolute; left: 0; right: 0; bottom: 0; margin: 0; padding: 12px; background: linear-gradient(transparent, rgba(0,0,0,.8)); font-size: 14px; }
.clock { position: absolute; top: 8px; right: 12px; margin: 0; padding: 2px 8px; border-radius: 8px; background: rgba(0,0,0,.6); font-variant-numeric: tabular-nums; }
.spinner { width: 48px; height: 48px; margin: 40px auto 16px; border: 4px solid #333; border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
#rv-stage { text-align: center; }
.criteria { padding-left: 18px; } .criteria li.pass::marker { content: "✓ "; color: var(--ok); } .criteria li.fail::marker, .criteria li.unknown::marker { content: "• "; color: var(--bad); }
.timer { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 700; }
textarea { width: 100%; background: #111; color: var(--ink); border: 1px solid #333; border-radius: 10px; padding: 10px; font: inherit; }
.card { padding: 24px; border-radius: 20px; background: linear-gradient(135deg, #3b2a14, #8a5a2b); text-align: center; }
.tag { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; background: #000; border: 1px solid var(--accent); }
.pin img { width: 48px; height: 48px; border-radius: 50%; border: 3px solid var(--accent); box-shadow: 0 0 0 6px rgba(232,176,75,.25); }
.pin.preview img { border-color: #666; filter: grayscale(1); box-shadow: none; }
.zone { stroke: #e8b04b; fill: #e8b04b; fill-opacity: .08; } .you { stroke: #fff; fill: #3d8bfd; fill-opacity: 1; }
```

- [ ] **Step 6: Write `web/public/app.js` (shell + map + drop)**

```js
// DropQuest customer app. Vanilla JS; screens are <section class="screen"> toggled by show().
const $ = (sel) => document.querySelector(sel);
const st = { drops: [], drop: null, pos: null, res: null, clip: null, timer: null, attemptsLeft: null, durationMs: 0 };
const pounds = (pence) => `£${(pence / 100).toFixed(2)}`;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  if (id === "s-map") setTimeout(() => map.invalidateSize(), 0);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4000);
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? `Request failed (${res.status})`), { code: body.error });
  return body;
}

function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const li = (text, className = "") => Object.assign(document.createElement("li"), { textContent: text, className });

// "at venue (demo)" toggle, remembered per browser.
const debugBox = $("#debug");
try { debugBox.checked = localStorage.getItem("dq_debug") === "1"; } catch {}
debugBox.onchange = () => {
  try { localStorage.setItem("dq_debug", debugBox.checked ? "1" : "0"); } catch {}
  if (st.drop) renderDrop();
};

// Map
const map = L.map("map", { zoomControl: false }).setView([51.5237, -0.0785], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
let youDot = null;

function addPin(drop) {
  const icon = L.divIcon({ className: `pin ${drop.status}`, html: `<img src="${drop.image_url}" alt="">`, iconSize: [48, 48] });
  L.marker([drop.lat, drop.lng], { icon, title: drop.title }).addTo(map).on("click", () => openDrop(drop.id));
  L.circle([drop.lat, drop.lng], { radius: drop.radius_m, className: "zone" }).addTo(map);
}

async function refreshDrops() {
  st.drops = (await api("/api/drops")).drops;
}

async function boot() {
  try {
    await refreshDrops();
  } catch (e) {
    $("#loc-status").textContent = `Could not load drops: ${e.message}`;
    return;
  }
  st.drops.forEach(addPin);
  const live = st.drops.find((d) => d.status === "live");
  if (!live) return;
  map.setView([live.lat, live.lng], 16);
  // Reload recovery: jump back into an active hold/purchase window.
  const s = await api(`/api/drops/${live.id}/state`).catch(() => null);
  if (s?.reservation && ["held", "posted"].includes(s.reservation.status)) {
    st.drop = live;
    st.attemptsLeft = s.max_attempts - s.attempts_used;
    resume(s.reservation);
  }
}

navigator.geolocation?.watchPosition(
  (p) => {
    st.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    if (youDot) youDot.setLatLng([st.pos.lat, st.pos.lng]);
    else youDot = L.circleMarker([st.pos.lat, st.pos.lng], { radius: 8, className: "you" }).addTo(map);
    $("#loc-status").textContent = `You are here (±${Math.round(st.pos.acc)} m). Tap a drop.`;
    if (st.drop && !$("#s-drop").hidden) renderDrop();
  },
  () => ($("#loc-status").textContent = "Location is off. Tick “at venue (demo)” to try the drop."),
  { enableHighAccuracy: true, maximumAge: 60000 },
);

async function openDrop(id) {
  try {
    await refreshDrops();
  } catch (e) {
    return toast(e.message);
  }
  st.drop = st.drops.find((d) => d.id === id);
  st.attemptsLeft = null;
  renderDrop();
  show("s-drop");
  if (st.drop.status !== "live") return;
  try {
    const s = await api(`/api/drops/${id}/state`);
    st.attemptsLeft = s.max_attempts - s.attempts_used;
    if (s.reservation && s.reservation.status !== "expired") return resume(s.reservation);
    renderDrop();
  } catch (e) {
    toast(e.message);
  }
}

function lockReason() {
  const d = st.drop;
  if (d.status !== "live") return "Coming soon";
  if (d.available <= 0) return "Allocation full";
  if (st.attemptsLeft === 0) return "No attempts left";
  if (debugBox.checked) return null;
  if (!st.pos) return "Turn on location, or tick “at venue (demo)”";
  const m = distanceM(st.pos, d);
  return m > d.radius_m ? `Walk ${Math.round(m - d.radius_m)} m closer to unlock` : null;
}

function renderDrop() {
  const d = st.drop;
  $("#d-img").src = d.image_url;
  $("#d-title").textContent = d.title;
  $("#d-price").textContent = pounds(d.price_pence);
  $("#d-stock").textContent = d.status === "live" ? `${d.available} of ${d.allocation_total} left` : "Coming soon";
  $("#d-prompt").textContent = d.prompt;
  $("#d-facts").replaceChildren(...d.facts.map((f) => li(f)));
  $("#d-rubric").replaceChildren(...d.rubric.map((c) => li(c.label)));
  const why = lockReason();
  $("#d-start").disabled = Boolean(why);
  $("#d-why").textContent = why ?? (st.attemptsLeft == null ? "" : `${st.attemptsLeft} attempts left`);
}

// Filled in by later tasks.
function resume(reservation) {
  st.res = reservation;
}

boot();
```

- [ ] **Step 7: Tier 1 build**

Run: `cd web && bun build public/app.js --outdir=/tmp/dq-web`
Expected: exit 0.

- [ ] **Step 8: Tier 4 integration**

Run: `cd web && bun test integration.test.ts` → 4 pass.
Chrome checklist (`cd web && bun dev`, open http://localhost:5173):
1. Map shows 3 pins (1 gold, 2 grey) and the gold zone circle.
2. Tapping the gold pin opens the drop sheet with price £85.00, "3 of 3 left", prompt, 5 facts, 4 rubric lines.
3. With location denied or far away, Start is disabled with a reason. Ticking "at venue (demo)" enables it.
4. Grey pins show "Coming soon" and Start stays disabled.

- [ ] **Step 9: Commit + state**

```bash
git add web/public/index.html web/public/style.css web/public/app.js web/integration.test.ts
git commit -m "feat: complete T2.1.1 — web shell, map, drop sheet"
```
Set T2.1.1 `complete`, advance to T2.1.2.

---

### Task 2 (T2.1.2): Record, preview, review result

**Files:**
- Modify: `web/public/app.js` (insert before the `// Filled in by later tasks.` line)

**Interfaces:**
- Consumes: Task 1 helpers; `POST /api/drops/:id/attempts` (multipart) → `{ attempt, reservation, error }`.
- Produces: `startCamera()`, `showResult(body, err)`, `openShare()` (stub here, real in Task 3).

- [ ] **Step 1: Add the "submits multipart" test** to `web/integration.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to confirm the second new test fails**

Run: `cd web && bun test integration.test.ts`
Expected: "app.js sends the multipart fields" FAILS (no upload code yet).

- [ ] **Step 3: Insert the recording + review code into `web/public/app.js`**

```js
// Recording
const MIN_MS = 10000, MAX_MS = 20000, FRAME_EVERY_MS = 3000;
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let stream, recorder, chunks, frames, transcript, speech, startedAt, tick, frameTimer;

$("#d-start").onclick = () => {
  $("#r-prompt").textContent = st.drop.prompt;
  show("s-record");
  startCamera();
};

async function startCamera() {
  $("#r-go").hidden = false;
  $("#r-stop").hidden = true;
  $("#r-clock").textContent = "0s";
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 720, height: 1280 }, audio: true });
  } catch {
    $("#r-go").disabled = true;
    $("#r-note").textContent = "Camera or microphone is blocked. Allow both from the address bar, then reload.";
    return;
  }
  $("#r-live").srcObject = stream;
  $("#r-go").disabled = false;
  $("#r-note").textContent = SpeechRec ? "Speak clearly: Grok reads what you say." : "Speech capture needs Chrome. Grok will only see frames.";
}

function pickMime() {
  return ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

$("#r-go").onclick = () => {
  chunks = [];
  frames = [];
  transcript = "";
  recorder = new MediaRecorder(stream, { mimeType: pickMime() });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = finishRecording;
  if (SpeechRec) {
    speech = new SpeechRec();
    speech.lang = "en-GB";
    speech.continuous = true;
    speech.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) transcript += `${e.results[i][0].transcript} `;
    };
    speech.onend = () => recorder?.state === "recording" && speech.start(); // Chrome stops after silence
    speech.start();
  }
  startedAt = performance.now();
  recorder.start(1000);
  frameTimer = setInterval(() => frames.length < 4 && grabFrame(), FRAME_EVERY_MS);
  tick = setInterval(() => {
    const ms = performance.now() - startedAt;
    $("#r-clock").textContent = `${Math.floor(ms / 1000)}s`;
    $("#r-stop").disabled = ms < MIN_MS;
    if (ms >= MAX_MS) stopRecording();
  }, 200);
  $("#r-go").hidden = true;
  $("#r-stop").hidden = false;
  $("#r-stop").disabled = true;
};
$("#r-stop").onclick = () => stopRecording();

function stopRecording() {
  if (recorder?.state !== "recording") return;
  clearInterval(tick);
  clearInterval(frameTimer);
  st.durationMs = Math.round(performance.now() - startedAt);
  recorder.stop();
  speech?.stop();
}

function grabFrame() {
  const v = $("#r-live");
  if (!v.videoWidth) return;
  const scale = 512 / Math.max(v.videoWidth, v.videoHeight);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  c.toBlob((b) => b && frames.push(b), "image/jpeg", 0.8);
}

async function finishRecording() {
  await new Promise((r) => setTimeout(r, 800)); // let the last speech result arrive
  const type = recorder.mimeType || "video/webm";
  st.clip = { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm", frames: [...frames], transcript: transcript.trim(), durationMs: st.durationMs };
  $("#p-video").src = URL.createObjectURL(st.clip.blob);
  $("#p-transcript").textContent = st.clip.transcript || "(nothing heard, so speak up and retake)";
  show("s-preview");
}
$("#p-retake").onclick = () => {
  show("s-record");
  startCamera();
};

// Review
$("#p-submit").onclick = async () => {
  const c = st.clip;
  const f = new FormData();
  f.set("video", c.blob, `clip.${c.ext}`);
  c.frames.forEach((b, i) => f.set(`frame${i}`, b, `frame${i}.jpg`));
  f.set("transcript", c.transcript);
  f.set("duration_ms", String(c.durationMs));
  f.set("debug", debugBox.checked ? "1" : "0");
  if (st.pos) {
    f.set("lat", String(st.pos.lat));
    f.set("lng", String(st.pos.lng));
  }
  show("s-review");
  $("#rv-stage").textContent = "Uploading your clip…";
  const stage = setTimeout(() => ($("#rv-stage").textContent = "Grok is reviewing your styling idea…"), 1200);
  try {
    showResult(await api(`/api/drops/${st.drop.id}/attempts`, { method: "POST", body: f }));
  } catch (e) {
    showResult(null, e);
  } finally {
    clearTimeout(stage);
  }
};

const ruleLabel = (id) => st.drop.rubric.find((c) => c.id === id)?.label ?? id;
const NO_RETRY = ["ATTEMPTS_EXHAUSTED", "DROP_NOT_LIVE", "ALREADY_RESERVED"];

function showResult(body, err) {
  const a = body?.attempt;
  if (a?.verdict === "pass" && body.reservation) {
    st.res = body.reservation;
    toast("Qualified! Your item is held.");
    return openShare();
  }
  if (a && a.verdict !== "error") st.attemptsLeft = Math.max(0, (st.attemptsLeft ?? 3) - 1);
  $("#res-title").textContent = err ? "Couldn't submit" : a.verdict === "pass" ? "Qualified, but the allocation is full" : a.verdict === "error" ? "Grok is unavailable" : "Almost there";
  $("#res-feedback").textContent = err ? err.message : body.error === "ALREADY_RESERVED" ? "You already hold this drop." : a.feedback;
  $("#res-criteria").replaceChildren(...(a?.criteria ?? []).map((c) => li(`${ruleLabel(c.id)}: ${c.evidence}`, c.result)));
  const canRetry = st.attemptsLeft !== 0 && (err ? !NO_RETRY.includes(err.code) : a.verdict !== "pass");
  $("#res-retry").hidden = !canRetry;
  $("#res-retry").textContent = `Try again${st.attemptsLeft == null ? "" : ` (${st.attemptsLeft} left)`}`;
  $("#res-map").hidden = canRetry;
  show("s-result");
}
$("#res-retry").onclick = () => {
  show("s-record");
  startCamera();
};

// Replaced in Task 3.
function openShare() {
  show("s-share");
}
```

- [ ] **Step 4: Tier 1 build**

Run: `cd web && bun build public/app.js --outdir=/tmp/dq-web` → exit 0.

- [ ] **Step 5: Tier 4 integration**

Run: `cd web && bun test integration.test.ts` → 6 pass.
Chrome checklist (mock, "at venue (demo)" ticked):
1. Block the camera in site settings → message shown, Record disabled. Re-allow and reload.
2. In Safari (no speech API) the note says "Grok will only see frames". Recording still works.
3. Record 12 s while speaking → Stop enables at 10 s → preview plays and shows the transcript.
4. Submit → spinner stages → "Almost there" with feedback and 4 criteria (mock retry).
5. Try again → record → submit → share screen (mock pass).
6. A 20 s recording auto-stops.

- [ ] **Step 6: Commit + state**

```bash
git add web/public/app.js web/integration.test.ts
git commit -m "feat: complete T2.1.2 — record, transcript, frames, Grok result"
```

---

### Task 3 (T2.1.3): Share, "I posted", buy, done, reload recovery

**Files:**
- Modify: `web/public/app.js` (replace the Task 3 `openShare` stub and the Task 1 `resume` stub)

**Interfaces:**
- Consumes: `POST /api/reservations/:id/posted`, `POST /api/reservations/:id/buy` → `Reservation`; 409 `HOLD_EXPIRED` / `BAD_STATE`.
- Produces: `openShare()`, `openBuy()`, `openDone()`, `resume(reservation)`.

- [ ] **Step 1: Add the test** to `web/integration.test.ts`

```ts
test("app.js enforces the caption suffix and uses posted then buy", async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  expect(js).toContain("#ad #FleekDropQuest");
  expect(js.indexOf("/posted`")).toBeGreaterThan(-1);
  expect(js.indexOf("/buy`")).toBeGreaterThan(-1);
  const posted = await (await fetch(`${base}/api/reservations/1/posted`, { method: "POST" })).json();
  expect(posted.status).toBe("posted");
  expect((await (await fetch(`${base}/api/reservations/1/buy`, { method: "POST" })).json()).status).toBe("purchased");
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && bun test integration.test.ts` → the new test FAILS (no suffix in app.js).

- [ ] **Step 3: Replace the `openShare` stub (end of file) and delete the Task 1 `resume` stub, then append:**

```js
// Share, post, buy
const SUFFIX = "#ad #FleekDropQuest";
const withSuffix = (c) => (c.includes(SUFFIX) ? c.trim() : `${c.trim()} ${SUFFIX}`.trim());

function resume(reservation) {
  st.res = reservation;
  if (reservation.status === "held") return openShare();
  if (reservation.status === "posted") return openBuy();
  if (reservation.status === "purchased") return openDone();
}

function openShare() {
  const r = st.res;
  $("#sh-download").href = r.video_url;
  $("#sh-download").download = `dropquest-clip.${r.video_url.split(".").pop()}`;
  $("#sh-caption").value = r.caption;
  startTimer("#sh-timer");
  show("s-share");
}

$("#sh-copy").onclick = async () => {
  const caption = withSuffix($("#sh-caption").value);
  $("#sh-caption").value = caption;
  try {
    await navigator.clipboard.writeText(caption);
    toast("Caption copied");
  } catch {
    toast("Select the caption and copy it");
  }
};

$("#sh-posted").onclick = async () => {
  try {
    st.res = await api(`/api/reservations/${st.res.id}/posted`, { method: "POST" });
    openBuy();
  } catch (e) {
    onReservationError(e);
  }
};

function openBuy() {
  $("#b-title").textContent = st.drop.title;
  $("#b-price").textContent = pounds(st.res.price_pence);
  startTimer("#b-timer");
  show("s-buy");
}

$("#b-buy").onclick = async () => {
  $("#b-buy").disabled = true;
  try {
    st.res = await api(`/api/reservations/${st.res.id}/buy`, { method: "POST" });
    openDone();
  } catch (e) {
    onReservationError(e);
  } finally {
    $("#b-buy").disabled = false;
  }
};

function openDone() {
  clearInterval(st.timer);
  $("#dn-title").textContent = st.drop.title;
  show("s-done");
}

function onReservationError(e) {
  if (e.code === "HOLD_EXPIRED") return showExpired();
  toast(e.message);
}

function showExpired() {
  clearInterval(st.timer);
  $("#res-title").textContent = "Hold expired";
  $("#res-feedback").textContent = "The item went back into the drop.";
  $("#res-criteria").replaceChildren();
  $("#res-retry").hidden = true;
  $("#res-map").hidden = false;
  show("s-result");
}

// Countdown from the server's expires_at, so navigation or reload never resets it.
function startTimer(sel) {
  clearInterval(st.timer);
  const draw = () => {
    const ms = Date.parse(st.res.expires_at) - Date.now();
    if (ms <= 0) return showExpired();
    const s = Math.ceil(ms / 1000);
    $(sel).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  draw();
  st.timer = setInterval(draw, 1000);
}
```

Also move the `boot();` call to the very end of the file, so every function it may call is defined.

- [ ] **Step 4: Tier 1 build**

Run: `cd web && bun build public/app.js --outdir=/tmp/dq-web` → exit 0.

- [ ] **Step 5: Tier 4 integration**

Run: `cd web && bun test integration.test.ts` → 7 pass.
Chrome checklist (mock):
1. Share screen shows a ~10:00 timer counting down; Download link present.
2. Copy → clipboard caption ends `#ad #FleekDropQuest`.
3. I posted it → buy screen with ~5:00 timer; Buy → collectible card.
4. Reload recovery: temporarily edit `contracts/fixtures/drop-state.json` locally so `reservation` holds the `reservation-held.json` object with a future `expires_at`. Reload → app opens straight on the share screen. **Revert the fixture edit, do not commit it.**
5. Expiry: in DevTools console run `st.res.expires_at = new Date(Date.now() + 3000).toISOString()` → within 3 s "Hold expired" shows with no retry button.

- [ ] **Step 6: Commit + state**

```bash
git add web/public/app.js web/integration.test.ts
git commit -m "feat: complete T2.1.3 — share, I posted, buy, recovery"
```

---

### Task 4 (T2.2.1): Merchant dashboard

**Files:**
- Create: `web/public/dashboard.html`, `web/public/dashboard.js`

**Interfaces:**
- Consumes: `GET /api/dashboard`, `POST /api/demo/reset`.
- Produces: page at `http://localhost:5173/dashboard.html`.

- [ ] **Step 1: Add the test** to `web/integration.test.ts`

```ts
test("dashboard page and data are served", async () => {
  const html = await (await fetch(`${base}/dashboard.html`)).text();
  for (const id of ["stock", "funnel", "events", "reset"]) expect(html).toContain(`id="${id}"`);
  expect((await fetch(`${base}/dashboard.js`)).status).toBe(200);
  const d = await (await fetch(`${base}/api/dashboard`)).json();
  expect(Object.keys(d.stock)).toEqual(["total", "held", "posted", "sold", "available"]);
});
```

- [ ] **Step 2: Run it to confirm it fails** → `cd web && bun test integration.test.ts`, new test FAILS (404).

- [ ] **Step 3: Write `web/public/dashboard.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DropQuest Merchant</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    #dash { max-width: 960px; margin: 0 auto; padding: 16px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
    .tile { background: var(--panel); border-radius: 12px; padding: 14px; }
    .tile b { display: block; font-size: 32px; color: var(--accent); font-variant-numeric: tabular-nums; }
    .tile span { color: var(--muted); font-size: 13px; text-transform: capitalize; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td { padding: 6px 8px; border-bottom: 1px solid #2c2923; vertical-align: top; }
    td:last-child { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; }
  </style>
</head>
<body>
<main id="dash">
  <header class="bar"><strong>DropQuest</strong><span class="by">Fleek merchant view · Birkin 25 drop</span><span id="updated" class="by" style="margin-left:auto"></span></header>
  <h2>Stock</h2><div id="stock" class="tiles"></div>
  <h2>Funnel</h2><div id="funnel" class="tiles"></div>
  <h2>Grok and backend actions</h2><table><tbody id="events"></tbody></table>
  <p class="hint">Instagram posts are self-reported. Checkout is simulated. Reviews by xAI grok.</p>
  <button id="reset" class="link">Reset demo data</button>
</main>
<script src="/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `web/public/dashboard.js`**

```js
const $ = (sel) => document.querySelector(sel);
const el = (tag, props) => Object.assign(document.createElement(tag), props);

function tile(label, value) {
  const t = el("div", { className: "tile" });
  t.append(el("b", { textContent: value }), el("span", { textContent: label }));
  return t;
}

function row(e) {
  const tr = el("tr");
  for (const text of [new Date(e.at).toLocaleTimeString(), e.type.replaceAll("_", " "), JSON.stringify(e.detail)]) tr.append(el("td", { textContent: text }));
  return tr;
}

async function refresh() {
  try {
    const res = await fetch("/api/dashboard");
    if (!res.ok) throw new Error(res.statusText);
    const d = await res.json();
    $("#stock").replaceChildren(...Object.entries(d.stock).map(([k, v]) => tile(k, v)));
    $("#funnel").replaceChildren(...Object.entries(d.funnel).map(([k, v]) => tile(k, v)));
    $("#events").replaceChildren(...d.events.map(row));
    $("#updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch {
    $("#updated").textContent = "Backend unreachable, retrying…";
  }
}

$("#reset").onclick = async () => {
  if (!confirm("Delete all demo attempts, holds and purchases?")) return;
  await fetch("/api/demo/reset", { method: "POST" });
  refresh();
};

refresh();
setInterval(refresh, 3000);
```

- [ ] **Step 5: Tier 1 build** → `cd web && bun build public/dashboard.js --outdir=/tmp/dq-web`, exit 0.

- [ ] **Step 6: Tier 4 integration** → `cd web && bun test integration.test.ts`, 8 pass. Chrome: `/dashboard.html` shows 5 stock tiles, 5 funnel tiles, 5 events, and "Updated" changes every 3 s. Stop `bun dev` → "Backend unreachable" appears.

- [ ] **Step 7: Commit + state**

```bash
git add web/public/dashboard.html web/public/dashboard.js web/integration.test.ts
git commit -m "feat: complete T2.2.1 — merchant dashboard"
```

---

### Task 5 (T2.3.1): Web against the real backend

**Requires:** `feat/backend` merged to `main` (T1.1.2). Then in this worktree: `git rebase main`.

**Files:**
- Create: `web/live.check.ts` (named `.check.ts` so plain `bun test` never picks it up)

- [ ] **Step 1: Write `web/live.check.ts`**

```ts
// Starts the real backend (fake review) and the web proxy, then drives the flow through :5173.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "dq-live-"));
const backend = Bun.spawn([process.execPath, "server.ts"], {
  cwd: join(import.meta.dir, "../backend"),
  env: { ...process.env, PORT: "3905", DB_PATH: join(dir, "l.db"), UPLOADS_DIR: join(dir, "up"), REVIEW_MODE: "fake" },
  stdout: "ignore",
  stderr: "inherit",
});
const web = Bun.spawn([process.execPath, "dev.ts"], {
  cwd: import.meta.dir,
  env: { ...process.env, PORT: "5905", API_URL: "http://localhost:3905" },
  stdout: "ignore",
  stderr: "inherit",
});
const base = "http://localhost:5905";

function check(label: string, ok: boolean) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/drops`)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  const { drops } = await (await fetch(`${base}/api/drops`)).json();
  check("drops via proxy", drops[0].available === 3 && drops[0].title.includes("Birkin"));

  const f = new FormData();
  f.set("video", new File([new Uint8Array(2000)], "clip.webm", { type: "video/webm" }));
  f.set("frame0", new File([new Uint8Array(10)], "frame0.jpg", { type: "image/jpeg" }));
  f.set("transcript", "Beige trench, I'd carry it on my arm to show the gold hardware.");
  f.set("duration_ms", "15000");
  f.set("debug", "1");
  const body = await (await fetch(`${base}/api/drops/1/attempts`, { method: "POST", body: f })).json();
  check("multipart attempt through proxy passes", body.attempt?.verdict === "pass" && body.reservation?.status === "held");
  check("clip downloadable through proxy", (await fetch(base + body.reservation.video_url)).status === 200);

  const id = body.reservation.id;
  const early = await fetch(`${base}/api/reservations/${id}/buy`, { method: "POST" });
  check("buy before posted is 409", early.status === 409);
  check("posted", (await (await fetch(`${base}/api/reservations/${id}/posted`, { method: "POST" })).json()).status === "posted");
  check("bought", (await (await fetch(`${base}/api/reservations/${id}/buy`, { method: "POST" })).json()).status === "purchased");
  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  check("dashboard sold 1", dash.stock.sold === 1);
} finally {
  backend.kill();
  web.kill();
}
```

- [ ] **Step 2: Tier 1 build** → `cd web && bun build public/app.js public/dashboard.js --outdir=/tmp/dq-web`, exit 0.

- [ ] **Step 3: Tier 4 integration** → `cd web && bun live.check.ts`, 7 `ok` lines, exit 0.
Full demo rehearsal in Chrome: `(cd backend && bun dev)` and `(cd web && bun dev:live)`. Open http://localhost:5173 and http://localhost:5173/dashboard.html side by side. Run a retry clip, then a passing clip (real grok), the download, a real Instagram web upload, I posted, and Buy. The dashboard updates within 3 s. Note the real review time.
If Instagram web rejects the webm, check `pickMime()` picked mp4 in Chrome (`st.clip.ext` in the console).

- [ ] **Step 4: Commit + state**

```bash
git add web/live.check.ts
git commit -m "feat: complete T2.3.1 — web joined to real backend"
```
Set T2.3.1, T2.3, T2 `complete`. Tell the user the branch is ready: `git checkout main && git merge --no-ff feat/frontend`.

---

## State file (`tasks/frontend-state.json`, local-only)

```json
{
  "schema_version": "2.0",
  "last_updated": "2026-09-26T11:30:00Z",
  "current_task": "T2",
  "current_step": "T2.1",
  "current_stage": "T2.1.1",
  "tasks": { "T2": { "status": "pending", "steps": {
    "T2.1": { "status": "pending", "stages": { "T2.1.1": { "status": "pending" }, "T2.1.2": { "status": "pending" }, "T2.1.3": { "status": "pending" } } },
    "T2.2": { "status": "pending", "stages": { "T2.2.1": { "status": "pending" } } },
    "T2.3": { "status": "pending", "stages": { "T2.3.1": { "status": "pending" } } } } } },
  "postmortems": []
}
```
