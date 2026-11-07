/* Påminnelsetjänst för Körkortsfrågor: tar emot Web Push-prenumerationer och
 * skickar en daglig påminnelse till den som inte har övat under dagen. */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { isDue, isValidTime, isValidTimeZone, localNow, type ReminderState } from "./schedule";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const SITE_URL = process.env.SITE_URL ?? "https://korkort.eliasf.se";
const MAX_SUBSCRIPTIONS = 50_000;

/* Prenumerationens endpoint är en URL som servern sedan POST:ar till. Bara
 * webbläsarnas egna push-tjänster godtas, annars kan vem som helst få
 * servern att anropa godtyckliga adresser. */
const PUSH_HOSTS = [
  "fcm.googleapis.com", "android.googleapis.com",   // Chrome, Edge på Android, Samsung
  ".push.services.mozilla.com", "push.services.mozilla.com",
  ".push.apple.com",                                 // Safari, iOS-hemskärmsappar
  ".notify.windows.com",                             // Edge på Windows
];

function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) =>
      host.startsWith(".") ? url.hostname.endsWith(host) : url.hostname === host);
  } catch {
    return false;
  }
}

/* ---------- lagring ---------- */

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(`${DATA_DIR}/push.sqlite`, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint     TEXT PRIMARY KEY,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  time         TEXT NOT NULL,
  time_zone    TEXT NOT NULL,
  last_sent_on TEXT,
  practiced_on TEXT,
  created_at   INTEGER NOT NULL
)`);

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
  time: string;
  time_zone: string;
  last_sent_on: string | null;
  practiced_on: string | null;
}

const q = {
  config: db.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?"),
  setConfig: db.query("INSERT INTO config (key, value) VALUES (?, ?)"),
  get: db.query<Row, [string]>("SELECT * FROM subscriptions WHERE endpoint = ?"),
  all: db.query<Row, []>("SELECT * FROM subscriptions"),
  count: db.query<{ n: number }, []>("SELECT count(*) AS n FROM subscriptions"),
  upsert: db.query(`
    INSERT INTO subscriptions (endpoint, p256dh, auth, time, time_zone, last_sent_on, created_at)
    VALUES ($endpoint, $p256dh, $auth, $time, $timeZone, $lastSentOn, $now)
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = excluded.p256dh, auth = excluded.auth, time = excluded.time,
      time_zone = excluded.time_zone, last_sent_on = excluded.last_sent_on`),
  remove: db.query("DELETE FROM subscriptions WHERE endpoint = ?"),
  practiced: db.query("UPDATE subscriptions SET practiced_on = ? WHERE endpoint = ?"),
  sent: db.query("UPDATE subscriptions SET last_sent_on = ? WHERE endpoint = ?"),
};

/* VAPID-nycklarna skapas vid första start och ligger sedan kvar i databasen —
 * byts de ut slutar alla befintliga prenumerationer att fungera. */
function vapidKeys() {
  const stored = q.config.get("vapid");
  if (stored) return JSON.parse(stored.value) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  q.setConfig.run("vapid", JSON.stringify(keys));
  console.log("Skapade nya VAPID-nycklar");
  return keys;
}
const vapid = vapidKeys();
webpush.setVapidDetails(SITE_URL, vapid.publicKey, vapid.privateKey);

function state(row: Row): ReminderState {
  return { time: row.time, timeZone: row.time_zone, lastSentOn: row.last_sent_on, practicedOn: row.practiced_on };
}

/* ---------- utskick ---------- */

const MESSAGES = [
  "Ett snabbtest tar fem minuter. Kör ett nu?",
  "Lite varje dag slår mycket en gång i veckan. Dags för dagens frågor!",
  "Teoriprovet väntar inte. 25 frågor, rättas direkt.",
  "Du har inte övat i dag än. Ett snabbtest?",
];

async function send(row: Row, payload: object): Promise<boolean> {
  const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 4 * 60 * 60,           // en påminnelse som kommer fram nästa morgon är bara störande
      urgency: "normal",
      topic: "reminder",          // en ny påminnelse ersätter en som ännu inte levererats
    });
    return true;
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      q.remove.run(row.endpoint);   // prenumerationen är avslutad i webbläsaren
    } else {
      console.error("Push misslyckades:", error instanceof WebPushError ? `${error.statusCode} ${error.body}` : error);
    }
    return false;
  }
}

let running = false;
async function sendDueReminders() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    for (const row of q.all.all()) {
      if (!isDue(state(row), now)) continue;
      // Markera först, så att ett långsamt eller trasigt utskick inte upprepas varje minut.
      q.sent.run(localNow(row.time_zone, now).date, row.endpoint);
      await send(row, {
        title: "Dags att öva",
        body: MESSAGES[Math.floor(Math.random() * MESSAGES.length)],
        url: "/?start=quick",
      });
    }
  } finally {
    running = false;
  }
}

/* ---------- HTTP ---------- */

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

async function putSubscription(req: Request) {
  const body = await readBody(req);
  const sub = body?.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  if (!isPushEndpoint(sub?.endpoint)) return fail("Okänd push-tjänst");
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
    return fail("Ogiltiga nycklar");
  }
  // Service workern byter prenumeration utan att känna till tid och tidszon:
  // då ärvs de från den gamla, som tas bort.
  const replaced = typeof body!.replaces === "string" ? q.get.get(body!.replaces) : null;
  const time = body!.time ?? replaced?.time, timeZone = body!.timeZone ?? replaced?.time_zone;
  if (!isValidTime(time)) return fail("Ogiltig tid");
  if (!isValidTimeZone(timeZone)) return fail("Ogiltig tidszon");
  if (replaced && replaced.endpoint !== sub.endpoint) q.remove.run(replaced.endpoint);

  const existing = q.get.get(sub.endpoint);
  if (!existing && q.count.get()!.n >= MAX_SUBSCRIPTIONS) return fail("Fullt", 503);

  // Ny prenumeration eller ändrad tid som redan har passerat i dag: räkna
  // dagens påminnelse som skickad, annars kommer den direkt. En ren
  // synkning från appen (samma tid) lämnar dagens påminnelse orörd.
  let lastSentOn = existing?.last_sent_on ?? null;
  const changed = !existing || existing.time !== time || existing.time_zone !== timeZone;
  if (changed && isDue({ time, timeZone, lastSentOn, practicedOn: null })) {
    lastSentOn = localNow(timeZone).date;
  }

  q.upsert.run({ endpoint: sub.endpoint, p256dh, auth, time, timeZone, lastSentOn, now: Date.now() });

  // Bekräftelse när påminnelser slås på — visar direkt att hela kedjan fungerar.
  if (body!.confirm === true) {
    const ok = await send(q.get.get(sub.endpoint)!, {
      title: "Påminnelser påslagna",
      body: `Du får en notis kl. ${time} de dagar du inte har övat.`,
      url: "/",
    });
    if (!ok) return fail("Kunde inte skicka till webbläsarens push-tjänst", 502);
  }
  return json({ ok: true }, existing ? 200 : 201);
}

async function deleteSubscription(req: Request) {
  const body = await readBody(req);
  if (typeof body?.endpoint !== "string") return fail("endpoint saknas");
  q.remove.run(body.endpoint);
  return new Response(null, { status: 204 });
}

async function markPracticed(req: Request) {
  const body = await readBody(req);
  const row = typeof body?.endpoint === "string" ? q.get.get(body.endpoint) : null;
  if (!row) return fail("Okänd prenumeration", 404);
  q.practiced.run(localNow(row.time_zone).date, row.endpoint);
  return new Response(null, { status: 204 });
}

const server = Bun.serve({
  port: PORT,
  maxRequestBodySize: 16 * 1024,
  routes: {
    "/api/push/health": new Response("ok\n"),
    "/api/push/key": () => json({ publicKey: vapid.publicKey }),
    "/api/push/subscription": { PUT: putSubscription, DELETE: deleteSubscription },
    "/api/push/practiced": { POST: markPracticed },
  },
  fetch: () => fail("Hittades inte", 404),
});

// Kör i början av varje minut, så att påminnelsen kommer på utsatt tid.
setTimeout(() => {
  sendDueReminders();
  setInterval(sendDueReminders, 60_000);
}, 60_000 - (Date.now() % 60_000) + 1_000);

console.log(`Lyssnar på :${server.port}, ${q.count.get()!.n} prenumerationer`);

process.on("SIGTERM", () => {
  server.stop();
  db.close();
  process.exit(0);
});
