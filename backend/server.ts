import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDecision, readJson, validateCampaign, validateReview } from "./campaigns";
import { ApiError, approveAttempt, attemptWithReservation, buy, campaignDetail, claimHold, createAttempt, createCampaign, dashboard, decideAttempt, dropState, getAttempt, getDrop, getReservation, listCampaigns, listDrops, markPosted, openDb, reset, reviewSettings, saveReview, updateCampaign, updateReviewSettings, type Attempt, type Drop } from "./db";
import { draftChallenge, parseDraftInput } from "./draft";
import { decide, demoPassReview, errorReview, reviewAttempt, type Review } from "./review";

const UPLOADS = process.env.UPLOADS_DIR ?? "uploads";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// The web recorder auto-stops at 20 s but measures after the stop fires, so allow timer slack.
const MAX_DURATION_MS = 21_000;
// Demo bypasses (demo_pass skip, POST /api/attempts/:id/approve) are opt-in: only DEMO_MODE=1 enables them.
const DEMO_MODE = process.env.DEMO_MODE === "1";
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
  const transcript = String(form.get("transcript") ?? "").slice(0, 4000);
  // Demo only: a presenter can skip the review; ignored unless DEMO_MODE=1.
  const demoPass = DEMO_MODE && form.get("demo_pass") === "1";
  if (!demoPass && !transcript.trim()) throw new ApiError(400, "BAD_REQUEST", "We didn't catch any speech. Record again and talk us through your look.");
  const frames = [0, 1, 2, 3].map((i) => form.get(`frame${i}`)).filter((f): f is File => f instanceof File);
  const videoPath = `${crypto.randomUUID()}.${video.type.includes("mp4") ? "mp4" : "webm"}`;

  const attempt = createAttempt(db, { dropId: drop.id, videoPath, transcript, durationMs });
  let review: Review;
  try {
    await Bun.write(join(UPLOADS, videoPath), video);
    const settings = reviewSettings(db, drop.id);
    review = demoPass
      ? demoPassReview(drop)
      : decide(await reviewAttempt({ drop, transcript, frames: await Promise.all(frames.map(toDataUrl)), scoringPrompt: settings.scoring_prompt }), settings);
  } catch (e) {
    // Settle the attempt anyway: a verdict-less attempt would count as in-flight forever.
    console.error(e);
    review = errorReview("Could not process your clip");
  }
  saveReview(db, attempt.id, review);
  return attemptResponse(drop, getAttempt(db, attempt.id));
}

// A pass claims the hold here; pending/retry/error hold nothing.
function attemptResponse(drop: Drop, attempt: Attempt) {
  let reservation = null;
  let error = null;
  if (attempt.verdict === "pass") {
    const claimed = claimHold(db, drop, attempt.id, attempt.suggested_caption);
    if (typeof claimed === "string") error = claimed;
    else reservation = claimed;
  }
  return Response.json({ attempt, reservation, error });
}

function approve(req: Req) {
  if (!DEMO_MODE) throw new ApiError(404, "NOT_FOUND", "No such route");
  const { drop, attempt } = approveAttempt(db, idOf(req));
  return attemptResponse(drop, attempt);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 60 * 1024 * 1024,
  routes: {
    "/api/drops": { GET: handle(() => Response.json({ server_time: new Date().toISOString(), drops: listDrops(db) })) },
    "/api/drops/:id/state": { GET: handle((req) => Response.json(dropState(db, idOf(req)))) },
    "/api/drops/:id/attempts": { POST: handle(postAttempt) },
    "/api/attempts/:id": { GET: handle((req) => Response.json(attemptWithReservation(db, idOf(req)))) },
    "/api/attempts/:id/approve": { POST: handle(approve) },
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
        const campaign = validateCampaign({ ...existing, ...patch });
        const review = patch.review === undefined ? null : validateReview(patch.review, reviewSettings(db, existing.id));
        if (review) updateReviewSettings(db, existing.id, review);
        return Response.json(updateCampaign(db, existing.id, campaign));
      }),
    },
    "/api/campaigns/:id/decisions": {
      POST: handle(async (req) => {
        const { attemptId, decision, note } = parseDecision(await readJson(req));
        const { drop, attempt } = decideAttempt(db, idOf(req), attemptId, decision, note);
        return attemptResponse(drop, attempt);
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
