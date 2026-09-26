import { ApiError, type CampaignInput } from "./db";

const IMAGES = ["/img/birkin.svg", "/img/baguette.svg", "/img/flats.svg", "/img/jacket.svg", "/img/shell.svg", "/img/sneaker.svg", "/img/shirt.svg"];
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
