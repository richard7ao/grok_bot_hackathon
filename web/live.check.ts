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
  env: { ...process.env, PORT: "5905", API_URL: "http://127.0.0.1:3905" },
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
