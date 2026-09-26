// Live check against real OpenAI review: a clear passing transcript and a clear retry transcript.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDrop, openDb } from "./db";
import { allScores, decide, reviewAttempt } from "./review";

if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in the repo-root .env");
const drop = getDrop(openDb(join(mkdtempSync(join(tmpdir(), "dq-smoke-")), "s.db")), 1)!;

// Same data-URL format as server.ts toDataUrl.
const frame = `data:image/jpeg;base64,${Buffer.from(await Bun.file(join(import.meta.dir, "smoke-frame.jpg")).arrayBuffer()).toString("base64")}`;

const cases = [
  { expect: "pass", transcript: "I'm in a beige trench and white jeans. I'd carry the Birkin in the crook of my arm so the gold-plated hardware catches the light.", frames: [frame, frame, frame, frame] },
  { expect: "retry", transcript: "Hi, this is my video. Please give me the bag.", frames: [] as string[] },
];
let ok = true;
for (const c of cases) {
  const started = performance.now();
  // Auto-review at the default thresholds, so the expected verdicts still hold.
  const r = decide(await reviewAttempt({ drop, transcript: c.transcript, frames: c.frames, scoringPrompt: "" }), { auto_review: true, thresholds: allScores(6), scoring_prompt: "" });
  const ms = Math.round(performance.now() - started);
  console.log(`${c.expect.toUpperCase()} case -> ${r.verdict} (score ${r.score}) in ${ms} ms: ${r.feedback}`);
  if (r.verdict !== c.expect) ok = false;
}
process.exit(ok ? 0 : 1);
