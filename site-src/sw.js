const VERSION = "__VERSION__";
const CACHE = "aia-" + VERSION;
const RUNTIME = "__RUNTIME__";
const RT_CACHE = "aia-rt-" + RUNTIME;
const FILES = __FILES__;
const NETWORK_FIRST = /(\.html|\.css|\.js|\.json|\/)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("aia-") && k !== CACHE && k !== RT_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function fromNetwork(req) {
  return fetch(req, { cache: "no-cache" }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/runtime/")) {
    event.respondWith(
      caches.open(RT_CACHE).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }
  if (NETWORK_FIRST.test(url.pathname)) {
    event.respondWith(
      fromNetwork(req).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match(url.pathname.replace(/[^/]*$/, "") + "index.html")).then((hit) => hit || caches.match("./index.html"))
      )
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fromNetwork(req)));
});
