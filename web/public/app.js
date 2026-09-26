// DropQuest customer app. Vanilla JS; screens are <section class="screen"> toggled by show().
const $ = (sel) => document.querySelector(sel);
const st = { drops: [], drop: null, pos: null, res: null, clip: null, timer: null, attemptsLeft: null, durationMs: 0, pending: null, waitTimer: null };
const pounds = (pence) => (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: pence % 100 ? 2 : 0 });

// Quest step per screen, drawn as the stories-style bars under the header.
const STEP = { "s-map": 0, "s-drop": 1, "s-record": 2, "s-preview": 2, "s-review": 3, "s-wait": 3, "s-result": 3, "s-share": 4, "s-buy": 5, "s-done": 6 };

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  document.querySelectorAll("#stories i").forEach((bar, i) => (bar.className = i < STEP[id] ? "on" : i === STEP[id] ? "half" : ""));
  if (id === "s-map") setTimeout(() => map.resize(), 0);
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

const el = (tag, className = "", text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
const li = (text, className = "") => el("li", className, text);
const img = (src) => Object.assign(document.createElement("img"), { src, alt: "" });
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// "at venue (demo)" toggle, remembered per browser.
const debugBox = $("#debug");
try { debugBox.checked = localStorage.getItem("dq_debug") === "1"; } catch {}
debugBox.onchange = () => {
  try { localStorage.setItem("dq_debug", debugBox.checked ? "1" : "0"); } catch {}
  if (st.drop) renderDrop();
};

// Map: MapLibre GL with the keyless OpenFreeMap Positron style.
const COBALT = "#1B5CFF";
const map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/positron", center: [-0.1, 51.515], zoom: 12, attributionControl: { compact: true } });
let youDot = null;

// Drop zone as a 64-point polygon (flat-earth approximation, fine at 150 m).
function zoneRing(d, steps = 64) {
  const dLat = d.radius_m / 111320, dLng = dLat / Math.cos((d.lat * Math.PI) / 180);
  return Array.from({ length: steps + 1 }, (_, i) => [d.lng + dLng * Math.cos((i / steps) * 2 * Math.PI), d.lat + dLat * Math.sin((i / steps) * 2 * Math.PI)]);
}

function pinEl(drop) {
  const b = el("button", `pin ${drop.status}`);
  b.setAttribute("aria-label", drop.title);
  b.append(img(drop.image_url), el("span", "", drop.status === "live" ? pounds(drop.price_pence) : "soon"));
  b.onclick = () => openDrop(drop.id);
  return b;
}

function drawDrops() {
  st.drops.forEach((d) => new maplibregl.Marker({ element: pinEl(d), anchor: "bottom" }).setLngLat([d.lng, d.lat]).addTo(map));
  const features = st.drops.filter((d) => d.status === "live").map((d) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [zoneRing(d)] } }));
  const addZones = () => {
    map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: "zones", type: "fill", source: "zones", paint: { "fill-color": COBALT, "fill-opacity": 0.12 } });
    map.addLayer({ id: "zones-edge", type: "line", source: "zones", paint: { "line-color": COBALT, "line-width": 1.5, "line-dasharray": [2, 2] } });
  };
  if (map.isStyleLoaded()) addZones();
  else map.once("load", addZones);
  const bounds = new maplibregl.LngLatBounds();
  st.drops.forEach((d) => bounds.extend([d.lng, d.lat]));
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 60, bottom: 260, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
  renderNear();
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
      const meta = d.status === "live" ? (st.pos ? fmtDist(dist(d)) : "Live now") : "Soon";
      b.append(tile, el("b", "", pounds(d.price_pence)), el("span", "brand", d.brand ?? ""), el("small", d.status, meta));
      b.onclick = () => openDrop(d.id);
      return b;
    }),
  );
}

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
  // Reload during the review wait: go back to s-wait with the remaining time.
  const pending = loadPending();
  const pendingDrop = st.drops.find((d) => d.id === pending?.drop_id);
  if (pending?.body?.attempt && pendingDrop) {
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
    youDot ??= new maplibregl.Marker({ element: el("div", "you") }).setLngLat([st.pos.lng, st.pos.lat]).addTo(map);
    youDot.setLngLat([st.pos.lng, st.pos.lat]);
    $("#loc-status").textContent = `Located (±${Math.round(st.pos.acc)} m). Tap a drop to see it.`;
    renderNear();
    if (st.drop && !$("#s-drop").hidden) renderDrop();
  },
  () => ($("#loc-status").textContent = "Location is off. Tick “at venue (demo)” to try a drop."),
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
  $("#d-brand").textContent = `${d.brand ?? "Fleek"} · ${d.status === "live" ? "Live drop" : `Launches ${fmtDate(d.public_launch_at)}`}`;
  $("#d-title").textContent = d.title;
  $("#d-desc").textContent = d.description ?? "";
  $("#d-price").textContent = pounds(d.price_pence);
  $("#d-stock").textContent = d.status === "live" ? `${d.available} of ${d.allocation_total} left` : "Coming soon";
  $("#d-prompt").textContent = d.prompt;
  $("#d-facts").replaceChildren(...d.facts.map((f) => li(f)));
  $("#d-rubric").replaceChildren(...d.rubric.map((c) => li(c.label)));
  const why = lockReason();
  $("#d-start").disabled = Boolean(why);
  $("#d-why").textContent = why ?? (st.attemptsLeft == null ? "" : `${st.attemptsLeft} attempts left`);
}

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
  const blob = new Blob(chunks, { type });
  st.clip = { blob, url: URL.createObjectURL(blob), ext: type.includes("mp4") ? "mp4" : "webm", frames: [...frames], transcript: transcript.trim(), durationMs: st.durationMs };
  $("#p-video").src = st.clip.url;
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
  const stage = setTimeout(() => ($("#rv-stage").textContent = "Sending it to Grok…"), 1200);
  let body;
  try {
    body = await api(`/api/drops/${st.drop.id}/attempts`, { method: "POST", body: f });
  } catch (e) {
    return showResult(null, e);
  } finally {
    clearTimeout(stage);
  }
  if (body.attempt.verdict === "error") return showResult(body); // nothing to wait for
  st.attemptsLeft = Math.max(0, (st.attemptsLeft ?? 3) - 1);
  enterWait({ body, reveal_at: Date.now() + REVIEW_WAIT_MS, drop_id: st.drop.id, attempts_left: st.attemptsLeft });
};

// Review wait. The verdict is already in `body`; only its reveal is delayed (see the comment on #s-wait).
const REVIEW_WAIT_MS = 45000;
const WAIT_STAGES = ["Watching your clip…", "Reading what you said…", "Checking the drop card…", "Writing your notes…"];

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

function enterWait(p) {
  st.pending = p;
  savePending(p);
  const frame = st.clip?.frames[0];
  $("#w-thumb").src = frame ? URL.createObjectURL(frame) : st.drop.image_url;
  $("#w-len").textContent = st.clip ? `▶ my take · 0:${String(Math.round(st.clip.durationMs / 1000)).padStart(2, "0")}` : "▶ my take";
  $("#w-held").hidden = !p.body.reservation;
  show("s-wait");
  clearInterval(st.waitTimer);
  const draw = () => {
    const left = p.reveal_at - Date.now();
    if (left <= 0) return reveal();
    const done = Math.max(0, 1 - left / REVIEW_WAIT_MS);
    $("#w-bar").style.width = `${Math.max(3, done * 100)}%`;
    $("#w-stage").textContent = WAIT_STAGES[Math.min(WAIT_STAGES.length - 1, Math.floor(done * WAIT_STAGES.length))];
    const n = Math.ceil(Math.min(1, left / REVIEW_WAIT_MS) * 5);
    $("#w-queue").textContent = n > 1 ? `You're #${n} in the queue` : "You're next";
  };
  st.waitTimer = setInterval(draw, 500);
  draw();
}

function reveal() {
  clearInterval(st.waitTimer);
  const p = st.pending;
  if (!p) return;
  st.pending = null;
  savePending(null);
  showResult(p.body);
}
$("#w-skip").onclick = reveal;

const ruleLabel = (id) => st.drop.rubric.find((c) => c.id === id)?.label ?? id;
const NO_RETRY = ["ATTEMPTS_EXHAUSTED", "DROP_NOT_LIVE", "ALREADY_RESERVED"];

function showResult(body, err) {
  const a = body?.attempt;
  if (a?.verdict === "pass" && body.reservation) {
    st.res = body.reservation;
    toast("Passed. Your item is held.");
    return openShare();
  }
  $("#s-result").classList.remove("expired");
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
  const src = st.clip?.url ?? r.video_url;
  $("#sh-download").href = src;
  $("#sh-download").download = `dropquest-clip.${st.clip?.ext ?? r.video_url.split(".").pop()}`;
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

$("#sh-posted").onclick = async () => {
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
  $("#dn-order").textContent = `DQ-${String(st.res.id).padStart(5, "0")}`;
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
  const text = `Got early access to the ${st.drop.title} on Fleek DropQuest. ${SUFFIX}`;
  try {
    if (navigator.share) await navigator.share({ title: "My DropQuest collectible", text });
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
    $(sel).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (ring) $(ring).style.strokeDashoffset = String(100 - Math.min(100, (ms / totalMs) * 100));
  };
  draw();
  st.timer = setInterval(draw, 1000);
}

boot();
