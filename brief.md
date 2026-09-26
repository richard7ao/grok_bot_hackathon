# HotDrop — Handoff Brief

Written 26 Sep 2026, ~14:40 BST. **Code freeze 16:30, demos 17:30** (Grok Bot Commerce London hackathon at Fleek). Richard demos from his laptop in Chrome, not a phone. `Fleek-DropQuest-Astra-Brief.md` is the original product brief; this file replaces it as the current state.

## What it is

HotDrop is a Pokémon Go-style drop app. Shoppers find limited drops on a London map, record or upload a short styling video, an LLM scores it, the merchant approves the best takes in Studio, the approved shopper gets a timed hold, posts the clip to Instagram (self-reported), and buys early (simulated checkout).

- Target user: 23-year-old London student who makes Reels; unisex look inspired by Depop (white, black ink, Inter Tight 800, cobalt `#1B5CFF`). No Depop name, logo or red.
- The UI never says "Grok" or "AI". The reviewer is "your stylist" / "HotDrop Stylist".

## Live URLs

| What | URL |
| --- | --- |
| Landing | https://hotdrop-sigma.vercel.app |
| Shopper app | https://hotdrop-sigma.vercel.app/mobile |
| Merchant Studio | https://hotdrop-sigma.vercel.app/desktop |
| Backend (also serves the app) | https://dropquest.onrender.com |

- **Vercel** (project `hotdrop`, account `richardlao999-8485`) serves `web/public` statically and proxies `/api/*` and `/uploads/*` to Render (`web/vercel.json`, `routes`). It is **not git-connected**: redeploy with `cd web && vercel deploy --prod --yes`. Vercel caps proxied request bodies at ~4.5 MB, so video uploads from `*.vercel.app` go straight to Render (`UPLOAD_ORIGIN` in `app.js`, with CORS allowed by `CORS_ORIGINS` on the backend).
- **Render** service `srv-darr5m17lnhs73eh5p20` (workspace `tea-d8vva319rddc73ap7bl0`) builds the root `Dockerfile` from GitHub `richard7ao/grok_bot_hackathon` (public), branch `main`, **auto-deploy on push**. Env: `OPENAI_API_KEY` (secret), `OPENAI_MODEL=gpt-5.4-mini`, `DEMO_MODE=1`. SQLite and uploads live in `/tmp` in the container: **data resets on every deploy/restart**, and the 17 seed drops are rewritten on start.
- The Render API token is in `~/.render/cli.yaml` (the `render` CLI is logged in). The Vercel CLI is logged in.
- GitHub Action `keep-render-awake` pings the API every 5 min (GitHub's minimum) so the free tier doesn't sleep.

## Repo layout (`/Users/richardlao/Documents/GitHub/personal/grok_bot_hackathon`)

- `backend/`: Bun 1.4 + `bun:sqlite`.
  - `server.ts` (routes, CORS, demo gates), `db.ts` (schema, seed, holds, decisions), `review.ts` (OpenAI scoring + transcription), `draft.ts` (campaign auto-draft), `campaigns.ts` (validation), `integration.test.ts`.
- `web/`: static pages in `public/`.
  - `landing.html`; `index.html` + `app.js` = shopper app; `studio.html` + `studio.js` = Studio; `style.css`; `img/photos/*.jpg` with `CREDITS.md`.
  - `dev.ts` serves `/` → landing, `/mobile` → app, `/desktop` → Studio, and proxies `/api` to `API_URL`, or serves `contracts/fixtures` when `API_URL` is unset.
- `contracts/`: `README.md` is the API contract (v3 = scored takes and merchant approval, plus upload/transcription). `fixtures/*.json` are the mock responses; tests assert real responses match fixture keys.
- `docs/superpowers/specs|plans/`: original spec and plans, now outdated (they predate v3, the rename and upload). `docs/demo/`: older demo scripts that still say Grok/DropQuest.
- Deploy files: `Dockerfile`, `start.sh`, `render.yaml`, `web/vercel.json`, `.github/workflows/keepalive.yml`.

## Worktrees and branches

`main` (at `7fc4a82`, pushed and deployed) is checked out in the repo folder. Feature worktrees live beside it and are synced to `main`:

| Worktree | Branch |
| --- | --- |
| `../dropquest-backend` | `feat/backend` (runs the local backend on :3000 with `--watch`) |
| `../dropquest-web` | `feat/frontend` (runs the local web on :5173 with `--watch`) |
| `../dropquest-studio` | `feat/studio` |
| `../dropquest-photos` | `feat/photos` |

The flow so far:
1. Work on a branch.
2. `git merge --no-ff` into `main`, then push (Render redeploys).
3. `vercel deploy --prod` from `web/`.
4. `git merge --ff-only main` in each worktree.

Another Claude session has also merged into `main` (the landing page, `feat/landing`). Check `git log` first. If web tests fail oddly, it may be running tests on the same port (5901): run a copy of the test file with a different `PORT` constant.

## Running locally

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ../dropquest-backend/backend && bun run dev      # :3000, loads ../.env and .env (OpenAI key, DEMO_MODE=1)
cd ../dropquest-web/web && bun run dev:live         # :5173 → /, /mobile, /desktop, proxies to 127.0.0.1:3000
cd backend && bun test                              # 36 tests
cd web && bun test                                  # 33 tests (integration + studio)
```

Secrets are in gitignored `.env` files inside the worktrees. Never print or commit them. The xAI key has no credits, so reviews run on OpenAI.

## Current product state (all deployed)

- **Map:** MapLibre with OpenFreeMap positron tiles, clustered stacked-photo bubbles, "All drops" / "Near me", DiceBear avatar at your location.
  - 17 drops across London (11 live), with real Unsplash/Pexels photos.
  - Birkin 25 and Salomon XT-6 sit at the Fleek location (~51.5170, -0.0727).
  - MoonSwatch (id 9) is at Regent St; the Snoopy MoonSwatch (id 12) is at Covent Garden.
- **Record:** Reels-style camera, 3-2-1 countdown, 10–20 s, tool rail, live captions, hint chips, a draggable product sticker burned into the recording, bitrate capped.
- **Upload:** an **Upload video** option on the record screen (3–90 s, ≤ 50 MB). The browser extracts 4 frames, and the server transcribes the audio (`gpt-4o-mini-transcribe`, falling back to `whisper-1`) whenever the transcript is empty.
- **Scoring (contract v3):** the model scores 5 metrics 0–10 (outfit, styling, product_detail, energy, quality), and code computes the 0–100 score.
  1. The shopper sees the queue screen (score ring, bars, rank) and polls `GET /api/attempts/:id` every 3 s.
  2. The merchant approves in the Studio review queue (sorted by score), which claims a hold.
  3. The shopper moves on: share → "I posted it" → buy → done.
- **Auto-review:** set per campaign in Studio: an on/off switch, 5 Lenient↔Brutal threshold sliders and a scoring-prompt box. When it's on, takes pass or retry instantly.
- **Demo-only shortcuts** (only when `DEMO_MODE=1`): "Skip review" (preview, queue screen, after errors) and `POST /api/attempts/:id/approve`.
- **Studio:** campaign grid; create/edit with ✨ Auto-draft (the LLM writes the prompt, facts and checks); campaign detail with KPIs, funnel, review queue, auto-review panel and activity log; Reset demo data.
- **Polish:** back navigation everywhere, and a motion pass in the style of 21st.dev.

## Verified live

- Full v3 flow through Vercel, with a real model score: a take goes into the queue, Studio approves it, and it's held.
- Demo skip.
- `/`, `/mobile` and `/desktop` all serve.
- An upload of the 55 s Desktop video on a local backend was transcribed correctly. It scored low in that test because no frames were sent; in the browser, frames are sent.

## Next steps

1. Test the upload in the browser on the live Vercel app: MoonSwatch drop → Upload video → `~/Desktop/75432475127_Da26bsLRwhV.mp4` (55 s, 7.2 MB) or `~/Desktop/moonswatch-27s.mp4` (27.6 s, 2.5 MB) → queue → approve in Studio.
2. Do a full laptop rehearsal against the live link, then run Studio → Reset demo data before going on stage.
3. Optionally update `docs/demo/` scripts to say HotDrop and "stylist".

## Demo tips

- Open the Vercel link a minute early. It wakes Render, although the keep-alive should already have done so.
- A video line that passes, for the XT-6 (drop 4): "Okay — this is the drop of the year. Salomon XT-6, deadstock, never worn — look at this Black/Phantom colourway. Me? Grey hoodie, black cargos and a cap. I'd cuff the cargos so the Quicklace shows and throw a black shell on top. These never stay in stock." Say brand words slowly. Don't promise resale value, because the post is labelled #ad.
- Show the flow: record/upload → queue with score → Studio approves → shopper auto-advances to share with confetti → posted → buy → collectible. Then flip on auto-review in Studio to show instant decisions.

## Known issues and limits

- **No security for real use:** Studio endpoints have no auth, and `DEMO_MODE=1` lets anyone skip review. Set `DEMO_MODE=0` and add merchant auth after the hackathon.
- **Honest labels:** posting to Instagram is self-reported and checkout is simulated. Both are labelled in the UI.
- **Photos and brands:** photos are licensed stand-ins, some showing brand logos. Trademarks are a separate question from the photo licence.
- **Seed resets:** restarting the backend rewrites seed drops 1–17, which wipes Studio edits to them. Created campaigns persist until the next deploy.
- **Untested:** touch pinch on the sticker, and whether Instagram web accepts the recorded clip.
- **Skipped gates:** the global CLAUDE.md simplify and adversarial-review gates were skipped by user decision, for time.

## How Richard wants to work

- Replies as short as possible (caveman-style terse). Lead with the answer.
- Lazy/minimal solutions (ponytail): no new dependencies unless needed; reuse what exists.
- For big changes, run parallel subagents on separate worktrees, and tell running agents when `main` moves.
