# HotDrop — Pitch & Demo Screenplay

## One sentence

HotDrop turns limited drops into a creator game: find a drop on the map, film a 15-second styling take, get scored by an AI stylist, and if the brand picks you, you get a timed hold to buy it before anyone else, in exchange for posting your Reel.

## 30-second pitch

Hype drops are broken. The Birkin, the MoonSwatch and the Palace England shirt go to whoever refreshes fastest or runs a bot. Meanwhile brands pay a fortune for creator content that doesn't convert.

HotDrop flips it. Drops live on a map of London. To get one, you film a quick styling take. Our AI stylist scores it on outfit, styling, product knowledge, energy and video quality. The brand approves the best takes, highest score first. Winners get a 10-minute hold, post their Reel, and buy early.

Fans earn access by being creative, not fast. Brands get a launch campaign made by their own customers.

## 90-second pitch

Every limited drop ends the same way. The Birkin, the Snoopy MoonSwatch and the Palace England shirt sell out in seconds to bots and resellers, and the real fans who'd actually wear them get nothing. On the other side, brands spend huge budgets on influencer content that looks like an ad and doesn't sell.

HotDrop is a drop app where access is earned, not raced for.

You open the map and see live drops all over London: Hermès at Spitalfields, Arc'teryx at King's Cross, a Rolex Submariner in Hatton Garden. Pick one and you get a challenge: show your outfit, tell us how you'd style it, and mention a real detail from the drop card. You film 15 seconds in the app with the product as a sticker, or upload a clip you've already made.

Our AI stylist watches the frames and transcribes what you said. It scores you on five things: outfit, styling, product knowledge, energy and video quality. You see your score and your place in the queue straight away.

On the other side, the brand has HotDrop Studio. They see every take ranked by score, watch the video, and approve the ones they love. They can also switch on auto-review, set how brutal each metric should be with sliders, and write in plain English what they care about, and the stylist decides instantly.

The moment you're picked, stock is reserved for you. You post your Reel, marked #ad, and you get early access to buy before the public.

Fans win on taste, not bots. Brands get real customer content for every sale, and a leaderboard of their best advocates. That's HotDrop.

---

## Full demo screenplay (3:00 on stage)

### Setup (before you're called)

- **Browser A** (left half, narrow ~430px window): https://hotdrop-sigma.vercel.app/mobile. Location allowed.
- **Browser B** (right half): https://hotdrop-sigma.vercel.app/desktop, on the **Salomon XT-6** campaign (drop 4), scrolled to the **Review queue**.
- **Studio → Reset demo data.** Check that auto-review is **off** on the XT-6 campaign.
- Keep `~/Desktop/moonswatch-27s.mp4` ready for the upload fallback, and the landing page https://hotdrop-sigma.vercel.app in a spare tab.
- Open everything two minutes early to wake the backend. Screen recording on as a backup.

### 0:00 – 0:20 · The hook (landing page)

**On screen:** the landing page. The marker sweeps across "it's gone.", and the "Latest takes" feed rotates.

**Say:** "Every hype drop ends the same way: gone in seconds to bots. HotDrop makes you earn it instead. Let me show you as a fan, then as the brand."

**Do:** switch to Browser A.

### 0:20 – 0:45 · The map

**On screen:** the London map with clustered drop bubbles and your avatar.

**Say:** "These are live drops across London. Bags, watches, trainers, football shirts. They cluster when you zoom out and split when you zoom in."

**Do:** tap a cluster so it zooms and splits, then tap the **Salomon XT-6** pin. The drop sheet opens: photo, price, "6 of 6 left", how takes are scored, and the drop card.

**Say:** "Every drop has a challenge: show your fit, say how you'd style it, and mention a real detail. That's how you earn it."

### 0:45 – 1:20 · Record (or upload)

**Do:** tap **Start challenge**. The Reels-style camera opens with a 3-2-1 countdown. Drag the product sticker next to your face.

**Say into the camera (about 15 seconds):**
> "Okay — this is the drop of the year. Salomon XT-6, deadstock — look at this Black/Phantom colourway. Grey hoodie, black cargos, cap. I'd cuff the cargos so the Quicklace shows and throw a black shell on top."

**Point out:** the live captions, and the hint chips lighting up (Outfit, Styling, Drop-card detail).

**Do:** stop, then **Use this take →**.

*Fallback: if the camera or mic misbehaves, go to the MoonSwatch drop, tap **Upload video**, and pick `moonswatch-27s.mp4`. Say "you can also upload a clip you've already made."*

### 1:20 – 1:50 · The score

**On screen:** the queue screen. The score ring counts up, the five metric bars fill, and it shows "You're #1 in the queue".

**Say:** "Our AI stylist scored that take on five metrics: outfit, styling, product knowledge, energy and video quality. It also tells me how to improve. I'm now in the queue. The brand picks the best takes, highest score first."

### 1:50 – 2:25 · The brand side (Studio)

**Do:** switch to Browser B. The new take is at the top of the **Review queue** with its rank badge, score, bars and playable video.

**Say:** "This is HotDrop Studio. The brand sees every take ranked by score. They can watch it, read what was said, and approve the ones they love."

**Do:** click **Approve**.

**Do:** point at the **Auto-review** panel.

**Say:** "Or they switch on auto-review, set how brutal each metric should be, and write in plain English what matters to them. The stylist then decides instantly."

### 2:25 – 2:50 · Win and buy

**Do:** switch to Browser A. It has already advanced to the share screen with confetti and the 10-minute hold ring.

**Say:** "The moment I'm picked, stock is reserved for me. I download my clip, the caption already includes #ad, and I post my Reel."

**Do:** tap **I posted it**, then **Buy now**. The collectible card appears ("Yours. Officially.").

### 2:50 – 3:00 · Close

**Say:** "Fans win on taste, not bots. Brands get real customer content behind every sale. That's HotDrop."

### If something breaks

| Problem | Do |
| --- | --- |
| Low score or "Not picked" | Tap **Skip review (DEMO)** and keep going: "for time, I'll skip ahead." |
| No speech captured | **Skip review (DEMO)**, or use the MoonSwatch upload. |
| Approval doesn't show in the app | Wait 3 s (it checks every 3 s), or reload `/mobile`. It resumes the queue. |
| Backend slow or asleep | Play the backup screen recording. |
| "Allocation full" | Studio → **Reset demo data**. |

### Honest notes, if judges ask

- Instagram posting is self-reported in this demo, and checkout is simulated. Both are labelled in the app.
- Reviews use an OpenAI model: it transcribes the speech and scores the frames and transcript. The final score is calculated in code from the five metrics.
- Product photos are licensed stock stand-ins, and drop data is seeded demo data.
