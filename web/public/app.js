// DropQuest customer app. Vanilla JS; screens are <section class="screen"> toggled by show().
const $ = (sel) => document.querySelector(sel);
const st = { drops: [], drop: null, pos: null, res: null, clip: null, timer: null, attemptsLeft: null, durationMs: 0 };
const pounds = (pence) => `£${(pence / 100).toFixed(2)}`;

// Quest step per screen, drawn as the stories-style bars under the header.
const STEP = { "s-map": 0, "s-drop": 1, "s-record": 2, "s-preview": 2, "s-review": 3, "s-result": 3, "s-share": 4, "s-buy": 5, "s-done": 6 };

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  document.querySelectorAll("#stories i").forEach((bar, i) => (bar.className = i < STEP[id] ? "on" : i === STEP[id] ? "half" : ""));
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

// Map: soft CartoDB Positron tiles, sage zone, deep-matcha pin.
const map = L.map("map", { zoomControl: false }).setView([51.5237, -0.0785], 16);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }).addTo(map);
let youDot = null;

function addPin(drop) {
  const html = document.createElement("span");
  html.append(Object.assign(document.createElement("img"), { src: drop.image_url, alt: "" }));
  const icon = L.divIcon({ className: `pin ${drop.status}`, html, iconSize: [48, 48], iconAnchor: [24, 58] });
  L.marker([drop.lat, drop.lng], { icon, title: drop.title }).addTo(map).on("click", () => openDrop(drop.id));
  if (drop.status === "live") L.circle([drop.lat, drop.lng], { radius: drop.radius_m, color: "#7FA66A", weight: 1, dashArray: "3 4", fillColor: "#7FA66A", fillOpacity: 0.14 }).addTo(map);
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
    else youDot = L.circleMarker([st.pos.lat, st.pos.lng], { radius: 7, color: "#fff", weight: 3, fillColor: "#4A78C2", fillOpacity: 1 }).addTo(map);
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

boot();
