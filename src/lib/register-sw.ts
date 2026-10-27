/**
 * Registers the share-target service worker, but never inside Lovable
 * preview, an iframe, dev mode, or when ?sw=off is present.
 */
function isBlockedContext(): boolean {
  if (typeof window === "undefined") return true;
  if (!import.meta.env.PROD) return true;
  if (window.self !== window.top) return true;
  if (new URL(window.location.href).searchParams.get("sw") === "off") return true;

  const host = window.location.hostname;
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

export async function registerShareTargetWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (isBlockedContext()) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.allSettled(
      regs
        .filter((r) => (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith("/sw.js"))
        .map((r) => r.unregister()),
    );
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.error("service worker registration failed", err);
  }
}

export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open("voicereply-share-target");
    const res = await cache.match("/shared-file");
    if (!res) return null;
    await cache.delete("/shared-file");
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-file-name") ?? "voice-note.opus");
    return new File([blob], name, { type: blob.type || "audio/ogg" });
  } catch {
    return null;
  }
}
