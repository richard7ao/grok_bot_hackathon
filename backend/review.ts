import type { Drop } from "./db";

export type Criterion = { id: string; result: "pass" | "fail" | "unknown"; evidence: string };
export type Review = { verdict: "pass" | "retry" | "error"; criteria: Criterion[]; feedback: string; suggested_caption: string | null };

const RESULTS = ["pass", "fail", "unknown"];

export function errorReview(reason: string): Review {
  return { verdict: "error", criteria: [], feedback: `${reason}. This try doesn't count, so submit again.`, suggested_caption: null };
}

// Code, not the model, decides the verdict: pass only when every rubric criterion passed.
export function parseReview(raw: unknown, rubricIds: string[]): Review {
  const r = raw as Partial<Review> | null;
  if (!r || !Array.isArray(r.criteria) || typeof r.feedback !== "string") return errorReview("Grok returned an unreadable review");
  const criteria = r.criteria
    .filter((c) => rubricIds.includes(c?.id) && RESULTS.includes(c?.result))
    .map((c) => ({ id: c.id, result: c.result, evidence: String(c.evidence ?? "") }));
  const allPass = rubricIds.every((id) => criteria.some((c) => c.id === id && c.result === "pass"));
  return {
    verdict: allPass ? "pass" : "retry",
    criteria,
    feedback: r.feedback,
    suggested_caption: allPass && typeof r.suggested_caption === "string" ? r.suggested_caption : null,
  };
}

// Deterministic stand-in for tests and offline work (REVIEW_MODE=fake): passes when the transcript
// mentions any 5+ letter word from a product fact.
function fakeReview(drop: Drop, transcript: string): Review {
  const words = drop.facts.flatMap((f) => f.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length >= 5);
  const said = transcript.toLowerCase();
  const detail = words.find((w) => said.includes(w));
  return parseReview(
    {
      criteria: drop.rubric.map((c) =>
        c.id === "product_detail"
          ? { id: c.id, result: detail ? "pass" : "unknown", evidence: detail ? `Mentions "${detail}".` : "No drop-card detail heard." }
          : { id: c.id, result: "pass", evidence: "Fake review." },
      ),
      feedback: detail ? "Great entry." : "Add one detail from the drop card, then submit again.",
      suggested_caption: detail ? "My take on the Fleek chore jacket." : null,
    },
    drop.rubric.map((c) => c.id),
  );
}

export async function reviewAttempt(input: { drop: Drop; transcript: string; frames: string[] }): Promise<Review> {
  if (process.env.REVIEW_MODE === "fake") return fakeReview(input.drop, input.transcript);
  return errorReview("Grok review is not wired yet"); // replaced in Task 2
}
