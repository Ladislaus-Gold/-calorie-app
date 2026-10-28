/* Офлайн: оболочка приложения и скрипты Firebase кэшируются; данные хранит Firestore (persistent cache) */
const CACHE = "health-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/\.mp4$/i.test(url.pathname)) return; // видео отдаёт сеть напрямую (Safari запрашивает диапазоны байт)
  const ours = url.origin === self.location.origin;
  const sdk = url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/");
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!ours && !sdk && !fonts) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // скрипты SDK с версией в адресе не меняются: сначала кэш
    if (sdk) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === "navigate" ? (await cache.match("./")) || (await cache.match("index.html")) : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
