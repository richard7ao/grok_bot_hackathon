// HotDrop Studio: merchant campaigns, AI challenge draft, reviews.
// All API and user text goes through textContent; never parsed as HTML.
const PHOTOS = [["Birkin", "birkin"], ["Arc'teryx", "arcteryx"], ["Carhartt", "carhartt"], ["XT-6", "xt6"], ["Stone Island", "stoneisland"], ["Football", "football"], ["Baguette", "baguette"], ["Flats", "flats"]].map(([label, f]) => ({ label, src: `/img/photos/${f}.jpg` }));
const ILLUSTRATIONS = ["birkin", "baguette", "flats", "jacket", "shell", "sneaker", "shirt"].map((f) => ({ label: `${f} illustration`, src: `/img/${f}.svg` }));
const IMAGES = [...PHOTOS, ...ILLUSTRATIONS].map((i) => i.src);
const ACCENT = "#1B5CFF";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const STATUSES = ["draft", "preview", "live", "ended"];
const RUBRIC = [
  { id: "outfit", label: "Show or describe your current outfit" },
  { id: "styling_idea", label: "Say how you would style the item" },
  { id: "product_detail", label: "Mention one detail from the drop card" },
  { id: "suitable", label: "Keep it relevant and suitable" },
];
const EVENT_LABELS = {
  reviewed: "Grok reviewed an attempt",
  hold_claimed: "Hold claimed",
  posted: "Instagram post confirmed",
  purchased: "Purchased",
  expired: "Hold expired",
  hold_expired: "Hold expired",
  reset: "Demo data reset",
};
const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const state = { campaigns: [], filter: "all", openId: null, poll: null, editingId: null, image: IMAGES[0], facts: [], map: null, pin: null, fresh: false, prev: {}, seen: null };

// Motion: Web Animations API only (no library needed here); springs are CSS easings in studio.css.
// Every effect is a no-op under prefers-reduced-motion.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
const BLUR_IN = { opacity: [0, 1], filter: ["blur(6px)", "blur(0)"], transform: ["translateY(12px)", "none"] };
function fx(node, keyframes, ms = 340, delay = 0) {
  if (REDUCED.matches || !node?.animate) return;
  node.animate(keyframes, { duration: ms, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
}
// 21st.dev "Animated List": children rise in one after another.
const staggerIn = (nodes, step = 45, kf = BLUR_IN) => [...nodes].slice(0, 12).forEach((n, i) => fx(n, kf, 380, i * step));

// 21st.dev "Number Ticker": tween a count from its previous value to the new one.
function ticker(node, key, to) {
  const from = state.prev[key] ?? 0;
  state.prev[key] = to;
  node.textContent = String(to);
  if (REDUCED.matches || from === to || typeof to !== "number") return;
  const t0 = performance.now(), ms = 600;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    node.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function api(path, opts = {}) {
  const init = { ...opts, headers: opts.body ? { "content-type": "application/json" } : undefined };
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

// New image slots may not exist yet in this branch: fall back to a neutral placeholder.
function productImg(src) {
  const img = el("img");
  img.alt = "";
  img.onerror = () => img.replaceWith(el("span", "img-ph", "No image"));
  img.src = safeUrl(src);
  return img;
}

const safeUrl = (u) => (typeof u === "string" && /^(\/(?!\/)|https?:\/\/)/.test(u) ? u : "");
const price = (p) => gbp.format(p / 100);
const fmtDate = (iso) => (Number.isNaN(Date.parse(iso)) ? "—" : when.format(new Date(iso)));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2800);
}

function statusPill(status) {
  const s = el("span", `status ${STATUSES.includes(status) ? status : "draft"}`, status);
  return s;
}

/* ---------- Campaign list ---------- */

async function loadList() {
  try {
    const { campaigns } = await api("/api/campaigns");
    state.campaigns = campaigns;
    renderList();
  } catch (e) {
    toast(`Could not load campaigns: ${e.message}`, true);
  }
}

const matchesFilter = (c, f) => f === "all" || c.status === f || (f === "live" && c.status === "preview");

function renderList() {
  for (const tab of $("filters").querySelectorAll("button")) {
    const f = tab.dataset.filter;
    tab.classList.toggle("on", f === state.filter);
    tab.setAttribute("aria-selected", String(f === state.filter));
    const n = state.campaigns.filter((c) => matchesFilter(c, f)).length;
    tab.dataset.label ??= tab.textContent;
    tab.replaceChildren(tab.dataset.label, el("span", "count", n));
  }
  const shown = state.campaigns.filter((c) => matchesFilter(c, state.filter));
  $("campaign-grid").replaceChildren(...shown.map(card));
  staggerIn($("campaign-grid").children, 50);
  $("list-empty").hidden = shown.length > 0;
}

function card(c) {
  const s = c.stats || { attempts: 0, passed: 0, posted: 0, sold: 0 };
  const art = el("article", "camp card");
  art.tabIndex = 0;
  const media = el("div", "media");
  media.append(productImg(c.image_url), statusPill(c.status));

  const body = el("div", "camp-body");
  const head = el("div", "camp-head");
  const titles = el("div");
  titles.append(el("p", "eyebrow", c.brand), el("h3", null, c.title));
  head.append(titles, el("span", "price", price(c.price_pence)));

  const stock = el("div", "stock");
  const label = el("div", "stock-label");
  label.append(el("span", null, "Stock"), el("b", null, `${c.available} / ${c.allocation_total} available`));
  const bar = el("div", "bar");
  const fill = el("i");
  fill.style.width = `${pct(c.available, c.allocation_total)}%`;
  bar.append(fill);
  stock.append(label, bar);

  const mini = el("div", "mini-funnel");
  const max = Math.max(s.attempts, 1);
  for (const [k, v] of [["Attempts", s.attempts], ["Passed", s.passed], ["Posted", s.posted], ["Sold", s.sold]]) {
    const row = el("div", "mf-row");
    const track = el("div", "mf-track");
    const f = el("i");
    f.style.width = `${Math.max(pct(v, max), v ? 4 : 0)}%`;
    track.append(f);
    row.append(el("span", null, k), track, el("b", null, v));
    mini.append(row);
  }

  const actions = el("div", "actions");
  const open = el("button", "btn ghost sm", "Open");
  open.type = "button";
  open.onclick = (e) => (e.stopPropagation(), openDetail(c.id));
  const edit = el("button", "textbtn", "Edit");
  edit.type = "button";
  edit.onclick = (e) => (e.stopPropagation(), openEditor(c));
  actions.append(el("span", "small", c.public_launch_at ? `Launch ${fmtDate(c.public_launch_at)}` : ""), edit, open);

  body.append(head, stock, mini, actions);
  art.append(media, body);
  art.onclick = () => openDetail(c.id);
  art.onkeydown = (e) => e.key === "Enter" && e.target === art && openDetail(c.id);
  return art;
}

/* ---------- Views + navigation ---------- */

function showView(name) {
  const view = $(name === "list" ? "view-list" : "view-detail");
  if (view.hidden) fx(view, BLUR_IN, 320); // 21st.dev "Blur Fade" on view change
  $("view-list").hidden = name !== "list";
  $("view-detail").hidden = name !== "detail";
  $("crumb-leaf").hidden = name !== "detail";
  if (name !== "detail") {
    clearInterval(state.poll);
    state.openId = null;
  }
}

function setNav(name) {
  for (const a of document.querySelectorAll("#sidebar nav a")) a.classList.toggle("on", a.dataset.nav === name);
}

async function navigate(name) {
  setNav(name);
  if (name === "campaigns") {
    showView("list");
    return loadList();
  }
  if (state.openId == null) {
    const first = state.campaigns.find((c) => c.status === "live") || state.campaigns[0];
    if (!first) return toast("Create a campaign first");
    await openDetail(first.id);
    setNav(name);
  }
  $(name === "reviews" ? "reviews-head" : "analytics").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Campaign detail ---------- */

async function openDetail(id) {
  clearInterval(state.poll);
  state.openId = id;
  state.fresh = true; // first render of this campaign: grow bars and count up from 0
  state.prev = {};
  state.seen = null;
  setNav("campaigns");
  try {
    renderDetail(await api(`/api/campaigns/${id}`));
  } catch (e) {
    state.openId = null;
    return toast(`Could not open campaign: ${e.message}`, true);
  }
  showView("detail");
  state.openId = id;
  window.scrollTo({ top: 0 });
  state.poll = setInterval(poll, POLL_MS);
}

async function poll() {
  if (state.openId == null || poll.busy) return;
  poll.busy = true;
  const id = state.openId;
  try {
    const d = await api(`/api/campaigns/${id}`);
    if (id === state.openId) renderDetail(d);
  } catch (e) {
    $("d-sync").textContent = `Sync paused: ${e.message}`;
    $("d-sync").classList.add("bad");
  } finally {
    poll.busy = false;
  }
}

function renderDetail({ campaign: c, stats: s, reviews, events }) {
  state.detail = c;
  $("d-image").replaceChildren(productImg(c.image_url));
  $("d-brand").textContent = c.brand;
  $("d-title").textContent = c.title;
  $("d-status").replaceWith(Object.assign(statusPill(c.status), { id: "d-status" }));
  $("d-price").textContent = price(c.price_pence);
  $("d-launch").textContent = `Public launch ${fmtDate(c.public_launch_at)}`;
  $("crumb-leaf").textContent = c.title;
  $("d-sync").textContent = `Live · updated ${clock.format(new Date())}`;
  $("d-sync").classList.remove("bad");

  const kpis = [["Total stock", c.allocation_total], ["Held", s.held], ["Posted", s.posted], ["Sold", s.sold], ["Available", c.available]];
  $("kpis").replaceChildren(
    ...kpis.map(([k, v], i) => {
      const t = el("div", `kpi card${i === 4 ? " accent" : ""}`);
      const b = el("b");
      ticker(b, `kpi:${k}`, v);
      t.append(el("span", null, k), b);
      return t;
    }),
  );

  const steps = [["Attempts", s.attempts], ["Passed Grok", s.passed], ["Hold claimed", s.held], ["Posted", s.posted], ["Sold", s.sold]];
  $("funnel").replaceChildren(
    ...steps.map(([k, v], i) => {
      const row = el("div", "f-row");
      const track = el("div", "f-track");
      const fill = el("i");
      fill.style.width = `${Math.max(pct(v, steps[0][1]), v ? 3 : 0)}%`;
      track.append(fill);
      const conv = i === 0 ? "" : `${pct(v, steps[i - 1][1])}%`;
      const n = el("b");
      ticker(n, `funnel:${k}`, v);
      row.append(el("span", "f-label", k), track, n, el("span", "f-conv", conv));
      if (state.fresh) fx(fill, { transform: ["scaleX(0)", "scaleX(1)"] }, 700, 120 + i * 70); // bars grow from 0 on open
      return row;
    }),
  );

  const reviewKey = (r) => `r${r.attempt_id ?? r.n}`;
  const eventKey = (e) => `e${e.type}|${e.at}|${JSON.stringify(e.detail ?? {})}`;
  $("reviews").replaceChildren(...(reviews.length ? reviews.map((r) => withKey(review(r), reviewKey(r))) : [el("p", "empty", "No attempts yet. Reviews appear here as creators submit.")]));
  $("activity").replaceChildren(...(events.length ? events.map((e) => withKey(activity(e), eventKey(e))) : [el("li", "empty", "Nothing yet.")]));
  animateNew([...$("reviews").children, ...$("activity").children]);
  state.fresh = false;
}

const withKey = (node, key) => ((node.dataset.key = key), node);

// Animated List: stagger everything on open; on later polls only genuinely new ids slide in from the top.
function animateNew(nodes) {
  const keyed = nodes.filter((n) => n.dataset.key);
  if (!state.seen) {
    state.seen = new Set(keyed.map((n) => n.dataset.key));
    return staggerIn(nodes, 40);
  }
  const fresh = keyed.filter((n) => !state.seen.has(n.dataset.key));
  fresh.forEach((n, i) => (state.seen.add(n.dataset.key), fx(n, { opacity: [0, 1], transform: ["translateY(-14px)", "none"], filter: ["blur(4px)", "blur(0)"] }, 420, i * 60)));
}

function review(r) {
  const v = r.verdict ?? "pending";
  const box = el("article", "review card");
  const head = el("div", "rv-head");
  head.append(el("span", `verdict ${v}`, v), el("b", null, `Attempt #${r.n}`), el("span", "small", fmtDate(r.created_at)));
  const href = safeUrl(r.video_url);
  if (href) {
    const a = el("a", "clip", "Watch clip ↗");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    head.append(a);
  }
  box.append(head, el("p", "feedback", r.feedback));
  if (r.transcript) box.append(el("blockquote", null, r.transcript));
  return box;
}

function eventLabel({ type, detail = {} }) {
  if (type === "reviewed") return `Grok reviewed attempt ${detail.attempt_id ?? ""}${detail.verdict ? ` — ${detail.verdict}` : ""}`;
  const base = EVENT_LABELS[type] || String(type).replaceAll("_", " ").replace(/^./, (m) => m.toUpperCase());
  return detail.reservation_id ? `${base} · reservation ${detail.reservation_id}` : base;
}

function activity(ev) {
  const li = el("li", `ev ${ev.type}`);
  li.append(el("span", "dot"), el("span", "ev-label", eventLabel(ev)), el("time", "small", fmtDate(ev.at)));
  return li;
}

async function resetDemo() {
  if (!confirm("Reset demo data? Attempts, holds and sales are cleared.")) return;
  try {
    await api("/api/demo/reset", { method: "POST" });
    toast("Demo data reset");
    poll();
  } catch (e) {
    toast(`Reset failed: ${e.message}`, true);
  }
}

/* ---------- Editor ---------- */

function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function defaults() {
  const launch = new Date();
  launch.setDate(launch.getDate() + 7);
  launch.setHours(10, 0, 0, 0);
  return {
    brand: "Fleek", title: "", description: "", price_pence: 0, allocation_total: 3, image_url: IMAGES[0],
    lat: 51.5237, lng: -0.0785, radius_m: 150, hold_minutes: 10, prompt: "", facts: [], rubric: RUBRIC,
    status: "draft", public_launch_at: launch.toISOString(),
  };
}

function openEditor(c) {
  const d = c || defaults();
  state.editingId = c ? c.id : null;
  $("ed-kicker").textContent = c ? "Edit campaign" : "New campaign";
  $("ed-title").textContent = c ? c.title : "Create a drop";
  $("save").textContent = c ? "Save changes" : "Create campaign";
  $("f-brand").value = d.brand;
  $("f-title").value = d.title;
  $("f-description").value = d.description;
  $("f-price").value = d.price_pence ? (d.price_pence / 100).toFixed(2) : "";
  $("f-stock").value = d.allocation_total;
  $("f-hold").value = d.hold_minutes;
  $("f-status").value = d.status;
  $("f-launch").value = toLocalInput(d.public_launch_at);
  $("f-lat").value = d.lat;
  $("f-lng").value = d.lng;
  $("f-radius").value = d.radius_m;
  $("f-prompt").value = d.prompt;
  state.image = IMAGES.includes(d.image_url) ? d.image_url : IMAGES[0];
  state.facts = [...d.facts];
  renderImages();
  renderFacts();
  renderRubric(d.rubric);
  $("draft-note").hidden = true;
  clearErrors();
  $("scrim").hidden = false;
  $("editor").classList.add("open");
  $("editor").setAttribute("aria-hidden", "false");
  setTimeout(() => (initMap(), $("f-title").focus()), 260);
}

function closeEditor() {
  $("editor").classList.remove("open");
  $("editor").setAttribute("aria-hidden", "true");
  $("scrim").hidden = true;
}

function renderImages() {
  $("image-picker").replaceChildren(
    ...PHOTOS.map(imageTile),
    el("span", "tiles-lbl", "Illustrations"),
    ...ILLUSTRATIONS.map(imageTile),
  );
}

function imageTile({ label, src }) {
  const b = el("button", src.endsWith(".jpg") ? "tile photo" : "tile");
  b.type = "button";
  b.setAttribute("aria-pressed", String(src === state.image));
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(productImg(src));
  b.onclick = () => ((state.image = src), renderImages());
  return b;
}

function renderFacts() {
  $("facts-list").replaceChildren(
    ...state.facts.map((f, i) => {
      const li = el("li", null, f);
      const x = el("button", "x", "×");
      x.type = "button";
      x.setAttribute("aria-label", `Remove ${f}`);
      x.onclick = () => ((state.facts = state.facts.filter((_, j) => j !== i)), renderFacts());
      li.append(x);
      return li;
    }),
  );
}

function addFact() {
  const input = $("fact-input");
  const v = input.value.trim();
  if (v && !state.facts.includes(v)) state.facts = [...state.facts, v];
  input.value = "";
  renderFacts();
}

function renderRubric(rubric) {
  const byId = Object.fromEntries((rubric || []).map((r) => [r.id, r.label]));
  $("rubric-list").replaceChildren(
    ...RUBRIC.map(({ id, label }) => {
      const row = el("label", "rb-row");
      const input = el("input");
      input.id = `rb-${id}`;
      input.value = byId[id] ?? label;
      row.append(el("code", null, id), input);
      return row;
    }),
  );
}

// Unlock zone as a 64-point polygon (equirectangular approximation, fine at city scale).
function circleGeo(lat, lng, r) {
  const pts = Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI;
    return [lng + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 110540];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} };
}

function readLocation() {
  const lat = Number($("f-lat").value), lng = Number($("f-lng").value), r = Number($("f-radius").value);
  const ok = $("f-lat").value !== "" && $("f-lng").value !== "" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return ok ? { lat, lng, r: r > 0 ? r : 150 } : null;
}

function initMap() {
  if (!window.maplibregl) return;
  const loc = readLocation() || { lat: 51.5237, lng: -0.0785, r: 150 };
  if (!state.map) {
    const map = new maplibregl.Map({ container: "editor-map", style: MAP_STYLE, center: [loc.lng, loc.lat], zoom: 15.2, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    state.pin = new maplibregl.Marker({ color: ACCENT }).setLngLat([loc.lng, loc.lat]).addTo(map);
    map.on("load", () => {
      map.addSource("zone", { type: "geojson", data: circleGeo(loc.lat, loc.lng, loc.r) });
      map.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": ACCENT, "fill-opacity": 0.12 } });
      map.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": ACCENT, "line-width": 1.5 } });
      syncMap(false);
    });
    map.on("click", (e) => {
      $("f-lat").value = e.lngLat.lat.toFixed(5);
      $("f-lng").value = e.lngLat.lng.toFixed(5);
      syncMap(false);
    });
    state.map = map;
  }
  state.map.resize();
  syncMap(true);
}

function syncMap(recenter) {
  const loc = state.map && readLocation();
  if (!loc) return;
  state.pin.setLngLat([loc.lng, loc.lat]);
  state.map.getSource("zone")?.setData(circleGeo(loc.lat, loc.lng, loc.r));
  if (recenter) state.map.jumpTo({ center: [loc.lng, loc.lat] });
}

/* ---------- Validation (mirrors CampaignInput in contracts/README.md) ---------- */

function collect() {
  const num = (id) => ($(id).value.trim() === "" ? NaN : Number($(id).value));
  const launch = new Date($("f-launch").value);
  return {
    brand: $("f-brand").value.trim(),
    title: $("f-title").value.trim(),
    description: $("f-description").value.trim(),
    price_pence: Math.round(num("f-price") * 100),
    allocation_total: num("f-stock"),
    image_url: state.image,
    lat: num("f-lat"),
    lng: num("f-lng"),
    radius_m: num("f-radius"),
    hold_minutes: num("f-hold"),
    prompt: $("f-prompt").value.trim(),
    facts: state.facts,
    rubric: RUBRIC.map(({ id }) => ({ id, label: $(`rb-${id}`).value.trim() })),
    status: $("f-status").value,
    public_launch_at: Number.isNaN(launch.getTime()) ? "" : launch.toISOString(),
  };
}

function validate(c) {
  const int = (v, min) => Number.isInteger(v) && v >= min;
  const checks = [
    [!c.brand, "f-brand", "Brand is required"],
    [!c.title, "f-title", "Title is required"],
    [!c.description, "f-description", "Description is required"],
    [!int(c.price_pence, 1), "f-price", "Price must be more than £0"],
    [!IMAGES.includes(c.image_url), "image-picker", "Pick an image"],
    [!int(c.allocation_total, 1), "f-stock", "Stock must be a whole number of at least 1"],
    [!int(c.hold_minutes, 1), "f-hold", "Hold must be a whole number of minutes"],
    [!STATUSES.includes(c.status), "f-status", "Pick a status"],
    [!c.public_launch_at, "f-launch", "Public launch date is required"],
    [!(Number.isFinite(c.lat) && Math.abs(c.lat) <= 90), "f-lat", "Latitude must be between -90 and 90"],
    [!(Number.isFinite(c.lng) && Math.abs(c.lng) <= 180), "f-lng", "Longitude must be between -180 and 180"],
    [!(Number.isFinite(c.radius_m) && c.radius_m > 0), "f-radius", "Radius must be more than 0 m"],
    [!c.prompt, "f-prompt", "Challenge prompt is required"],
    [c.facts.length === 0, "fact-input", "Add at least one drop-card fact"],
    [c.rubric.some((r) => !r.label), "rubric-list", "Every Grok check needs a label"],
  ];
  const hit = checks.find(([bad]) => bad);
  return hit ? { field: hit[1], message: hit[2] } : null;
}

function clearErrors() {
  $("form-error").hidden = true;
  for (const n of document.querySelectorAll("#campaign-form .invalid")) n.classList.remove("invalid");
}

function showError(message, field) {
  const box = $("form-error");
  box.textContent = message;
  box.hidden = false;
  const target = field && $(field);
  if (target) {
    target.classList.add("invalid");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// Server 400 messages name the field; highlight it when we can.
const FIELD_INPUTS = { brand: "f-brand", title: "f-title", description: "f-description", price_pence: "f-price", allocation_total: "f-stock", image_url: "image-picker", lat: "f-lat", lng: "f-lng", radius_m: "f-radius", hold_minutes: "f-hold", prompt: "f-prompt", facts: "fact-input", rubric: "rubric-list", status: "f-status", public_launch_at: "f-launch" };
const fieldFromMessage = (msg) => FIELD_INPUTS[Object.keys(FIELD_INPUTS).find((k) => msg.includes(k))];

async function save(e) {
  e.preventDefault();
  clearErrors();
  const body = collect();
  const bad = validate(body);
  if (bad) return showError(bad.message, bad.field);
  const editing = state.editingId;
  $("save").disabled = true;
  try {
    const opts = { method: editing == null ? "POST" : "PATCH", body: JSON.stringify(body) };
    const saved = editing == null ? await api("/api/campaigns", opts) : await api(`/api/campaigns/${editing}`, opts);
    closeEditor();
    toast(editing == null ? `“${saved.title}” created` : "Changes saved");
    if (state.openId != null && editing === state.openId) poll();
    else navigate("campaigns");
  } catch (err) {
    showError(err.status === 400 ? err.message : `Could not save: ${err.message}`, err.status === 400 ? fieldFromMessage(err.message) : null);
  } finally {
    $("save").disabled = false;
  }
}

async function draftWithAI() {
  const brand = $("f-brand").value.trim(), title = $("f-title").value.trim(), description = $("f-description").value.trim();
  clearErrors();
  if (!brand || !title || !description) return showError("Add a brand, title and description so the AI has something to work with", !brand ? "f-brand" : !title ? "f-title" : "f-description");
  const btn = $("draft-ai");
  btn.disabled = true;
  btn.textContent = "Drafting…";
  $("challenge").classList.add("shimmer");
  try {
    const d = await api("/api/campaigns/draft", { method: "POST", body: JSON.stringify({ brand, title, description, facts: state.facts }) });
    $("challenge").classList.remove("shimmer");
    $("f-prompt").value = d.prompt;
    fx($("f-prompt"), { opacity: [0, 1], filter: ["blur(6px)", "blur(0)"] }, 450); // fields blur in once drafted
    state.facts = [...d.facts];
    renderFacts();
    renderRubric(d.rubric);
    staggerIn($("facts-list").children, 50, { opacity: [0, 1], transform: ["scale(.85)", "none"], filter: ["blur(4px)", "blur(0)"] });
    staggerIn($("rubric-list").children, 70);
    $("draft-note").hidden = false;
  } catch (err) {
    showError(`AI draft failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Draft with AI";
    $("challenge").classList.remove("shimmer");
  }
}

/* ---------- Wiring ---------- */

for (const a of document.querySelectorAll("[data-nav]")) a.onclick = (e) => (e.preventDefault(), navigate(a.dataset.nav));
$("crumb-root").onclick = () => navigate("campaigns");
$("filters").onclick = (e) => {
  const b = e.target.closest("button[data-filter]");
  if (b) (state.filter = b.dataset.filter), renderList();
};
$("new-campaign").onclick = () => openEditor(null);
$("d-edit").onclick = () => state.detail && openEditor(state.detail);
$("reset-demo").onclick = resetDemo;
$("ed-close").onclick = closeEditor;
$("ed-cancel").onclick = closeEditor;
$("scrim").onclick = closeEditor;
document.addEventListener("keydown", (e) => e.key === "Escape" && $("editor").classList.contains("open") && closeEditor());
$("campaign-form").onsubmit = save;
$("draft-ai").onclick = draftWithAI;
$("fact-input").onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), addFact());
for (const id of ["f-lat", "f-lng", "f-radius"]) $(id).addEventListener("input", () => syncMap(id !== "f-radius"));

loadList();
