import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing AI key", { status: 500 });

        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const authKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const authUrl = process.env["SUPABASE_URL"];
        if (!token || token.split(".").length !== 3) {
          return new Response("Sign in before transcribing a voice note", { status: 401 });
        }
        if (!authKey || !authUrl) return new Response("Sign-in is not configured", { status: 500 });
        const supabase = createClient<Database>(authUrl, authKey, {
          global: {
            fetch: (input, init) => {
              const headers = new Headers(
                typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
              );
              if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
              if (authKey.startsWith("sb_") && headers.get("Authorization") === `Bearer ${authKey}`) {
                headers.delete("Authorization");
              }
              headers.set("apikey", authKey);
              return fetch(input, { ...init, headers });
            },
            headers: { Authorization: `Bearer ${token}` },
          },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
        if (claimsError || !claims?.claims?.sub) {
          return new Response("Sign in before transcribing a voice note", { status: 401 });
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || file.size < 1024) {
          return new Response("No usable audio uploaded", { status: 400 });
        }
        if (file.size > 14 * 1024 * 1024) {
          return new Response("Audio too large (max 14MB)", { status: 400 });
        }

        const upstream = new FormData();
        upstream.append("model", "google/gemini-3.5-transcribe");
        upstream.append("file", file, "voice-note.wav");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return new Response(detail || "Transcription failed", { status: res.status });
        }

        const data = (await res.json()) as { text?: string };
        return Response.json({ text: data.text ?? "" });
      },
    },
  },
});
