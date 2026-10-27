// Server-only helpers for Lovable AI (Responses API, streamed) and live web search.
import type { createLovableAiGatewayRunIdFetch } from "./ai-run-id.server";

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function structuredResponse<T>(opts: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium";
  gatewayFetch: ReturnType<typeof createLovableAiGatewayRunIdFetch>;
}): Promise<T> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("AI is not configured", 401);
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await opts.gatewayFetch.fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: opts.effort ?? "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        input: [
          { role: "system", content: [{ type: "input_text", text: opts.instructions }] },
          { role: "user", content: [{ type: "input_text", text: opts.input }] },
        ],
        text: {
          format: { type: "json_schema", name: opts.schemaName, strict: true, schema: opts.schema },
        },
      }),
    });
    if (res.ok && res.body) break;
    const detail = await res.text().catch(() => "");
    let msg = detail;
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: { message?: string } };
      msg = parsed.message ?? parsed.error?.message ?? detail;
    } catch {
      /* keep raw */
    }
    const retryable = res.status === 429 || res.status >= 500;
    const accountProblem = /account|configuration|misconfigured|invalid key/i.test(msg);
    if (!retryable || accountProblem || attempt === 2) {
      if (res.status === 402) msg = msg || "AI credits are used up. Add credits to continue.";
      if (res.status === 429) msg = msg || "Too many requests right now — try again in a minute.";
      throw new AiError(msg || `AI request failed (${res.status})`, res.status);
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8000)
      : Math.min(500 * 2 ** attempt + Math.random() * 250, 4000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!res?.ok || !res.body) throw new AiError("AI returned no response stream", res?.status ?? 500);

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
          error?: { message?: string };
        };
        if (evt.type === "response.output_text.delta" && evt.delta) text += evt.delta;
        if (evt.type === "response.completed" && evt.response?.output_text)
          text = evt.response.output_text;
        if (evt.type === "error" || evt.type === "response.failed")
          throw new AiError(evt.error?.message ?? "AI request failed", 500);
      } catch (e) {
        if (e instanceof AiError) throw e;
      }
    }
  }

  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    throw new AiError("The AI returned an unreadable answer. Please try again.", 500);
  }
}

export type SearchHit = { title: string; url: string; snippet: string; date?: string };

export async function webSearch(queries: string[]): Promise<SearchHit[]> {
  const lovable = process.env["LOVABLE_API_KEY"];
  const pplx = process.env["PERPLEXITY_API_KEY"];
  if (!lovable || !pplx) throw new AiError("Web search is not configured", 401);

  const res = await fetch("https://connector-gateway.lovable.dev/perplexity/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": pplx,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: queries.slice(0, 5), max_results: 5 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Search failed [${res.status}]: ${body}`);
    if (res.status === 402) throw new AiError("Credits are used up — top up to keep searching.", 402);
    throw new AiError(`Live search failed (${res.status})`, res.status);
  }
  const data = (await res.json()) as { results?: unknown };
  // Multi-query responses may be nested arrays.
  const flat = (Array.isArray(data.results) ? data.results : []).flat(2) as SearchHit[];
  const seen = new Set<string>();
  return flat.filter((r) => {
    if (!r?.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}
