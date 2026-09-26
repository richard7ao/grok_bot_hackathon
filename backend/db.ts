import { Database } from "bun:sqlite";

export const MAX_ATTEMPTS = 3;
const HOLD_MS = Number(process.env.HOLD_MS ?? 600_000);
const PURCHASE_MS = Number(process.env.PURCHASE_MS ?? 300_000);
const CAPTION_SUFFIX = "#ad #FleekDropQuest";
const DEFAULT_CAPTION = "My styling take on the Fleek drop.";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const SCHEMA = `
create table if not exists drops (
  id integer primary key, title text not null, status text not null check (status in ('live','preview')),
  price_pence integer not null, image_url text not null, lat real not null, lng real not null,
  radius_m integer not null, prompt text not null, facts_json text not null, rubric_json text not null,
  allocation_total integer not null
);
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
  id integer primary key, at text not null, type text not null, detail_json text not null default '{}'
);`;

type DropRow = {
  id: number; title: string; status: "live" | "preview"; price_pence: number; image_url: string;
  lat: number; lng: number; radius_m: number; prompt: string; facts_json: string; rubric_json: string;
  allocation_total: number;
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
  // Every boot, so seed edits (venue pin, copy) reach an existing dropquest.db.
  seedDrops(db);
  // Nothing is in flight at boot: settle attempts a restart cut off, so they stop counting.
  db.exec("update attempts set verdict = 'error' where verdict is null");
  return db;
}

function seedDrops(db: Database) {
  const lat = Number(process.env.VENUE_LAT ?? 51.5237);
  const lng = Number(process.env.VENUE_LNG ?? -0.0785);
  const insert = db.query(
    `insert into drops (id,title,status,price_pence,image_url,lat,lng,radius_m,prompt,facts_json,rubric_json,allocation_total)
     values (?,?,?,?,?,?,?,?,?,?,?,?)
     on conflict(id) do update set title=excluded.title, status=excluded.status, price_pence=excluded.price_pence,
       image_url=excluded.image_url, lat=excluded.lat, lng=excluded.lng, radius_m=excluded.radius_m,
       prompt=excluded.prompt, facts_json=excluded.facts_json, rubric_json=excluded.rubric_json`,
  );
  insert.run(
    1, "Pre-loved Hermès Birkin 25 — Gold Togo", "live", 1850000, "/img/birkin.svg", lat, lng, 150,
    "Show your current outfit in a 15-second video, then tell us how you would style the Birkin. Include one detail about the bag from the drop card.",
    JSON.stringify(["Gold Togo leather", "Gold-plated hardware", "25 cm, the most wanted size", "Authenticated by Fleek", "Box and dust bag included"]),
    JSON.stringify([
      { id: "outfit", label: "Show or describe your current outfit" },
      { id: "styling_idea", label: "Say how you would style the bag" },
      { id: "product_detail", label: "Mention one detail from the drop card" },
      { id: "suitable", label: "Keep it relevant and suitable" },
    ]),
    3,
  );
  insert.run(2, "Vintage Fendi Baguette — 1999 Monogram", "preview", 145000, "/img/baguette.svg", lat + 0.0025, lng + 0.0033, 150, "Coming soon", "[]", "[]", 0);
  insert.run(3, "Miu Miu Satin Ballet Flats — Blush", "preview", 79000, "/img/flats.svg", lat - 0.0022, lng - 0.0036, 150, "Coming soon", "[]", "[]", 0);
}

function logEvent(db: Database, type: string, detail: Record<string, unknown>) {
  db.query("insert into events (at, type, detail_json) values (?,?,?)").run(now(), type, JSON.stringify(detail));
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
  return (db.query("select * from drops order by id").all() as DropRow[]).map((r) => toDrop(db, r));
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
    logEvent(db, "attempt_submitted", { attempt_id: row.id, n });
    return row;
  })();
}

export function saveReview(db: Database, attemptId: number, review: { verdict: string }) {
  db.query("update attempts set verdict = ?, review_json = ? where id = ?").run(review.verdict, JSON.stringify(review), attemptId);
  logEvent(db, "reviewed", { attempt_id: attemptId, verdict: review.verdict });
}

function withSuffix(caption: string | null) {
  const c = (caption ?? DEFAULT_CAPTION).trim();
  return c.endsWith(CAPTION_SUFFIX) ? c : `${c} ${CAPTION_SUFFIX}`;
}

// BEGIN IMMEDIATE and synchronous: nothing else runs between the count and the insert.
export function claimHold(db: Database, drop: Drop, attemptId: number, caption: string | null): Reservation | "NO_STOCK" | "ALREADY_RESERVED" {
  return db.transaction(() => {
    if (activeReservation(db, drop.id)) return "ALREADY_RESERVED" as const;
    if (activeCount(db, drop.id) >= drop.allocation_total) {
      logEvent(db, "no_stock", { attempt_id: attemptId });
      return "NO_STOCK" as const;
    }
    const { id } = db
      .query("insert into reservations (drop_id,attempt_id,status,expires_at,caption,price_pence) values (?,?,'held',?,?,?) returning id")
      .get(drop.id, attemptId, inMs(HOLD_MS), withSuffix(caption), drop.price_pence) as { id: number };
    logEvent(db, "hold_claimed", { reservation_id: id, attempt_id: attemptId });
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
    logEvent(db, to, { reservation_id: id });
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
  const events = (db.query("select at, type, detail_json from events order by id desc limit 20").all() as { at: string; type: string; detail_json: string }[])
    .map((e) => ({ at: e.at, type: e.type, detail: JSON.parse(e.detail_json) }));
  return { stock, funnel, events };
}

export function reset(db: Database, allocationTotal?: number) {
  db.transaction(() => {
    db.exec("delete from events; delete from reservations; delete from attempts;");
    if (Number.isInteger(allocationTotal)) db.query("update drops set allocation_total = ? where status='live'").run(allocationTotal!);
  })();
}
