import { createFileRoute, redirect } from "@tanstack/react-router";

// Fallback when the service worker hasn't taken control yet: send the user home.
export const Route = createFileRoute("/share-target")({
  head: () => ({
    meta: [
      { title: "VoiceReply — Shared voice note" },
      { name: "description", content: "Continue a shared WhatsApp voice note in VoiceReply." },
      { property: "og:title", content: "VoiceReply — Shared voice note" },
      { property: "og:description", content: "Continue a shared WhatsApp voice note in VoiceReply." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  server: {
    handlers: {
      POST: async () => new Response(null, { status: 303, headers: { location: "/" } }),
      GET: async () => new Response(null, { status: 303, headers: { location: "/" } }),
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
