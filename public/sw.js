// Share-target worker only. It does not cache the app shell or intercept
// normal navigations, so it can never serve stale HTML.
const SHARE_CACHE = "voicereply-share-target";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get("audio_file");
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            "/shared-file",
            new Response(file, {
              headers: {
                "content-type": file.type || "audio/ogg",
                "x-file-name": encodeURIComponent(file.name || "voice-note.opus"),
              },
            }),
          );
          return Response.redirect("/?shared=true", 303);
        }
      } catch (err) {
        console.error("share-target failed", err);
      }
      return Response.redirect("/", 303);
    })(),
  );
});
