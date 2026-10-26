const CACHE_NAME = "luxsyncspace-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/luxmor-logo.jpeg",
  "/icons/luxsyncspace-192.png",
  "/icons/luxsyncspace-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const isCall = event.notification.data?.type === "call";
  if (isCall && event.action === "reject") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({
          type: "luxsyncspace:call-rejected",
          meetingId: event.notification.data?.meetingId
        }));
      })
    );
    return;
  }
  const callAccepted = isCall && event.action === "accept";
  const targetUrl = event.notification.data?.url || "/";
  const callUrl = callAccepted
    ? `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}join=1`
    : targetUrl;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (callAccepted) {
        clients.forEach((client) => client.postMessage({
          type: "luxsyncspace:call-accepted",
          meetingId: event.notification.data?.meetingId
        }));
      }
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        existing.navigate(callUrl);
        return existing.focus();
      }
      return self.clients.openWindow(callUrl);
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { body: event.data?.text() || "You have a new workspace update." };
  }
  const isCall = data.type === "call";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (!isCall && clients.some((client) => client.visibilityState === "visible")) return;
      return self.registration.showNotification(data.title || "LuxSyncspace", {
        body: data.body || "You have a new workspace update.",
        tag: data.tag || "luxsyncspace",
        icon: "/icons/luxsyncspace-192.png",
        badge: "/icons/luxsyncspace-192.png",
        vibrate: isCall ? [500, 220, 500, 900, 500, 220, 500] : [180, 80, 180],
        renotify: true,
        requireInteraction: isCall,
        silent: false,
        actions: isCall ? [
          { action: "accept", title: "Accept" },
          { action: "reject", title: "Reject" }
        ] : [],
        data: {
          type: data.type || "message",
          meetingId: data.meetingId,
          url: data.url || "/"
        }
      });
    })
  );
});
