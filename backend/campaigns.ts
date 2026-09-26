import { ApiError, type CampaignInput } from "./db";
import { MAX_SCORING_PROMPT, METRICS, type Metric, type ReviewSettings } from "./review";

const IMAGES = ["/img/birkin.svg", "/img/baguette.svg", "/img/flats.svg", "/img/jacket.svg", "/img/shell.svg", "/img/sneaker.svg", "/img/shirt.svg", "/img/photos/birkin.jpg", "/img/photos/arcteryx.jpg", "/img/photos/carhartt.jpg", "/img/photos/xt6.jpg", "/img/photos/stoneisland.jpg", "/img/photos/football.jpg", "/img/photos/baguette.jpg", "/img/photos/flats.jpg", "/img/photos/moonswatch.jpg", "/img/photos/england.jpg", "/img/photos/royalpop.jpg", "/img/photos/labubu.jpg", "/img/photos/rolex-sub.jpg", "/img/photos/rolex-datejust.jpg", "/img/photos/bambino.jpg", "/img/photos/tabby.jpg", "/img/photos/puzzle.jpg"];
const STATUSES = ["live", "preview", "draft", "ended"];
const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

const bad = (field: string, why: string) => new ApiError(400, "BAD_REQUEST", `${field} ${why}`);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "BAD_REQUEST", "Body must be a JSON object");
  return body as Record<string, unknown>;
}

// Validates a full CampaignInput (PATCH merges onto the stored campaign first); unknown keys are dropped.
export function validateCampaign(b: Record<string, unknown>): CampaignInput {
  for (const f of ["brand", "title", "description", "prompt"]) if (!isText(b[f])) throw bad(f, "must be a non-empty string");
  for (const f of ["price_pence", "allocation_total", "radius_m", "hold_minutes"])
    if (!Number.isInteger(b[f]) || (b[f] as number) <= 0) throw bad(f, "must be a positive integer");
  for (const f of ["lat", "lng"]) if (typeof b[f] !== "number" || !Number.isFinite(b[f])) throw bad(f, "must be a finite number");
  if (!IMAGES.includes(b.image_url as string)) throw bad("image_url", `must be one of ${IMAGES.join(", ")}`);
  if (!STATUSES.includes(b.status as string)) throw bad("status", `must be one of ${STATUSES.join(", ")}`);
  const facts = b.facts;
  if (!Array.isArray(facts) || !facts.length || !facts.every(isText)) throw bad("facts", "must be a non-empty array of non-empty strings");
  const rubric = b.rubric;
  if (
    !Array.isArray(rubric) || !rubric.length ||
    !rubric.every((c) => c && typeof c === "object" && typeof c.id === "string" && SLUG.test(c.id) && isText(c.label)) ||
    new Set(rubric.map((c) => c.id)).size !== rubric.length
  )
    throw bad("rubric", "must be a non-empty array of { id, label } with unique slug ids");
  const launch = typeof b.public_launch_at === "string" ? Date.parse(b.public_launch_at) : NaN;
  if (!Number.isFinite(launch)) throw bad("public_launch_at", "must be an ISO-8601 date");
  const text = (f: string) => (b[f] as string).trim();
  return {
    brand: text("brand"), title: text("title"), description: text("description"), prompt: text("prompt"),
    price_pence: b.price_pence as number, allocation_total: b.allocation_total as number, radius_m: b.radius_m as number,
    hold_minutes: b.hold_minutes as number, lat: b.lat as number, lng: b.lng as number, image_url: b.image_url as string,
    status: b.status as CampaignInput["status"], facts: (facts as string[]).map((f) => f.trim()),
    rubric: rubric.map((c) => ({ id: c.id as string, label: (c.label as string).trim() })), public_launch_at: new Date(launch).toISOString(),
  };
}

// PATCH review: Partial<ReviewSettings> merged onto the stored settings.
export function validateReview(raw: unknown, current: ReviewSettings): ReviewSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("review", "must be an object");
  const r = raw as Record<string, unknown>;
  const next = { ...current, thresholds: { ...current.thresholds } };
  if (r.auto_review !== undefined) {
    if (typeof r.auto_review !== "boolean") throw bad("review.auto_review", "must be a boolean");
    next.auto_review = r.auto_review;
  }
  if (r.thresholds !== undefined) {
    const t = r.thresholds;
    if (!t || typeof t !== "object" || Array.isArray(t)) throw bad("review.thresholds", "must be an object");
    for (const [k, v] of Object.entries(t)) {
      if (!(METRICS as readonly string[]).includes(k)) throw bad("review.thresholds", `has unknown metric ${k}; use ${METRICS.join(", ")}`);
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 10) throw bad(`review.thresholds.${k}`, "must be an integer 0–10");
      next.thresholds[k as Metric] = v as number;
    }
  }
  if (r.scoring_prompt !== undefined) {
    if (typeof r.scoring_prompt !== "string" || r.scoring_prompt.length > MAX_SCORING_PROMPT)
      throw bad("review.scoring_prompt", `must be a string of at most ${MAX_SCORING_PROMPT} characters`);
    next.scoring_prompt = r.scoring_prompt.trim();
  }
  return next;
}

export function parseDecision(b: Record<string, unknown>) {
  if (!Number.isInteger(b.attempt_id)) throw bad("attempt_id", "must be an integer");
  if (b.decision !== "approve" && b.decision !== "reject") throw bad("decision", "must be approve or reject");
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") throw bad("note", "must be a string");
  return { attemptId: b.attempt_id as number, decision: b.decision, note: typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "" };
}
