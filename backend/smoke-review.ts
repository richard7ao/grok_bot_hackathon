// Live check against real OpenAI review: a clear passing transcript and a clear retry transcript.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDrop, openDb } from "./db";
import { reviewAttempt } from "./review";

if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in the repo-root .env");
const drop = getDrop(openDb(join(mkdtempSync(join(tmpdir(), "dq-smoke-")), "s.db")), 1)!;

const cases = [
  { expect: "pass", transcript: "I'm in a beige trench and white jeans. I'd carry the Birkin in the crook of my arm so the gold-plated hardware catches the light." },
  { expect: "retry", transcript: "Hi, this is my video. Please give me the bag." },
];
let ok = true;
for (const c of cases) {
  const started = performance.now();
  const r = await reviewAttempt({ drop, transcript: c.transcript, frames: [] });
  const ms = Math.round(performance.now() - started);
  console.log(`${c.expect.toUpperCase()} case -> ${r.verdict} in ${ms} ms: ${r.feedback}`);
  if (r.verdict !== c.expect) ok = false;
}
process.exit(ok ? 0 : 1);
