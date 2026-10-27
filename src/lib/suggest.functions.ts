import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  transcript: z.string().min(1).max(8000),
  tone: z.enum(["friendly", "professional", "flirty", "brief", "firm"]),
});

const SYSTEM = `You help someone reply to a WhatsApp voice note.
You get the transcript of the voice note they received.
Return exactly 3 reply suggestions they could send back, in the SAME language as the transcript.
Each reply must be self-contained, natural, chat-style (no greetings boilerplate, no quotes, no numbering).
Vary length: one short, one medium, one more detailed.`;

export const suggestReplies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing AI key");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        instructions: SYSTEM,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Tone: ${data.tone}\n\nVoice note transcript:\n"""${data.transcript}"""`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "reply_suggestions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                replies: {
                  type: "array",
                  items: { type: "string" },
                },
                summary: { type: "string" },
              },
              required: ["replies", "summary"],
            },
          },
        },
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `AI request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (evt.type === "response.output_text.delta" && evt.delta) text += evt.delta;
          if (evt.type === "response.completed" && evt.response?.output_text) {
            text = evt.response.output_text;
          }
        } catch {
          // ignore malformed keepalive chunks
        }
      }
    }

    let parsed: { replies?: string[]; summary?: string } = {};
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      parsed = {};
    }

    return {
      summary: parsed.summary ?? "",
      replies: (parsed.replies ?? []).filter((r) => typeof r === "string" && r.trim().length > 0),
    };
  });
