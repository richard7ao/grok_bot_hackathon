// HotDrop customer app. Vanilla JS; screens are <section class="screen"> toggled by show().
// On Vercel, attempt uploads go straight to Render: Vercel's proxy caps request bodies at ~4.5 MB.
const UPLOAD_ORIGIN = "https://dropquest.onrender.com";
const uploadOrigin = () => (location.hostname.endsWith("vercel.app") ? UPLOAD_ORIGIN : "");
const $ = (sel) => document.querySelector(sel);
const st = { drops: [], drop: null, pos: null, res: null, clip: null, timer: null, attemptsLeft: null, durationMs: 0, pending: null, pollTimer: null, polling: false, waitScored: false };
const pounds = (pence) => (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: pence % 100 ? 2 : 0 });

// Quest step per screen, drawn as the stories-style bars under the header.
const STEP = { "s-map": 0, "s-drop": 1, "s-record": 2, "s-preview": 2, "s-review": 3, "s-wait": 3, "s-result": 3, "s-share": 4, "s-buy": 5, "s-done": 6 };

// Back navigation (button and browser/OS back) goes to a fixed parent screen. Review/wait have none.
const PARENT = { "s-drop": "s-map", "s-record": "s-drop", "s-preview": "s-record", "s-result": "s-drop", "s-share": "s-drop", "s-buy": "s-share", "s-done": "s-map" };
const CAM_SCREENS = ["s-record", "s-preview"];
let current = null;

// Motion: vanilla Motion (window.Motion, motion@11 UMD) for springs, Web Animations API for the rest
// and as the fallback when the CDN script is missing. Every effect is a no-op under reduced motion.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "cubic-bezier(.22,1,.36,1)";
function fx(node, keyframes, ms = 320, delay = 0) {
  if (REDUCED.matches || !node?.animate) return;
  node.animate(keyframes, { duration: ms, delay, easing: EASE_OUT, fill: "backwards" });
}
function springFx(node, keyframes) {
  if (REDUCED.matches || !node) return;
  if (window.Motion?.animate) return window.Motion.animate(node, keyframes, { type: "spring", stiffness: 520, damping: 22 });
  node.animate?.(keyframes, { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
}
const BLUR_IN = { opacity: [0, 1], filter: ["blur(6px)", "blur(0)"], transform: ["translateY(12px)", "none"] };
// 21st.dev "Animated List" / Magic UI stagger: children rise in 40 ms apart.
const staggerIn = (nodes, step = 40, from = 0) => [...nodes].slice(0, 10).forEach((n, i) => fx(n, BLUR_IN, 360, from + i * step));

// 21st.dev "Text Animate" (blur-in by word). textContent is unchanged; words become inline spans.
function textIn(node) {
  if (REDUCED.matches || !node?.textContent.trim()) return;
  const words = node.textContent.split(/(\s+)/);
  node.replaceChildren(...words.map((w) => (/^\s+$/.test(w) ? w : el("span", "word", w))));
  node.querySelectorAll(".word").forEach((w, i) => fx(w, { opacity: [0, 1], filter: ["blur(8px)", "blur(0)"], transform: ["translateY(6px)", "none"] }, 420, 60 + i * 55));
}

// 21st.dev "Number Ticker": count a price (in pence) up from 0.
function tickNumber(node, to, format, ms = 650) {
  node.textContent = format(to);
  if (REDUCED.matches) return;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    node.textContent = format(p < 1 ? Math.round((to * (1 - (1 - p) ** 3)) / 100) * 100 : to); // whole pounds while ticking
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Number Ticker digit roll: only the characters that changed slide down into place.
function rollText(node, text) {
  const prev = node.textContent;
  if (prev === text) return;
  if (REDUCED.matches || prev.length !== text.length) return (node.textContent = text);
  node.replaceChildren(...[...text].map((ch) => el("span", "digit", ch)));
  [...text].forEach((ch, i) => ch !== prev[i] && fx(node.children[i], { transform: ["translateY(-55%)", "none"], opacity: [0, 1] }, 260));
}

// Magic UI "Confetti": ~1 s DOM burst in brand ink, cobalt and grey, removed when done.
function confetti(origin) {
  if (REDUCED.matches) return;
  const r = (origin ?? document.body).getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 160);
  const colors = [COBALT, "#111", "#BDBDBD", COBALT];
  for (let i = 0; i < 36; i++) {
    const p = el("i", "confetti");
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % 4]}`;
    document.body.append(p);
    const a = (i / 36) * Math.PI * 2 + Math.random() * 0.3, v = 90 + Math.random() * 110;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v - 120, spin = Math.random() * 720 - 360;
    p.animate(
      [{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 }, { transform: `translate(${dx * 1.2}px,${dy + 260}px) rotate(${spin}deg)`, opacity: 0 }],
      { duration: 1000 + Math.random() * 250, easing: "cubic-bezier(.2,.7,.4,1)" },
    ).onfinish = () => p.remove();
  }
}

// Per-screen entrance: 21st.dev "Blur Fade" on the incoming screen, then its headline and cards.
const HEADLINES = { "s-drop": "#d-title", "s-result": "#res-title", "s-share": "#s-share h1, #s-share .ring-label .small", "s-done": "#s-done .yours" };
function enter(id) {
  const screen = document.getElementById(id);
  if (id === "s-map") return springFx($("#s-map .sheet"), { transform: ["translateY(100%)", "translateY(0%)"] }); // bottom sheet springs up
  if (CAM_SCREENS.includes(id)) return fx(screen, { opacity: [0, 1] }, 200);
  fx(screen, { opacity: [0, 1], filter: ["blur(6px)", "blur(0)"], transform: ["translateY(12px)", "none"] }, 320);
  staggerIn(screen.querySelectorAll(":scope > .card, :scope > .bubble, :scope > .held-row, :scope > .checklist, :scope > .polaroid, .pad > .prompt, .pad > .price"), 45, 90);
  if (HEADLINES[id]) document.querySelectorAll(HEADLINES[id]).forEach(textIn);
}

function show(id) {
  const from = current;
  current = id;
  if (from !== id) history.pushState({ id }, "");
  if (CAM_SCREENS.includes(from) && !CAM_SCREENS.includes(id)) releaseCamera();
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  document.querySelectorAll("#stories i").forEach((bar, i) => (bar.className = i < STEP[id] ? "on" : i === STEP[id] ? "half" : ""));
  $("#app").classList.toggle("cam", CAM_SCREENS.includes(id));
  if (id !== "s-preview") $("#p-video").pause();
  if (id === "s-map") setTimeout(() => map.resize(), 0);
  if (from !== id) enter(id);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4000);
}

function goBack() {
  let to = PARENT[current];
  if (current === "s-result" && $("#s-result").classList.contains("expired")) to = "s-map";
  if (!to) return current !== "s-map" && history.pushState({ id: current }, ""); // review in flight: stay put
  if (to === "s-share") return openShare();
  if (to === "s-drop") renderDrop();
  show(to);
  if (to === "s-record") startCamera();
}
window.addEventListener("popstate", goBack);

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
  if (e.target.closest("[data-back]")) goBack();
});

// opts.origin (optional) prefixes the path; only attempt uploads use it.
async function api(path, opts) {
  const res = await fetch((opts?.origin ?? "") + path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? `Request failed (${res.status})`), { code: body.error });
  return body;
}

function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const el = (tag, className = "", text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
const li = (text, className = "") => el("li", className, text);
const img = (src) => Object.assign(document.createElement("img"), { src, alt: "" });
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Map: MapLibre GL with the keyless OpenFreeMap Positron style.
const COBALT = "#1B5CFF";
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-0.1, 51.515],
  zoom: 10.5,
  minZoom: 9,
  maxBounds: [[-0.85, 51.2], [0.6, 51.8]], // loosely Greater London
  attributionControl: { compact: true },
});
const mapLoaded = new Promise((r) => map.once("load", r));
// Far out, show product images only (no price chips).
map.on("zoom", () => map.getContainer().classList.toggle("far", map.getZoom() < 12));
// "You" avatar: at your real position once located, otherwise approximately central London.
const APPROX_POS = { lat: 51.5145, lng: -0.127 };
const youLabel = el("span", "", "You (approx.)");
const youEl = el("div", "you");
const youAva = el("div", "ava");
youAva.append(Object.assign(img("/img/avatar.svg"), { alt: "You" }));
youEl.append(youAva, youLabel);
const youMarker = new maplibregl.Marker({ element: youEl, anchor: "bottom" }).setLngLat([APPROX_POS.lng, APPROX_POS.lat]).addTo(map);

function pinEl(drop) {
  const b = el("button", `pin ${drop.status}`);
  b.setAttribute("aria-label", drop.title);
  b.append(img(drop.image_url), el("span", "", drop.status === "live" ? pounds(drop.price_pence) : "soon"));
  b.onclick = () => openDrop(drop.id);
  return b;
}

// Clustered drops: a GeoJSON source does the clustering; each visible cluster/point gets a cached HTML marker.
const dropById = (id) => st.drops.find((d) => d.id === id);
function clusterEl({ cluster_id, point_count, live }, lngLat) {
  const b = el("button", `cluster${live ? " live" : ""}`);
  b.setAttribute("aria-label", `${point_count} drops`);
  const stack = el("span", "stack");
  const more = point_count > 3 ? [el("b", "", `+${point_count - 3}`)] : [];
  b.append(stack);
  const src = map.getSource("drops");
  src.getClusterLeaves(cluster_id, 3, 0).then((leaves) => stack.replaceChildren(...leaves.map((l) => img(dropById(l.properties.id)?.image_url ?? "")), ...more));
  b.onclick = async () => map.easeTo({ center: lngLat, zoom: await src.getClusterExpansionZoom(cluster_id) });
  return b;
}

let markers = new Map(); // "c<cluster_id>" | "d<drop id>" -> Marker
function syncMarkers() {
  if (!map.getSource("drops") || !map.isSourceLoaded("drops")) return;
  const next = new Map();
  for (const f of map.querySourceFeatures("drops")) {
    const p = f.properties;
    const key = p.cluster ? `c${p.cluster_id}` : `d${p.id}`;
    if (next.has(key)) continue;
    let m = markers.get(key);
    if (!m) {
      const drop = p.cluster ? null : dropById(p.id);
      if (!p.cluster && !drop) continue;
      const lngLat = drop ? [drop.lng, drop.lat] : f.geometry.coordinates; // tile geometry is quantised; pins use exact coords
      m = new maplibregl.Marker({ element: p.cluster ? clusterEl(p, lngLat) : pinEl(drop), anchor: "bottom" }).setLngLat(lngLat).addTo(map);
    }
    next.set(key, m);
  }
  markers.forEach((m, k) => next.has(k) || m.remove());
  markers = next;
}

async function drawDrops() {
  const data = {
    type: "FeatureCollection",
    features: st.drops.map((d) => ({ type: "Feature", geometry: { type: "Point", coordinates: [d.lng, d.lat] }, properties: { id: d.id, live: d.status === "live" ? 1 : 0 } })),
  };
  renderNear();
  renderTicker();
  await mapLoaded;
  map.addSource("drops", { type: "geojson", data, cluster: true, clusterRadius: 48, clusterMaxZoom: 14, clusterProperties: { live: ["+", ["get", "live"]] } });
  map.addLayer({ id: "drops-hidden", type: "circle", source: "drops", paint: { "circle-radius": 0, "circle-opacity": 0 } }); // keeps source tiles loaded for querySourceFeatures
  map.on("render", syncMarkers);
  fitMap(0);
}

// Magic UI "Marquee": live drops, then coming soon, as a seamless loop (two copies, track slides -50%).
const shortTitle = (d) => d.title.split(" — ")[0].replace(/^(Pre-loved|Vintage) /, "");
function renderTicker() {
  const live = st.drops.filter((d) => d.status === "live").map(shortTitle);
  const soon = st.drops.filter((d) => d.status !== "live").map(shortTitle);
  const text = ["LIVE NOW", ...live, ...(soon.length ? [`Coming soon: ${soon[0]}`, ...soon.slice(1)] : [])].join(" · ") + " · ";
  $("#ticker").replaceChildren(el("span", "", text), el("span", "", text));
}

// "Drops near you" row: live first (nearest first when located), then coming soon.
function renderNear() {
  const dist = (d) => (st.pos ? distanceM(st.pos, d) : 0);
  const sorted = [...st.drops].sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || dist(a) - dist(b));
  $("#near").replaceChildren(
    ...sorted.map((d) => {
      const b = el("button", `drop-card ${d.status}`);
      const tile = el("span", "tile");
      tile.append(img(d.image_url));
      const meta = d.status === "live" ? (st.pos ? `${fmtDist(dist(d))} away` : "Live now") : "Soon";
      b.append(tile, el("b", "", pounds(d.price_pence)), el("span", "brand", d.brand ?? ""), el("small", d.status, meta));
      b.onclick = () => openDrop(d.id);
      return b;
    }),
  );
}

// Fit the map to every drop across London, clear of the bottom sheet.
function fitMap(duration = 600) {
  const bounds = new maplibregl.LngLatBounds();
  st.drops.forEach((d) => bounds.extend([d.lng, d.lat]));
  const sheet = $("#s-map .sheet").offsetHeight || 240;
  map.fitBounds(bounds, { padding: { top: 70, bottom: sheet + 24, left: 36, right: 36 }, maxZoom: 15, duration });
}
$("#map-all").onclick = () => fitMap();
$("#map-me").onclick = () => map.flyTo({ center: youMarker.getLngLat(), zoom: 14 });

async function refreshDrops() {
  st.drops = (await api("/api/drops")).drops;
}

async function boot() {
  show("s-map");
  try {
    await refreshDrops();
  } catch (e) {
    $("#loc-status").textContent = `Could not load drops: ${e.message}`;
    return;
  }
  drawDrops();
  const live = st.drops.filter((d) => d.status === "live");
  // Reload while a take is in the queue: go back to s-wait and keep polling it.
  const pending = loadPending();
  const pendingDrop = st.drops.find((d) => d.id === pending?.drop_id);
  if (pending?.attempt_id != null && pendingDrop) {
    st.drop = pendingDrop;
    st.attemptsLeft = pending.attempts_left ?? null;
    return enterWait(pending);
  }
  // Reload recovery: jump back into an active hold/purchase window.
  const states = await Promise.all(live.map((d) => api(`/api/drops/${d.id}/state`).catch(() => null)));
  const i = states.findIndex((s) => s?.reservation && ["held", "posted"].includes(s.reservation.status));
  if (i < 0) return;
  st.drop = live[i];
  st.attemptsLeft = states[i].max_attempts - states[i].attempts_used;
  resume(states[i].reservation);
}

navigator.geolocation?.watchPosition(
  (p) => {
    st.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    youMarker.setLngLat([st.pos.lng, st.pos.lat]); // no auto-zoom: keep the London-wide view
    youLabel.textContent = "You";
    $("#loc-status").textContent = `Located (±${Math.round(st.pos.acc)} m). Tap a drop to see it.`;
    renderNear();
    if (st.drop && !$("#s-drop").hidden) renderDrop();
  },
  () => ($("#loc-status").textContent = "Location is off. You can still enter any live drop."),
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
  tickNumber($("#d-price"), st.drop.price_pence, pounds);
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
  return null;
}

function renderDrop() {
  const d = st.drop;
  $("#d-img").src = d.image_url;
  $("#s-drop").classList.toggle("live", d.status === "live");
  $("#d-brand").textContent = [d.brand ?? "Fleek", d.status === "live" ? "Live drop" : `Launches ${fmtDate(d.public_launch_at)}`, st.pos && `${fmtDist(distanceM(st.pos, d))} away`].filter(Boolean).join(" · ");
  $("#d-title").textContent = d.title;
  $("#d-desc").textContent = d.description ?? "";
  $("#d-price").textContent = pounds(d.price_pence);
  $("#d-stock").textContent = d.status === "live" ? `${d.available} of ${d.allocation_total} left` : "Coming soon";
  $("#d-prompt").textContent = d.prompt;
  $("#d-facts").replaceChildren(...d.facts.map((f) => li(f)));
  $("#d-rubric").replaceChildren(...d.rubric.map((c) => li(c.label)));
  const r = st.res, held = r?.drop_id === d.id && ["held", "posted"].includes(r.status) && Date.parse(r.expires_at) > Date.now();
  $("#d-hold").hidden = !held;
  $("#d-start").hidden = held;
  const why = lockReason();
  $("#d-start").disabled = Boolean(why);
  $("#d-why").textContent = why ?? (st.attemptsLeft == null ? "" : `${st.attemptsLeft} attempts left`);
}

// Recording
const MIN_MS = 10000, MAX_MS = 20000, FRAME_EVERY_MS = 3000;
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let stream, recorder, chunks, frames, transcript, speech, startedAt, tick, frameTimer;
const cam = { facing: "user", countdown: true, countTimer: null, aborted: false, raf: 0 };
// Product sticker, in fractions of the frame (centre x/y, width). Persists across retakes.
const stk = { on: true, failed: false, hinted: false, x: 0.6, y: 0.42, w: 0.34 };
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Rubric hint chips: a UX nudge from the live transcript, not validation (the AI decides).
const HINTS = {
  outfit: /\b(wearing|outfit|top|shirt|tee|jeans|trousers|hoodie|jacket|coat|trench|dress|skirt|trainers|sneakers|boots)\b/,
  styling: /\b(style|styled|styling|wear|pair|paired|pairing|carry|carrying|with)\b/,
};
function lightChips(text) {
  const said = text.toLowerCase();
  const words = new Set(said.match(/\p{L}+/gu) ?? []);
  const factWords = (st.drop?.facts ?? []).join(" ").toLowerCase().match(/\p{L}{5,}/gu) ?? [];
  const on = { outfit: HINTS.outfit.test(said), styling: HINTS.styling.test(said), detail: factWords.some((w) => words.has(w)) };
  document.querySelectorAll("[data-chip]").forEach((c) => {
    const lit = Boolean(on[c.dataset.chip]);
    if (lit && !c.classList.contains("on")) springFx(c, { transform: ["scale(.8)", "scale(1)"] }); // chip pops as it lights
    c.classList.toggle("on", lit);
  });
}

$("#d-start").onclick = () => {
  $("#r-prompt").textContent = st.drop.prompt;
  show("s-record");
  startCamera();
};

function resetRecordUI() {
  $("#s-record").classList.remove("recording");
  $("#r-go").hidden = false;
  $("#r-go").disabled = true;
  $("#r-stop").hidden = true;
  $("#r-min").hidden = true;
  $("#r-count").hidden = true;
  $("#r-clock").textContent = "0:00";
  $("#r-fill1").style.width = $("#r-fill2").style.width = "0%";
  $("#r-captions").textContent = "";
  lightChips("");
}

async function startCamera() {
  resetRecordUI();
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ video: { facingMode: cam.facing, width: 720, height: 1280 }, audio: true });
  } catch {
    $("#r-blocked").hidden = false;
    return;
  }
  $("#r-blocked").hidden = true;
  $("#r-live").srcObject = stream;
  $("#s-record").classList.toggle("selfie", cam.facing === "user");
  loadSticker();
  startCompositor();
  $("#r-go").disabled = false;
  $("#r-note").textContent = SpeechRec ? "Speak clearly: your stylist listens to what you say." : "Speech capture needs Chrome. Your stylist will only see frames.";
}

function stopCamera() {
  cancelAnimationFrame(cam.raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function pickMime() {
  return ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

// Shutter: optional 3-2-1 countdown, then record.
$("#r-go").onclick = () => {
  $("#r-go").disabled = true;
  if (!cam.countdown) return beginRecording();
  let n = 3;
  const draw = () => $("#r-count").replaceChildren(el("span", "", String(n))); // fresh node restarts the pop animation
  $("#r-count").hidden = false;
  draw();
  cam.countTimer = setInterval(() => {
    if (--n > 0) return draw();
    clearInterval(cam.countTimer);
    $("#r-count").hidden = true;
    beginRecording();
  }, 1000);
};

function beginRecording() {
  chunks = [];
  frames = [];
  transcript = "";
  cam.aborted = false;
  // Record the composited canvas (camera + sticker) plus the mic, so the sticker is burned in.
  const mixed = new MediaStream([...$("#r-canvas").captureStream(30).getVideoTracks(), ...stream.getAudioTracks()]);
  // Capped bitrate keeps a 20 s clip near 3 MB, under the ~4.5 MB request limit of the Vercel proxy.
  recorder = new MediaRecorder(mixed, { mimeType: pickMime(), videoBitsPerSecond: 1_100_000, audioBitsPerSecond: 96_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = finishRecording;
  if (SpeechRec) {
    speech = new SpeechRec();
    speech.lang = "en-GB";
    speech.continuous = true;
    speech.interimResults = true; // interim results only feed captions and hint chips
    speech.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += `${e.results[i][0].transcript} `;
        else interim += e.results[i][0].transcript;
      }
      const live = transcript + interim;
      $("#r-captions").textContent = live.length > 90 ? live.slice(-90).replace(/^\S*\s/, "") : live;
      lightChips(live);
    };
    speech.onend = () => recorder?.state === "recording" && speech.start(); // Chrome stops after silence
    speech.start();
  }
  startedAt = performance.now();
  recorder.start(1000);
  frameTimer = setInterval(() => frames.length < 4 && grabFrame(), FRAME_EVERY_MS);
  tick = setInterval(() => {
    const ms = performance.now() - startedAt;
    $("#r-clock").textContent = fmtClock(ms);
    $("#r-fill1").style.width = `${Math.min(1, ms / MIN_MS) * 100}%`;
    $("#r-fill2").style.width = `${Math.min(1, Math.max(0, (ms - MIN_MS) / (MAX_MS - MIN_MS))) * 100}%`;
    $("#r-stop").disabled = ms < MIN_MS;
    $("#r-min").hidden = ms >= MIN_MS;
    if (ms >= MAX_MS) stopRecording();
  }, 200);
  $("#s-record").classList.add("recording");
  $("#r-go").hidden = true;
  $("#r-stop").hidden = false;
  $("#r-stop").disabled = true;
  $("#r-min").hidden = false;
}
$("#r-stop").onclick = () => stopRecording();

function stopRecording() {
  if (recorder?.state !== "recording") return;
  clearInterval(tick);
  clearInterval(frameTimer);
  st.durationMs = Math.round(performance.now() - startedAt);
  recorder.stop();
  speech?.stop();
}

// Leaving the camera screens: abandon any take (no preview) and turn the camera off.
function releaseCamera() {
  clearInterval(cam.countTimer);
  if (recorder?.state === "recording") {
    cam.aborted = true;
    stopRecording();
  }
  stopCamera();
}
$("#r-retry").onclick = () => startCamera();

// Tool rail
const press = (btn, on) => btn.setAttribute("aria-pressed", String(on));
$("#r-flip").onclick = () => {
  if (recorder?.state === "recording") return;
  cam.facing = cam.facing === "user" ? "environment" : "user";
  stopCamera();
  startCamera();
};
$("#r-timer").onclick = () => {
  cam.countdown = !cam.countdown;
  press($("#r-timer"), cam.countdown);
  $("#r-timer-label").textContent = cam.countdown ? "3s" : "Off";
};
$("#r-hints").onclick = () => press($("#r-hints"), !($("#r-card").hidden = !$("#r-card").hidden));
$("#r-guide").onclick = () => press($("#r-guide"), !($("#r-guides").hidden = !$("#r-guides").hidden));

$("#r-sticker-toggle").onclick = () => {
  stk.on = !stk.on;
  press($("#r-sticker-toggle"), stk.on);
  syncSticker();
};

// Compositor: camera (object-fit: cover, mirrored for selfie) + sticker onto a canvas at the frame's aspect,
// 1280 px tall, so the on-screen canvas and the recording are the same picture.
function startCompositor() {
  const box = $("#s-record"), c = $("#r-canvas");
  c.height = 1280;
  c.width = box.clientHeight ? Math.min(720, Math.round((640 * box.clientWidth) / box.clientHeight) * 2) : 720;
  cancelAnimationFrame(cam.raf);
  const draw = () => {
    const v = $("#r-live"), g = c.getContext("2d");
    if (v.videoWidth && box.clientWidth) {
      const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight), w = v.videoWidth * s, h = v.videoHeight * s;
      g.save();
      if (cam.facing === "user") g.setTransform(-1, 0, 0, 1, c.width, 0);
      g.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
      g.restore();
      drawSticker(g, c.width / box.clientWidth);
    }
    cam.raf = requestAnimationFrame(draw);
  };
  draw();
}

// Mirrors the DOM sticker: 4px white border, 16px radius, soft shadow, -4deg tilt. k = canvas px per CSS px.
function drawSticker(g, k) {
  const im = $("#r-sticker-img"), c = g.canvas;
  if (!stk.on || stk.failed || !im.naturalWidth) return;
  const b = 4 * k, r = 16 * k, w = stk.w * c.width, iw = w - 2 * b, ih = (iw * im.naturalHeight) / im.naturalWidth, h = ih + 2 * b;
  g.save();
  g.translate(stk.x * c.width, stk.y * c.height);
  g.rotate((-4 * Math.PI) / 180);
  Object.assign(g, { shadowColor: "rgba(0,0,0,.35)", shadowBlur: 24 * k, shadowOffsetY: 8 * k, fillStyle: "#fff" });
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.shadowColor = "transparent";
  g.beginPath();
  g.roundRect(-iw / 2, -ih / 2, iw, ih, r - b);
  g.clip();
  g.drawImage(im, -iw / 2, -ih / 2, iw, ih);
  g.restore();
}

function loadSticker() {
  const im = $("#r-sticker-img"), src = st.drop?.image_url;
  if (!src) return ((stk.failed = true), syncSticker());
  if (im.getAttribute("src") === src) return syncSticker();
  stk.failed = false;
  im.src = src;
}
$("#r-sticker-img").onload = () => {
  placeSticker();
  syncSticker();
  if (stk.hinted) return;
  stk.hinted = true;
  $("#r-sticker-hint").hidden = false;
  setTimeout(() => ($("#r-sticker-hint").hidden = true), 4000);
};
$("#r-sticker-img").onerror = () => ((stk.failed = true), syncSticker()); // record without it

function syncSticker() {
  $("#r-sticker").hidden = !stk.on || stk.failed;
  $("#r-sticker-toggle").hidden = stk.failed;
}

// Keep the sticker inside the frame, then position the DOM copy (the canvas reads stk directly).
function placeSticker() {
  const box = $("#s-record"), im = $("#r-sticker-img");
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  stk.w = clamp(stk.w, 0.15, 0.8);
  const hh = (stk.w * box.clientWidth * (im.naturalHeight / im.naturalWidth || 1)) / box.clientHeight / 2;
  stk.x = clamp(stk.x, stk.w / 2, 1 - stk.w / 2);
  stk.y = clamp(stk.y, hh, 1 - hh);
  Object.assign($("#r-sticker").style, { left: `${stk.x * 100}%`, top: `${stk.y * 100}%`, width: `${stk.w * 100}%` });
}

// Drag with one pointer, pinch with two, wheel to resize.
const touches = new Map();
let pinchDist = 0;
const sticker = $("#r-sticker");
sticker.onpointerdown = (e) => {
  sticker.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pinchDist = 0;
  $("#r-sticker-hint").hidden = true;
};
sticker.onpointermove = (e) => {
  const prev = touches.get(e.pointerId);
  if (!prev) return;
  const box = $("#s-record").getBoundingClientRect();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1) {
    stk.x += (e.clientX - prev.x) / box.width;
    stk.y += (e.clientY - prev.y) / box.height;
  } else {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) stk.w *= d / pinchDist;
    pinchDist = d;
  }
  placeSticker();
};
sticker.onpointerup = sticker.onpointercancel = (e) => {
  touches.delete(e.pointerId);
  pinchDist = 0;
};
sticker.onwheel = (e) => {
  e.preventDefault();
  stk.w *= Math.exp(-e.deltaY / 500);
  placeSticker();
};

// Frames for the AI come from the composited canvas, so the reviewer sees the sticker too.
function grabFrame() {
  const v = $("#r-canvas");
  if (!$("#r-live").videoWidth) return;
  const scale = 512 / Math.max(v.width, v.height);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(v.width * scale), height: Math.round(v.height * scale) });
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  c.toBlob((b) => b && frames.push(b), "image/jpeg", 0.8);
}

async function finishRecording() {
  recorder.stream.getVideoTracks().forEach((t) => t.stop()); // the canvas capture track
  await new Promise((r) => setTimeout(r, 800)); // let the last speech result arrive
  if (cam.aborted) return;
  const type = recorder.mimeType || "video/webm";
  const blob = new Blob(chunks, { type });
  st.clip = { blob, url: URL.createObjectURL(blob), ext: type.includes("mp4") ? "mp4" : "webm", frames: [...frames], transcript: transcript.trim(), durationMs: st.durationMs, source: "camera" };
  showPreview(st.clip.transcript || "(nothing heard in the browser, so we'll transcribe the audio when you submit)");
}

function showPreview(said) {
  $("#p-video").src = st.clip.url;
  $("#p-dur").textContent = fmtClock(st.clip.durationMs);
  const upload = st.clip.source === "upload";
  $("#p-heard").textContent = upload ? "We'll transcribe the audio when you submit." : "Your stylist will hear:";
  $("#p-transcript").textContent = said;
  $("#p-transcript").hidden = upload;
  show("s-preview");
  $("#p-video").play().catch(() => {
    $("#p-video").muted = true;
    $("#p-video").play().catch(() => {});
  });
}
// Upload: an existing video instead of a camera take. The server transcribes its audio on submit.
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const UPLOAD_MIN_MS = 3000;
const UPLOAD_MAX_MS = 90000;
const pickUpload = () => {
  if (recorder?.state === "recording") return;
  $("#r-file").value = "";
  $("#r-file").click();
};
$("#r-upload").onclick = pickUpload;
$("#r-upload-link").onclick = pickUpload;
$("#r-file").onchange = async () => {
  const file = $("#r-file").files[0];
  if (!file) return;
  if (!file.type.startsWith("video/")) return toast("That isn't a video. Pick an mp4, mov or webm file.");
  if (file.size > UPLOAD_MAX_BYTES) return toast("That video is over 50 MB. Trim it or pick a shorter one.");
  const url = URL.createObjectURL(file);
  const v = Object.assign(document.createElement("video"), { src: url, muted: true, playsInline: true, preload: "auto" });
  try {
    await once(v, "loadedmetadata");
    const durationMs = Math.round(v.duration * 1000);
    if (!(durationMs >= UPLOAD_MIN_MS)) throw new Error("That video is too short. Pick one between 3 and 90 seconds.");
    if (durationMs > UPLOAD_MAX_MS) throw new Error("That video is too long. Pick one between 3 and 90 seconds.");
    const clipFrames = [];
    for (const at of [0.2, 0.4, 0.6, 0.8]) {
      v.currentTime = v.duration * at;
      await once(v, "seeked");
      const b = await frameOf(v);
      if (b) clipFrames.push(b);
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    st.clip = { blob: file, url, ext: ["mp4", "webm", "mov"].includes(ext) ? ext : file.type.includes("webm") ? "webm" : "mp4", frames: clipFrames, transcript: "", durationMs, source: "upload" };
    releaseCamera();
    showPreview("");
  } catch (e) {
    URL.revokeObjectURL(url);
    toast(e.message || "We couldn't read that video. Try an mp4 file.");
  }
};
// Resolves on the event, rejects if the browser can't decode the file.
function once(el, ev) {
  return new Promise((resolve, reject) => {
    el.addEventListener(ev, resolve, { once: true });
    el.addEventListener("error", () => reject(new Error("We couldn't read that video. Try an mp4 file.")), { once: true });
  });
}
function frameOf(v) {
  const scale = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
}

$("#p-retake").onclick = () => {
  show("s-record");
  startCamera();
};

// Review
// demoPass: presenter-only skip; the server records a pass without running the review.
async function submitClip(demoPass = false) {
  const c = st.clip;
  const f = new FormData();
  f.set("video", c.blob, `clip.${c.ext}`);
  c.frames.forEach((b, i) => f.set(`frame${i}`, b, `frame${i}.jpg`));
  f.set("transcript", c.transcript);
  f.set("duration_ms", String(c.durationMs));
  f.set("source", c.source);
  if (demoPass) f.set("demo_pass", "1");
  show("s-review");
  const upload = c.source === "upload";
  $("#rv-stage").textContent = upload ? "Uploading your video…" : "Uploading your clip…";
  // The server transcribes uploads and silent camera takes before the stylist sees them.
  const later = upload || !c.transcript ? "Transcribing your video…" : "Sending it to the stylist…";
  const stage = setTimeout(() => ($("#rv-stage").textContent = later), 1200);
  let body;
  try {
    body = await api(`/api/drops/${st.drop.id}/attempts`, { method: "POST", body: f, origin: uploadOrigin() });
  } catch (e) {
    return showResult(null, e);
  } finally {
    clearTimeout(stage);
  }
  if (body.attempt.verdict !== "error" && !demoPass) st.attemptsLeft = Math.max(0, (st.attemptsLeft ?? 3) - 1);
  if (body.attempt.verdict === "pending") return enterWait({ attempt_id: body.attempt.id, drop_id: st.drop.id, attempts_left: st.attemptsLeft }, body);
  showResult(body);
}
$("#p-submit").onclick = () => submitClip(false);
$("#p-skip").onclick = () => submitClip(true);

// Queue: a pending take is scored and waits for the merchant's pick. We poll the attempt until it
// becomes pass (a hold was claimed) or retry (passed over). dq_pending survives a reload.
const POLL_MS = 3000;
const METRICS = [["outfit", "Outfit"], ["styling", "Styling"], ["product_detail", "Drop-card detail"], ["energy", "Energy"], ["quality", "Video quality"]];

function savePending(p) {
  try {
    if (p) localStorage.setItem("dq_pending", JSON.stringify(p));
    else localStorage.removeItem("dq_pending");
  } catch {}
}
function loadPending() {
  try {
    return JSON.parse(localStorage.getItem("dq_pending"));
  } catch {
    return null;
  }
}

function countUp(node, to, ms = 900) {
  node.textContent = String(to);
  if (REDUCED.matches) return;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    node.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Score ring (pathLength 100, so offset = 100 - score) plus one bar per metric; CSS transitions do the fill.
function drawScore(ring, num, list, a) {
  const score = a.score ?? 0;
  $(num).closest(".score-ring").setAttribute("aria-label", `Score ${score} out of 100`);
  $(list).classList.remove("filled");
  $(list).replaceChildren(
    ...METRICS.map(([key, label], i) => {
      const v = a.scores?.[key] ?? 0, row = li(""), bar = el("i"), fill = el("b");
      fill.style.cssText = `--w:${v * 10}%;transition-delay:${250 + i * 90}ms`;
      bar.append(fill);
      row.append(el("span", "", label), bar, el("em", "tnum", `${v}/10`));
      return row;
    }),
  );
  $(ring).style.strokeDashoffset = "100";
  countUp($(num), score);
  // Two frames later, so the screen is laid out and the ring and bars transition from empty.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $(ring).style.strokeDashoffset = String(100 - score);
    $(list).classList.add("filled");
  }));
}

function enterWait(p, body) {
  st.pending = p;
  st.waitScored = false;
  savePending(p);
  const frame = st.clip?.frames[0];
  $("#w-thumb").src = frame ? URL.createObjectURL(frame) : st.drop.image_url;
  $("#w-len").textContent = st.clip ? `▶ my take · 0:${String(Math.round(st.clip.durationMs / 1000)).padStart(2, "0")}` : "▶ my take";
  show("s-wait");
  clearInterval(st.pollTimer);
  st.pollTimer = setInterval(pollAttempt, POLL_MS);
  if (body) renderQueue(body.attempt);
  else pollAttempt(); // after a reload we have only the id
}

function renderQueue(a) {
  $("#w-rank").textContent = a.rank ? `You're #${a.rank} in the queue` : "You're in the queue";
  $("#w-feedback").textContent = a.feedback;
  $("#w-poll").textContent = "Checking for the merchant's pick";
  if (st.waitScored) return; // animate the score once, not on every poll
  st.waitScored = true;
  drawScore("#w-ring", "#w-score", "#w-metrics", a);
}

function stopWait() {
  clearInterval(st.pollTimer);
  st.pending = null;
  savePending(null);
}

async function pollAttempt() {
  const p = st.pending;
  if (!p || st.polling) return;
  st.polling = true;
  try {
    const body = await api(`/api/attempts/${p.attempt_id}`);
    if (st.pending !== p) return; // the demo skip resolved it meanwhile
    if (body.attempt.verdict === "pending") return renderQueue(body.attempt);
    stopWait();
    showResult(body);
  } catch (e) {
    if (st.pending !== p) return;
    if (e.code !== "NOT_FOUND") return ($("#w-poll").textContent = "Connection lost. Retrying…");
    stopWait();
    showResult(null, e);
  } finally {
    st.polling = false;
  }
}

// Demo only: a presenter approves the queued take as the merchant would.
$("#w-skip").onclick = async () => {
  const id = st.pending?.attempt_id;
  if (id == null) return;
  $("#w-skip").disabled = true;
  try {
    const body = await api(`/api/attempts/${id}/approve`, { method: "POST" });
    stopWait();
    showResult(body);
  } catch (e) {
    toast(e.message);
  } finally {
    $("#w-skip").disabled = false;
  }
};

const ruleLabel = (id) => st.drop.rubric.find((c) => c.id === id)?.label ?? id;
const NO_RETRY = ["ATTEMPTS_EXHAUSTED", "DROP_NOT_LIVE", "ALREADY_RESERVED"];

function showResult(body, err) {
  const a = body?.attempt;
  if (a?.verdict === "pass" && body.reservation) {
    st.res = body.reservation;
    toast("Passed. Your item is held.");
    openShare();
    return confetti($("#s-share .ring-wrap"));
  }
  $("#s-result").classList.remove("expired");
  $("#res-title").textContent = err ? "Couldn't submit" : a.verdict === "pass" ? "Qualified, but the allocation is full" : a.verdict === "error" ? "The reviewer is unavailable" : "Not picked this time";
  $("#res-feedback").textContent = err ? err.message : body.error === "ALREADY_RESERVED" ? "You already hold this drop." : a.feedback;
  $("#res-criteria").replaceChildren(...(a?.criteria ?? []).map((c) => li(`${ruleLabel(c.id)}: ${c.evidence}`, c.result)));
  const canRetry = st.attemptsLeft !== 0 && (err ? !NO_RETRY.includes(err.code) : a.verdict !== "pass");
  $("#res-retry").hidden = !canRetry;
  $("#res-retry").textContent = `Try again${st.attemptsLeft == null ? "" : ` (${st.attemptsLeft} left)`}`;
  $("#res-map").hidden = canRetry;
  // Demo only: lets a presenter force a pass on the attempt just shown.
  st.approveId = a?.verdict === "retry" || a?.verdict === "error" ? a.id : null;
  // No attempt was created (e.g. no speech caught): the demo button re-submits the same clip as a pass.
  st.skipResubmit = st.approveId == null && Boolean(err) && Boolean(st.clip) && !NO_RETRY.includes(err.code);
  $("#res-approve").hidden = st.approveId == null && !st.skipResubmit;
  $("#res-score").hidden = a?.score == null;
  show("s-result");
  if (a?.score != null) drawScore("#res-ring", "#res-score-n", "#res-metrics", a);
  staggerIn($("#res-criteria").children, 70, 260);
}
$("#res-approve").onclick = async () => {
  $("#res-approve").hidden = true;
  if (st.skipResubmit) return submitClip(true);
  try {
    showResult(await api(`/api/attempts/${st.approveId}/approve`, { method: "POST" }));
  } catch (e) {
    showResult(null, e);
  }
};
$("#res-retry").onclick = () => {
  show("s-record");
  startCamera();
};

// Share, post, buy
const SUFFIX = "#ad #HotDrop";
const withSuffix = (c) => (c.includes(SUFFIX) ? c.trim() : `${c.trim()} ${SUFFIX}`.trim());

function resume(reservation) {
  st.res = reservation;
  if (reservation.status === "held") return openShare();
  if (reservation.status === "posted") return openBuy();
  if (reservation.status === "purchased") return openDone();
}

function openShare() {
  const r = st.res;
  const src = st.clip?.url ?? r.video_url;
  $("#sh-download").href = src;
  $("#sh-download").download = `hotdrop-clip.${st.clip?.ext ?? r.video_url.split(".").pop()}`;
  $("#sh-reel").src = src;
  $("#sh-caption").value = r.caption;
  syncCaption();
  document.querySelectorAll("#sh-steps li").forEach((step) => step.classList.remove("done"));
  startTimer("#sh-timer", (st.drop.hold_minutes ?? 10) * 60000, "#sh-ring");
  show("s-share");
}

const tickStep = (id) => $(id).classList.add("done");
function syncCaption() {
  const c = $("#sh-caption").value;
  $("#sh-count").textContent = `${c.length} / 2200`;
  $("#sh-reel-cap").textContent = c.length > 70 ? `${c.slice(0, 70)}…` : c;
}
$("#sh-caption").oninput = syncCaption;
$("#sh-download").addEventListener("click", () => tickStep("#sh-step-dl"));
$("#sh-ig").addEventListener("click", () => tickStep("#sh-step-ig"));

async function copyCaption() {
  const caption = withSuffix($("#sh-caption").value);
  $("#sh-caption").value = caption;
  syncCaption();
  tickStep("#sh-step-copy");
  try {
    await navigator.clipboard.writeText(caption);
    toast("Caption copied");
  } catch {
    toast("Select the caption and copy it");
  }
}
$("#sh-copy").onclick = copyCaption;
$("#sh-copy-step").onclick = copyCaption;

$("#d-continue").onclick = () => resume(st.res);

$("#sh-posted").onclick = async () => {
  if (st.res.status === "posted") return openBuy(); // came back from buy
  try {
    st.res = await api(`/api/reservations/${st.res.id}/posted`, { method: "POST" });
    openBuy();
  } catch (e) {
    onReservationError(e);
  }
};

function openBuy() {
  const d = st.drop, price = pounds(st.res.price_pence);
  $("#b-img").src = d.image_url;
  $("#b-brand").textContent = d.brand ?? "";
  $("#b-title").textContent = d.title;
  $("#b-price").textContent = price;
  $("#b-launch").textContent = d.public_launch_at ? `Early access · public launch ${fmtDate(d.public_launch_at)}` : "Early access";
  $("#b-sum-item").textContent = d.title;
  $("#b-sum-price").textContent = price;
  $("#b-total").textContent = price;
  startTimer("#b-timer");
  show("s-buy");
}

$("#b-buy").onclick = async () => {
  $("#b-buy").disabled = true;
  try {
    st.res = await api(`/api/reservations/${st.res.id}/buy`, { method: "POST" });
    openDone();
    confetti($(".polaroid"));
  } catch (e) {
    onReservationError(e);
  } finally {
    $("#b-buy").disabled = false;
  }
};

function openDone() {
  clearInterval(st.timer);
  $("#dn-img").src = st.drop.image_url;
  $("#dn-title").textContent = st.drop.title;
  $("#dn-order").textContent = `HD-${String(st.res.id).padStart(5, "0")}`;
  drawPickupCode(st.res.id);
  show("s-done");
}

// QR-style placeholder: three finder squares plus a pattern seeded by the reservation id. Not scannable.
function drawPickupCode(seed) {
  let d = "";
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      const finder = (x < 8 && (y < 8 || y > 12)) || (x > 12 && y < 8);
      const r = Math.max(Math.abs(x - (x < 8 ? 3 : 17)), Math.abs(y - (y < 8 ? 3 : 17)));
      const on = finder ? r === 3 || r <= 1 : (Math.imul(x * 131 + y * 7919 + seed * 104729, 2654435761) >>> 16) & 1;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  $("#dn-qr path").setAttribute("d", d);
}

$("#dn-share").onclick = async () => {
  const text = `Got early access to the ${st.drop.title} on HotDrop. ${SUFFIX}`;
  try {
    if (navigator.share) await navigator.share({ title: "My HotDrop collectible", text });
    else {
      await navigator.clipboard.writeText(text);
      toast("Copied to share");
    }
  } catch (e) {
    if (e.name !== "AbortError") toast("Sharing isn't available here");
  }
};

function onReservationError(e) {
  if (e.code === "HOLD_EXPIRED") return showExpired();
  toast(e.message);
}

function showExpired() {
  clearInterval(st.timer);
  $("#s-result").classList.add("expired");
  $("#ex-line").textContent = `The ${st.drop.title.split(" — ")[0].replace(/^(Pre-loved|Vintage) /, "")} went back into the drop.`;
  $("#ex-others").replaceChildren(
    ...st.drops
      .filter((d) => d.status === "preview")
      .map((d) => {
        const b = el("button", "other");
        const text = el("span");
        text.append(el("b", "", d.title), el("small", "", `${d.brand ?? ""} · coming soon`));
        b.append(img(d.image_url), text);
        b.onclick = () => openDrop(d.id);
        const item = el("li");
        item.append(b);
        return item;
      }),
  );
  $("#res-retry").hidden = true;
  $("#res-map").hidden = false;
  $("#res-approve").hidden = true;
  show("s-result");
}

// Countdown from the server's expires_at, so navigation or reload never resets it.
// With a ring, its arc (pathLength 100) shows the share of totalMs left.
function startTimer(sel, totalMs, ring) {
  clearInterval(st.timer);
  const draw = () => {
    const ms = Date.parse(st.res.expires_at) - Date.now();
    if (ms <= 0) return showExpired();
    const s = Math.ceil(ms / 1000);
    rollText($(sel), fmtClock(s * 1000));
    $("#d-hold-time").textContent = fmtClock(s * 1000);
    if (ring) $(ring).style.strokeDashoffset = String(100 - Math.min(100, (ms / totalMs) * 100));
  };
  draw();
  st.timer = setInterval(draw, 1000);
}

boot();
