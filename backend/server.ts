import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readJson, validateCampaign } from "./campaigns";
import { ApiError, buy, campaignDetail, claimHold, createAttempt, createCampaign, dashboard, dropState, getDrop, getReservation, listCampaigns, listDrops, markPosted, openDb, reset, saveReview, updateCampaign } from "./db";
import { draftChallenge, parseDraftInput } from "./draft";
import { errorReview, reviewAttempt, type Review } from "./review";

const UPLOADS = process.env.UPLOADS_DIR ?? "uploads";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// The web recorder auto-stops at 20 s but measures after the stop fires, so allow timer slack.
const MAX_DURATION_MS = 21_000;
if (process.env.REVIEW_MODE !== "fake" && !process.env.OPENAI_API_KEY)
  throw new Error("OPENAI_API_KEY is missing: put it in the repo-root .env and start with `bun dev`");
mkdirSync(UPLOADS, { recursive: true });
const db = openDb();

type Req = Request & { params: Record<string, string> };
const idOf = (req: Req) => Number(req.params.id);

function handle(fn: (req: Req) => Response | Promise<Response>) {
  return async (req: Req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.code, message: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "INTERNAL", message: "Something went wrong" }, { status: 500 });
    }
  };
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function toDataUrl(f: File) {
  return `data:${f.type || "image/jpeg"};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`;
}

async function postAttempt(req: Req) {
  const drop = getDrop(db, idOf(req));
  if (!drop) throw new ApiError(404, "NOT_FOUND", "No such drop");
  if (drop.status !== "live") throw new ApiError(409, "DROP_NOT_LIVE", "This drop is not live yet");
  const form = await req.formData().catch(() => null);
  const video = form?.get("video");
  if (!form || !(video instanceof File)) throw new ApiError(400, "BAD_REQUEST", "Missing video");
  if (video.size > MAX_VIDEO_BYTES) throw new ApiError(413, "TOO_LARGE", "Video is over 50 MB");
  const durationMs = Number(form.get("duration_ms"));
  if (!(durationMs >= 10_000 && durationMs <= MAX_DURATION_MS)) throw new ApiError(422, "BAD_DURATION", "Record between 10 and 20 seconds");
  if (form.get("debug") !== "1") {
    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    const inside = Number.isFinite(lat) && Number.isFinite(lng) && distanceM(lat, lng, drop.lat, drop.lng) <= drop.radius_m;
    if (!inside) throw new ApiError(403, "OUTSIDE_ZONE", "Get closer to the drop to enter");
  }
  const transcript = String(form.get("transcript") ?? "").slice(0, 4000);
  if (!transcript.trim()) throw new ApiError(400, "BAD_REQUEST", "We didn't catch any speech. Record again and talk us through your look.");
  const frames = [0, 1, 2, 3].map((i) => form.get(`frame${i}`)).filter((f): f is File => f instanceof File);
  const videoPath = `${crypto.randomUUID()}.${video.type.includes("mp4") ? "mp4" : "webm"}`;

  const attempt = createAttempt(db, { dropId: drop.id, videoPath, transcript, durationMs });
  let review: Review;
  try {
    await Bun.write(join(UPLOADS, videoPath), video);
    review = await reviewAttempt({ drop, transcript, frames: await Promise.all(frames.map(toDataUrl)) });
  } catch (e) {
    // Settle the attempt anyway: a verdict-less attempt would count as in-flight forever.
    console.error(e);
    review = errorReview("Could not process your clip");
  }
  saveReview(db, attempt.id, review);

  let reservation = null;
  let error = null;
  if (review.verdict === "pass") {
    const claimed = claimHold(db, drop, attempt.id, review.suggested_caption);
    if (typeof claimed === "string") error = claimed;
    else reservation = claimed;
  }
  return Response.json({ attempt: { id: attempt.id, n: attempt.n, ...review }, reservation, error });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 60 * 1024 * 1024,
  routes: {
    "/api/drops": { GET: handle(() => Response.json({ server_time: new Date().toISOString(), drops: listDrops(db) })) },
    "/api/drops/:id/state": { GET: handle((req) => Response.json(dropState(db, idOf(req)))) },
    "/api/drops/:id/attempts": { POST: handle(postAttempt) },
    "/api/reservations/:id": { GET: handle((req) => Response.json(getReservation(db, idOf(req)))) },
    "/api/reservations/:id/posted": { POST: handle((req) => Response.json(markPosted(db, idOf(req)))) },
    "/api/reservations/:id/buy": { POST: handle((req) => Response.json(buy(db, idOf(req)))) },
    "/api/dashboard": { GET: handle(() => Response.json(dashboard(db))) },
    "/api/demo/reset": {
      POST: handle(async (req) => {
        const body = (await req.json().catch(() => ({}))) as { allocation_total?: number };
        reset(db, body.allocation_total);
        return Response.json({ ok: true });
      }),
    },
    "/api/campaigns": {
      GET: handle(() => Response.json({ campaigns: listCampaigns(db) })),
      POST: handle(async (req) => Response.json(createCampaign(db, validateCampaign(await readJson(req))), { status: 201 })),
    },
    "/api/campaigns/draft": { POST: handle(async (req) => Response.json(await draftChallenge(parseDraftInput(await readJson(req))))) },
    "/api/campaigns/:id": {
      GET: handle((req) => Response.json(campaignDetail(db, idOf(req)))),
      PATCH: handle(async (req) => {
        const existing = getDrop(db, idOf(req));
        if (!existing) throw new ApiError(404, "NOT_FOUND", "No such campaign");
        const patch = await readJson(req);
        return Response.json(updateCampaign(db, existing.id, validateCampaign({ ...existing, ...patch })));
      }),
    },
    "/uploads/:file": {
      GET: handle(async (req) => {
        const file = Bun.file(join(UPLOADS, basename(decodeURIComponent(req.params.file))));
        if (!(await file.exists())) throw new ApiError(404, "NOT_FOUND", "No such file");
        return new Response(file);
      }),
    },
  },
  fetch: () => Response.json({ error: "NOT_FOUND", message: "No such route" }, { status: 404 }),
});
console.log(`backend on http://localhost:${server.port} (review: ${process.env.REVIEW_MODE === "fake" ? "fake" : "openai"})`);
