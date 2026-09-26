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
