/* Service worker: appskalet och frågebanken cachas, media sparas efter hand. */

const VERSION = "v2";
const SHELL = `korkort-skal-${VERSION}`;
const MEDIA = `korkort-media-${VERSION}`;
const MEDIA_MAX = 200;                    // ~200 bilder/klipp, sedan slängs de äldsta

const SHELL_FILES = [
  "/", "/index.html", "/styles.css", "/app.js",
  "/manifest.webmanifest", "/favicon.svg",
  "/icons/icon-192.png", "/icons/icon-512.png",
  "/data/questions.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) {
    await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;       // påminnelsetjänsten, aldrig cachad

  // Media: cache-first, lagras först när frågan faktiskt visats.
  if (url.pathname.startsWith("/media/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        const cache = await caches.open(MEDIA);
        cache.put(request, response.clone()).then(() => trimCache(MEDIA, MEDIA_MAX));
      }
      return response;
    })());
    return;
  }

  // Appskal och frågebank: visa cachat direkt, hämta nytt i bakgrunden.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached);
    return cached || network;
  })());
});

/* ---------- påminnelser (Web Push) ---------- */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* tom eller trasig payload */ }
  // iOS drar in push-rätten för appar som tar emot push utan att visa en notis,
  // så en notis visas alltid.
  event.waitUntil(self.registration.showNotification(data.title || "Körkortsfrågor", {
    body: data.body || "Dags att öva inför teoriprovet!",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "reminder",
    lang: "sv",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      return client.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});

// Webbläsaren kan byta ut prenumerationen på egen hand (Firefox gör det).
// Flytta då över påminnelsen till den nya, med samma tid och tidszon.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const subscription = event.newSubscription ?? await self.registration.pushManager.subscribe(
      old?.options ?? { userVisibleOnly: true });
    await fetch("/api/push/subscription", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, replaces: old?.endpoint }),
    });
  })());
});
