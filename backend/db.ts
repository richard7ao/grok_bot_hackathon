import { Database } from "bun:sqlite";

export const MAX_ATTEMPTS = 3;
const PURCHASE_MS = Number(process.env.PURCHASE_MS ?? 300_000);
const CAPTION_SUFFIX = "#ad #HotDrop";
const RUBRIC_IDS = ["outfit", "styling_idea", "product_detail", "suitable"];
const DEFAULT_CAPTION = "My styling take on the Fleek drop.";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const dropsTable = (name: string) => `
create table if not exists ${name} (
  id integer primary key, title text not null, status text not null check (status in ('live','preview','draft','ended')),
  price_pence integer not null, image_url text not null, lat real not null, lng real not null,
  radius_m integer not null, prompt text not null, facts_json text not null, rubric_json text not null,
  allocation_total integer not null, brand text not null default '', description text not null default '',
  hold_minutes integer not null default 10, public_launch_at text not null default ''
);`;
const SCHEMA = `${dropsTable("drops")}
create table if not exists attempts (
  id integer primary key, drop_id integer not null references drops(id), n integer not null,
  video_path text not null, transcript text not null, duration_ms integer not null,
  verdict text check (verdict in ('pass','retry','error')), review_json text, created_at text not null,
  unique (drop_id, n)
);
create table if not exists reservations (
  id integer primary key, drop_id integer not null references drops(id), attempt_id integer not null references attempts(id),
  status text not null check (status in ('held','posted','purchased')), expires_at text not null,
  caption text not null, price_pence integer not null, posted_at text, purchased_at text
);
create table if not exists events (
  id integer primary key, at text not null, type text not null, detail_json text not null default '{}', drop_id integer
);`;
const V1_DROP_COLUMNS = "id,title,status,price_pence,image_url,lat,lng,radius_m,prompt,facts_json,rubric_json,allocation_total";

type DropRow = {
  id: number; title: string; status: DropStatus; price_pence: number; image_url: string;
  lat: number; lng: number; radius_m: number; prompt: string; facts_json: string; rubric_json: string;
  allocation_total: number; brand: string; description: string; hold_minutes: number; public_launch_at: string;
};
export type DropStatus = "live" | "preview" | "draft" | "ended";
export type CampaignInput = {
  brand: string; title: string; description: string; price_pence: number; allocation_total: number; image_url: string;
  lat: number; lng: number; radius_m: number; hold_minutes: number; prompt: string; facts: string[];
  rubric: { id: string; label: string }[]; status: DropStatus; public_launch_at: string;
};
type ReservationRow = {
  id: number; drop_id: number; attempt_id: number; status: "held" | "posted" | "purchased";
  expires_at: string; caption: string; price_pence: number; posted_at: string | null;
  purchased_at: string | null; video_path: string;
};

const now = () => new Date().toISOString();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
// ISO strings from toISOString() compare correctly as text.
const ACTIVE = `(r.status = 'purchased' or r.expires_at > ?)`;
const RESERVATION_SELECT = `select r.*, a.video_path from reservations r join attempts a on a.id = r.attempt_id`;

export function openDb(path = process.env.DB_PATH ?? "dropquest.db") {
  const db = new Database(path, { create: true });
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
  db.exec(SCHEMA);
  migrate(db);
  // Every boot, so seed edits (venue pin, copy) reach an existing dropquest.db.
  seedDrops(db);
  // Nothing is in flight at boot: settle attempts a restart cut off, so they stop counting.
  db.exec("update attempts set verdict = 'error' where verdict is null");
  return db;
}

// v1 databases: events lacks drop_id, and the drops status CHECK is too narrow. SQLite cannot alter a
// CHECK, so rebuild drops (create new, copy, drop, rename) with foreign keys off, per the SQLite docs.
function migrate(db: Database) {
  const cols = (table: string) => (db.query(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols("events").includes("drop_id")) db.exec("alter table events add column drop_id integer");
  if (cols("drops").includes("brand")) return;
  db.exec("pragma foreign_keys = off");
  db.transaction(() => {
    db.exec(dropsTable("drops_new"));
    db.exec(`insert into drops_new (${V1_DROP_COLUMNS}) select ${V1_DROP_COLUMNS} from drops`);
    db.exec("drop table drops; alter table drops_new rename to drops;");
  })();
  db.exec("pragma foreign_keys = on");
}

function seedDrops(db: Database) {
  const lat = Number(process.env.VENUE_LAT ?? 51.5243);
  const lng = Number(process.env.VENUE_LNG ?? -0.0746);
  const insert = db.query(
    `insert into drops (${V1_DROP_COLUMNS},brand,description,public_launch_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     on conflict(id) do update set title=excluded.title, status=excluded.status, price_pence=excluded.price_pence,
       image_url=excluded.image_url, lat=excluded.lat, lng=excluded.lng, radius_m=excluded.radius_m,
       prompt=excluded.prompt, facts_json=excluded.facts_json, rubric_json=excluded.rubric_json,
       brand=excluded.brand, description=excluded.description, public_launch_at=excluded.public_launch_at`,
  );
  // Mirrors contracts/fixtures/drops.json; drop 1 sits at the venue pin. Rubric labels map onto RUBRIC_IDS in order.
  const rows: [number, string, string, number, string, number, number, number, string, string[], string[], number, string, string, string][] = [
    [1, "Pre-loved Hermès Birkin 25 — Gold Togo", "live", 1850000, "/img/photos/birkin.jpg", lat, lng, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Birkin. Include one detail about it from the drop card.",
      ["Gold Togo leather", "Gold-plated hardware", "25 cm, the most wanted size", "Authenticated by Fleek", "Box and dust bag included"],
      ["Show or describe your current outfit", "Say how you would style the Birkin", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      3, "Fleek Luxe", "Three authenticated pre-loved Hermès Birkin 25s in Gold Togo, sourced from verified Fleek sellers.", "2026-10-03T10:00:00.000Z"],
    [2, "Vintage Arc'teryx Alpha SV — Made in Canada", "live", 42000, "/img/photos/arcteryx.jpg", 51.5129, -0.1389, 150, "Show your current outfit in a 15-second video, then tell us how you would style the shell. Include one detail about it from the drop card.",
      ["Gore-Tex Pro shell", "Made in Canada", "Helmet-compatible StormHood", "Black, size M", "Seams re-taped and checked"],
      ["Show or describe your current outfit", "Say how you would style the shell", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      5, "Fleek Outdoors", "Early-2010s Arc'teryx Alpha SV shells in Gore-Tex Pro, checked and seam-taped.", "2026-10-05T10:00:00.000Z"],
    [3, "Vintage Carhartt Detroit Jacket — Faded Brown Duck", "live", 18000, "/img/photos/carhartt.jpg", 51.5215, -0.0717, 150, "Show your current outfit in a 15-second video, then tell us how you would style the jacket. Include one detail about it from the drop card.",
      ["Faded brown duck canvas", "Blanket-lined body", "Corduroy collar", "Union-made tag, pre-2000", "Size L"],
      ["Show or describe your current outfit", "Say how you would style the jacket", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      8, "Fleek Workwear", "Blanket-lined Detroit jackets from the 90s, faded and broken in.", "2026-10-04T10:00:00.000Z"],
    [4, "Salomon XT-6 — Black/Phantom, Deadstock", "live", 19000, "/img/photos/xt6.jpg", 51.5117, -0.124, 150, "Show your current outfit in a 15-second video, then tell us how you would style the XT-6s. Include one detail about it from the drop card.",
      ["Deadstock, never worn", "Quicklace system", "Black/Phantom colourway", "UK 9", "Original box"],
      ["Show or describe your current outfit", "Say how you would style the XT-6s", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      6, "Fleek Sneakers", "Deadstock Salomon XT-6 trail runners, the gorpcore staple that keeps selling out.", "2026-10-06T10:00:00.000Z"],
    [5, "Stone Island Crinkle Reps Jacket — 2003", "preview", 52000, "/img/photos/stoneisland.jpg", 51.47, -0.069, 150, "Coming soon",
      [],
      [],
      0, "Fleek Archive", "Archive Stone Island Crinkle Reps with the badge intact.", "2026-10-12T10:00:00.000Z"],
    [6, "Arsenal 1990s Home Shirt — JVC", "preview", 14000, "/img/photos/football.jpg", 51.5415, -0.1463, 150, "Coming soon",
      [],
      [],
      0, "Fleek Football", "A 90s Arsenal home shirt with the JVC sponsor.", "2026-10-11T10:00:00.000Z"],
    [7, "Vintage Fendi Baguette — 1999 Monogram", "preview", 145000, "/img/photos/baguette.jpg", 51.5155, -0.2051, 150, "Coming soon",
      [],
      [],
      0, "Fleek Archive", "A 1999 Fendi Baguette in the original monogram canvas.", "2026-10-10T10:00:00.000Z"],
    [8, "Miu Miu Satin Ballet Flats — Blush", "preview", 79000, "/img/photos/flats.jpg", 51.5202, -0.1515, 150, "Coming soon",
      [],
      [],
      0, "Fleek Archive", "Blush satin Miu Miu ballet flats, barely worn.", "2026-10-17T10:00:00.000Z"],
    [9, "Omega x Swatch MoonSwatch — Mission to the Moon", "live", 26000, "/img/photos/moonswatch.jpg", 51.5115, -0.141, 150, "Show your current outfit in a 15-second video, then tell us how you would style the MoonSwatch. Include one detail about it from the drop card.",
      ["Bioceramic case", "42 mm chronograph", "Speedmaster-inspired dial", "Velcro strap", "Unworn, with box"],
      ["Show or describe your current outfit", "Say how you would style the MoonSwatch", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      6, "Fleek Watches", "The Omega x Swatch Bioceramic MoonSwatch that started the queues, unworn with box.", "2026-10-07T10:00:00.000Z"],
    [10, "Nike x Palace England 2026 Shirt", "live", 12000, "/img/photos/england.jpg", 51.5118, -0.1356, 150, "Show your current outfit in a 15-second video, then tell us how you would style the shirt. Include one detail about it from the drop card.",
      ["Stained-glass all-over graphic", "Classic polo collar", "Red detailing", "Nike x Palace, 2026 World Cup", "Size M, tags on"],
      ["Show or describe your current outfit", "Say how you would style the shirt", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      10, "Fleek Football", "The Nike x Palace England World Cup shirt, dark base with the stained-glass graphic.", "2026-10-08T10:00:00.000Z"],
    [11, "Swatch x AP Royal Pop", "live", 45000, "/img/photos/royalpop.jpg", 51.51, -0.147, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Royal Pop. Include one detail about it from the drop card.",
      ["Convertible pocket watch", "Octagonal Royal Oak-inspired bezel", "Bright 80s POP colourway", "Bioceramic", "Unworn, with pouch"],
      ["Show or describe your current outfit", "Say how you would style the Royal Pop", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      4, "Fleek Watches", "The Swatch x Audemars Piguet Royal Pop pocket watch from the May 2026 release.", "2026-10-09T10:00:00.000Z"],
    [12, "Labubu The Monsters — Secret Edition", "live", 6500, "/img/photos/labubu.jpg", 51.5149, -0.1447, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Labubu. Include one detail about it from the drop card.",
      ["Pop Mart The Monsters series", "Secret edition", "Vinyl face, plush body", "Authenticity card included", "Sealed box opened for check"],
      ["Show or describe your current outfit", "Say how you would style the Labubu", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      12, "Fleek Collectibles", "A secret-edition Labubu from The Monsters series, checked and authenticated.", "2026-10-02T10:00:00.000Z"],
    [13, "Rolex Submariner Date 126610LN — Pre-owned", "live", 1295000, "/img/photos/rolex-sub.jpg", 51.5203, -0.1086, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Submariner. Include one detail about it from the drop card.",
      ["Oystersteel 41 mm case", "Black Cerachrom bezel", "Calibre 3235", "2022, full set", "Serviced and authenticated"],
      ["Show or describe your current outfit", "Say how you would style the Submariner", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      2, "Fleek Watches", "A full-set 2022 Rolex Submariner Date, serviced and authenticated.", "2026-10-10T10:00:00.000Z"],
    [14, "Rolex Datejust 36 — Wimbledon Dial", "preview", 980000, "/img/photos/rolex-datejust.jpg", 51.501, -0.16, 150, "Coming soon",
      [],
      [],
      0, "Fleek Watches", "A pre-owned two-tone Datejust 36 with the Wimbledon dial.", "2026-10-14T10:00:00.000Z"],
    [15, "Jacquemus Le Bambino — Black", "live", 52000, "/img/photos/bambino.jpg", 51.4875, -0.1687, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Bambino. Include one detail about it from the drop card.",
      ["Smooth black leather", "Mini top-handle shape", "Detachable shoulder strap", "Gold-tone logo plate", "Barely carried"],
      ["Show or describe your current outfit", "Say how you would style the Bambino", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      5, "Fleek Luxe", "The tiny Jacquemus Le Bambino everyone carries, barely used.", "2026-10-06T10:00:00.000Z"],
    [16, "Coach Tabby 26 — Burgundy", "live", 32000, "/img/photos/tabby.jpg", 51.5143, -0.1265, 150, "Show your current outfit in a 15-second video, then tell us how you would style the Tabby. Include one detail about it from the drop card.",
      ["Burgundy leather", "Signature C turn-lock", "Chain and leather strap", "26 cm size", "Pre-loved, excellent"],
      ["Show or describe your current outfit", "Say how you would style the Tabby", "Mention one detail from the drop card", "Keep it relevant and suitable"],
      6, "Fleek Luxe", "The Coach Tabby 26, the Gen Z revival bag, in burgundy.", "2026-10-05T10:00:00.000Z"],
    [17, "Loewe Puzzle Mini — Sand", "preview", 185000, "/img/photos/puzzle.jpg", 51.5126, -0.1449, 150, "Coming soon",
      [],
      [],
      0, "Fleek Luxe", "A Loewe Puzzle Mini in sand calfskin.", "2026-10-16T10:00:00.000Z"],
  ];
  for (const [id, title, status, price, image, dLat, dLng, radius, prompt, facts, labels, allocation, brand, description, launch] of rows) {
    const rubric = labels.map((label, i) => ({ id: RUBRIC_IDS[i], label }));
    insert.run(id, title, status, price, image, dLat, dLng, radius, prompt, JSON.stringify(facts), JSON.stringify(rubric), allocation, brand, description, launch);
  }
}

function logEvent(db: Database, dropId: number, type: string, detail: Record<string, unknown>) {
  db.query("insert into events (at, type, detail_json, drop_id) values (?,?,?,?)").run(now(), type, JSON.stringify(detail), dropId);
}

function activeCount(db: Database, dropId: number) {
  return (db.query(`select count(*) c from reservations r where r.drop_id = ? and ${ACTIVE}`).get(dropId, now()) as { c: number }).c;
}

function toDrop(db: Database, row: DropRow) {
  const { facts_json, rubric_json, ...rest } = row;
  return {
    ...rest,
    facts: JSON.parse(facts_json) as string[],
    rubric: JSON.parse(rubric_json) as { id: string; label: string }[],
    available: Math.max(0, row.allocation_total - activeCount(db, row.id)),
  };
}
export type Drop = ReturnType<typeof toDrop>;

export function listDrops(db: Database) {
  return (db.query("select * from drops where status in ('live','preview') order by id").all() as DropRow[]).map((r) => toDrop(db, r));
}

export function getDrop(db: Database, id: number) {
  const row = db.query("select * from drops where id = ?").get(id) as DropRow | null;
  return row ? toDrop(db, row) : null;
}

function toReservation(r: ReservationRow) {
  const expired = r.status !== "purchased" && r.expires_at <= now();
  return {
    id: r.id, drop_id: r.drop_id, attempt_id: r.attempt_id,
    status: expired ? ("expired" as const) : r.status,
    expires_at: r.expires_at, caption: r.caption, price_pence: r.price_pence,
    video_url: `/uploads/${r.video_path}`,
  };
}
export type Reservation = ReturnType<typeof toReservation>;

function reservationRow(db: Database, id: number) {
  return db.query(`${RESERVATION_SELECT} where r.id = ?`).get(id) as ReservationRow | null;
}

export function getReservation(db: Database, id: number) {
  const row = reservationRow(db, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such reservation");
  return toReservation(row);
}

function activeReservation(db: Database, dropId: number) {
  return db.query(`${RESERVATION_SELECT} where r.drop_id = ? and ${ACTIVE} order by r.id desc limit 1`).get(dropId, now()) as ReservationRow | null;
}

// In-flight attempts (verdict null) count so a double-tap cannot exceed the limit; 'error' never counts.
function countedAttempts(db: Database, dropId: number) {
  return (db.query("select count(*) c from attempts where drop_id = ? and (verdict is null or verdict in ('pass','retry'))").get(dropId) as { c: number }).c;
}

export function dropState(db: Database, dropId: number) {
  if (!getDrop(db, dropId)) throw new ApiError(404, "NOT_FOUND", "No such drop");
  const latest = db.query(`${RESERVATION_SELECT} where r.drop_id = ? order by r.id desc limit 1`).get(dropId) as ReservationRow | null;
  return { attempts_used: countedAttempts(db, dropId), max_attempts: MAX_ATTEMPTS, reservation: latest ? toReservation(latest) : null };
}

export function createAttempt(db: Database, a: { dropId: number; videoPath: string; transcript: string; durationMs: number }) {
  return db.transaction(() => {
    if (activeReservation(db, a.dropId)) throw new ApiError(409, "ALREADY_RESERVED", "You already hold this drop");
    if (countedAttempts(db, a.dropId) >= MAX_ATTEMPTS) throw new ApiError(409, "ATTEMPTS_EXHAUSTED", "No attempts left for this drop");
    const n = ((db.query("select max(n) m from attempts where drop_id = ?").get(a.dropId) as { m: number | null }).m ?? 0) + 1;
    const row = db
      .query("insert into attempts (drop_id,n,video_path,transcript,duration_ms,created_at) values (?,?,?,?,?,?) returning id, n")
      .get(a.dropId, n, a.videoPath, a.transcript, a.durationMs, now()) as { id: number; n: number };
    logEvent(db, a.dropId, "attempt_submitted", { attempt_id: row.id, n });
    return row;
  })();
}

export function saveReview(db: Database, attemptId: number, review: { verdict: string }) {
  const { drop_id } = db.query("update attempts set verdict = ?, review_json = ? where id = ? returning drop_id")
    .get(review.verdict, JSON.stringify(review), attemptId) as { drop_id: number };
  logEvent(db, drop_id, "reviewed", { attempt_id: attemptId, verdict: review.verdict });
}

function withSuffix(caption: string | null) {
  const c = (caption ?? DEFAULT_CAPTION).trim();
  return c.endsWith(CAPTION_SUFFIX) ? c : `${c} ${CAPTION_SUFFIX}`;
}

const holdMs = (drop: Drop) => (process.env.HOLD_MS ? Number(process.env.HOLD_MS) : drop.hold_minutes * 60_000);

// BEGIN IMMEDIATE and synchronous: nothing else runs between the count and the insert.
export function claimHold(db: Database, drop: Drop, attemptId: number, caption: string | null): Reservation | "NO_STOCK" | "ALREADY_RESERVED" {
  return db.transaction(() => {
    if (activeReservation(db, drop.id)) return "ALREADY_RESERVED" as const;
    if (activeCount(db, drop.id) >= drop.allocation_total) {
      logEvent(db, drop.id, "no_stock", { attempt_id: attemptId });
      return "NO_STOCK" as const;
    }
    const { id } = db
      .query("insert into reservations (drop_id,attempt_id,status,expires_at,caption,price_pence) values (?,?,'held',?,?,?) returning id")
      .get(drop.id, attemptId, inMs(holdMs(drop)), withSuffix(caption), drop.price_pence) as { id: number };
    logEvent(db, drop.id, "hold_claimed", { reservation_id: id, attempt_id: attemptId });
    return getReservation(db, id);
  }).immediate();
}

function transition(db: Database, id: number, from: "held" | "posted", to: "posted" | "purchased") {
  return db.transaction(() => {
    const r = getReservation(db, id);
    if (r.status === to) return r; // repeated tap returns the same result
    if (r.status === "expired") throw new ApiError(409, "HOLD_EXPIRED", "Your hold expired");
    if (r.status !== from) throw new ApiError(409, "BAD_STATE", to === "purchased" ? "Post your Reel first" : `Reservation is ${r.status}`);
    if (to === "posted") db.query("update reservations set status='posted', posted_at=?, expires_at=? where id=?").run(now(), inMs(PURCHASE_MS), id);
    else db.query("update reservations set status='purchased', purchased_at=? where id=?").run(now(), id);
    logEvent(db, r.drop_id, to, { reservation_id: id });
    return getReservation(db, id);
  })();
}
export const markPosted = (db: Database, id: number) => transition(db, id, "held", "posted");
export const buy = (db: Database, id: number) => transition(db, id, "posted", "purchased");

export function dashboard(db: Database) {
  const total = (db.query("select coalesce(sum(allocation_total),0) t from drops where status='live'").get() as { t: number }).t;
  const rows = (db.query(`${RESERVATION_SELECT}`).all() as ReservationRow[]).map(toReservation);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const stock = { total, held: count("held"), posted: count("posted"), sold: count("purchased"), available: 0 };
  stock.available = Math.max(0, total - stock.held - stock.posted - stock.sold);
  const one = (sql: string) => (db.query(sql).get() as { c: number }).c;
  const funnel = {
    attempts: one("select count(*) c from attempts"),
    passed: one("select count(*) c from attempts where verdict='pass'"),
    held: one("select count(*) c from reservations"),
    posted: one("select count(*) c from reservations where posted_at is not null"),
    purchased: one("select count(*) c from reservations where purchased_at is not null"),
  };
  return { stock, funnel, events: recentEvents(db) };
}

function recentEvents(db: Database, dropId?: number) {
  const rows = db.query(`select at, type, detail_json from events ${dropId === undefined ? "" : "where drop_id = ?"} order by id desc limit 20`)
    .all(...(dropId === undefined ? [] : [dropId])) as { at: string; type: string; detail_json: string }[];
  return rows.map((e) => ({ at: e.at, type: e.type, detail: JSON.parse(e.detail_json) }));
}

function dropStats(db: Database, dropId: number) {
  const one = (sql: string) => (db.query(sql).get(dropId) as { c: number }).c;
  return {
    attempts: one("select count(*) c from attempts where drop_id = ?"),
    passed: one("select count(*) c from attempts where drop_id = ? and verdict = 'pass'"),
    held: one("select count(*) c from reservations where drop_id = ?"),
    posted: one("select count(*) c from reservations where drop_id = ? and posted_at is not null"),
    sold: one("select count(*) c from reservations where drop_id = ? and purchased_at is not null"),
  };
}

export function listCampaigns(db: Database) {
  return (db.query("select * from drops order by id desc").all() as DropRow[]).map((r) => ({ ...toDrop(db, r), stats: dropStats(db, r.id) }));
}

export function campaignDetail(db: Database, id: number) {
  const campaign = getDrop(db, id);
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "No such campaign");
  const attempts = db.query("select id, n, verdict, review_json, transcript, created_at, video_path from attempts where drop_id = ? order by id desc").all(id) as
    { id: number; n: number; verdict: string | null; review_json: string | null; transcript: string; created_at: string; video_path: string }[];
  const reviews = attempts.map((a) => ({
    attempt_id: a.id, n: a.n, verdict: a.verdict, transcript: a.transcript, created_at: a.created_at,
    feedback: a.review_json ? String(JSON.parse(a.review_json).feedback ?? "") : "",
    video_url: `/uploads/${a.video_path}`,
  }));
  return { campaign, stats: dropStats(db, id), reviews, events: recentEvents(db, id) };
}

const campaignParams = (c: CampaignInput) => [
  c.brand, c.title, c.description, c.price_pence, c.allocation_total, c.image_url, c.lat, c.lng, c.radius_m,
  c.hold_minutes, c.prompt, JSON.stringify(c.facts), JSON.stringify(c.rubric), c.status, c.public_launch_at,
];

export function createCampaign(db: Database, c: CampaignInput) {
  const { id } = db.query(
    `insert into drops (brand,title,description,price_pence,allocation_total,image_url,lat,lng,radius_m,hold_minutes,prompt,facts_json,rubric_json,status,public_launch_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) returning id`,
  ).get(...campaignParams(c)) as { id: number };
  return getDrop(db, id)!;
}

export function updateCampaign(db: Database, id: number, c: CampaignInput) {
  db.query(
    `update drops set brand=?,title=?,description=?,price_pence=?,allocation_total=?,image_url=?,lat=?,lng=?,radius_m=?,hold_minutes=?,
     prompt=?,facts_json=?,rubric_json=?,status=?,public_launch_at=? where id=?`,
  ).run(...campaignParams(c), id);
  return getDrop(db, id)!;
}

export function reset(db: Database, allocationTotal?: number) {
  db.transaction(() => {
    db.exec("delete from events; delete from reservations; delete from attempts;");
    if (Number.isInteger(allocationTotal)) db.query("update drops set allocation_total = ? where status='live'").run(allocationTotal!);
  })();
}
