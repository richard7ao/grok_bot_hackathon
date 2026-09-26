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

// Filled in by later tasks.
function resume(reservation) {
  st.res = reservation;
}

boot();
