// Client-side Meterless Nightshift runtime client.
// The runtime lives on the user's own machine (OpenAI-compatible hotspot),
// so these calls run from the browser only — server functions can never reach it.
// Contract source: Meterless Runtime 0.90.0 provider docs (docs/agent-ready/add-meterless-provider.md).

const URL_KEY = "meterless_runtime_url";
export const TOKEN_KEY = "meterless_runtime_token";
const REPLIES_KEY = "meterless_use_for_replies";
export const APP_HEADER = "voicereply-web";

const PROBE_PORTS = [8088, 8090, 8787, 11434];
const PROBE_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export type MeterlessStatus = "unset" | "checking" | "online" | "unauthorized" | "offline";

export type MeterlessState = {
  status: MeterlessStatus;
  modelCount: number;
  enabled: boolean;
};

// Connection state is shared between the setup panel and the result view, which
// live in different subtrees of the page. A tiny pub/sub store keeps them in sync.
const stateListeners = new Set<(state: MeterlessState) => void>();

export function readMeterlessState(): MeterlessState {
  return { status: "unset", modelCount: 0, enabled: getUseForReplies() };
}

export function publishMeterlessState(state: MeterlessState) {
  stateListeners.forEach((listener) => listener(state));
}

export function subscribeMeterlessState(listener: (state: MeterlessState) => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function normalizeMeterlessUrl(paste: string): string {
  const raw = paste.trim();
  if (!raw) return "";
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    // Accept pasted /v1, /v1/chat/completions, /v1/models or /healthz — always reduce to <origin>/v1.
    return `${url.origin}/v1`;
  } catch {
    return "";
  }
}

function lsGet(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function lsSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export function getStoredUrl(): string {
  return lsGet(URL_KEY);
}

export function setStoredUrl(url: string) {
  lsSet(URL_KEY, normalizeMeterlessUrl(url));
}

export function getStoredToken(): string {
  return lsGet(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  lsSet(TOKEN_KEY, token.trim());
}

export function getUseForReplies(): boolean {
  return lsGet(REPLIES_KEY) === "true";
}

export function setUseForReplies(enabled: boolean) {
  lsSet(REPLIES_KEY, enabled ? "true" : "false");
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "meterless-app": APP_HEADER,
    ...extra,
  };
}

// GET /v1/models decides status, not /healthz: 401/403 is unauthorized, 200 with
// meterless ids is online, anything else is offline.
export async function probe(
  baseUrl: string,
  token: string,
): Promise<{ status: Exclude<MeterlessStatus, "checking" | "unset">; modelCount: number }> {
  const base = normalizeMeterlessUrl(baseUrl);
  if (!base) return { status: "offline", modelCount: 0 };
  try {
    const res = await fetchWithTimeout(
      `${base}/models`,
      { headers: headers(token), method: "GET" },
      10_000,
    );
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", modelCount: 0 };
    if (!res.ok) return { status: "offline", modelCount: 0 };
    const data = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
    const ids = (data?.data ?? []).map((m) => String(m?.id ?? ""));
    const meterlessIds = ids.filter((id) => id.startsWith("meterless/"));
    if (meterlessIds.length === 0) return { status: "offline", modelCount: 0 };
    return { status: "online", modelCount: meterlessIds.length };
  } catch {
    return { status: "offline", modelCount: 0 };
  }
}

// Auto Detect: ports 8088, 8090, 8787 and 11434 on 127.0.0.1, localhost and [::1].
// Keeps the first hit that is online or unauthorized.
export async function autoDetect(
  token: string,
): Promise<{ url: string; status: Exclude<MeterlessStatus, "checking" | "unset">; modelCount: number } | null> {
  const results = await Promise.all(
    PROBE_HOSTS.flatMap((host) =>
      PROBE_PORTS.map(async (port) => {
        const url = `http://${host}:${port}/v1`;
        const outcome = await probe(url, token);
        return { url, ...outcome };
      }),
    ),
  );
  const hostOf = (url: string): string => {
    if (url.includes("[::1]")) return "[::1]";
    if (url.includes("localhost")) return "localhost";
    return "127.0.0.1";
  };
  const byPriority = (a: { url: string }, b: { url: string }) =>
    PROBE_HOSTS.indexOf(hostOf(a.url)) - PROBE_HOSTS.indexOf(hostOf(b.url));
  const hits = results
    .filter((r) => r.status === "online" || r.status === "unauthorized")
    .sort(byPriority);
  return hits[0] ?? null;
}

// Plain text requests stay a string, exactly like OpenAI. 180 s timeout because a
// cold model load can take minutes. Model ids are routing modes, not models.
export async function chat(opts: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  disposition?: string;
  token?: string;
  url?: string;
}): Promise<string> {
  const base = normalizeMeterlessUrl(opts.url ?? getStoredUrl());
  const token = opts.token ?? getStoredToken();
  if (!base || !token) throw new Error("Connect your Nightshift runtime first in the Nightshift AI panel.");
  const model = `meterless/${opts.disposition ?? "auto"}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: headers(token, { "Content-Type": "application/json", "meterless-scope": "user" }),
        body: JSON.stringify({ model, messages: opts.messages, stream: false }),
      },
      180_000,
    );
  } catch {
    throw new Error("Could not reach your Nightshift runtime. Is the tab or daemon still running?");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Nightshift rejected the auth token. Re-paste it in the Nightshift AI panel.");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Nightshift request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Nightshift returned an empty answer. Try again or switch routing mode.");
  return content;
}

export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function draftReplies(opts: { requestText: string; context?: string }): Promise<string[]> {
  const context = opts.context?.trim();
  const userMessage = context
    ? `Friend's request:\n"""\n${opts.requestText.slice(0, 4000)}\n"""\n\nResearch result to reply about:\n${context.slice(0, 3000)}`
    : opts.requestText.slice(0, 6000);
  const text = await chat({
    disposition: getRoutingMode(),
    messages: [
      {
        role: "system",
        content:
          "You draft WhatsApp reply messages for a person answering a friend's request. " +
          (context
            ? "Use the research result below for the facts, prices and names, and never invent details that are not in it. "
            : "") +
          'Return ONLY a JSON object {"replies": [three strings]} with exactly 3 ready-to-send replies in the same language as the request. ' +
          "Vary length: one short, one medium, one more detailed. Keep each reply natural, chat-style, self-contained, no numbering or quotes.",
      },
      { role: "user", content: userMessage },
    ],
  });
  const parsed = parseJsonReply(text) as { replies?: unknown } | unknown[] | null;
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.replies) ? parsed.replies : [];
  const replies = list.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 3);
  if (replies.length === 0) {
    // Fall back to the raw answer split into lines rather than failing the whole draft.
    const lines = text.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter((l) => l.length > 3);
    if (lines.length === 0) throw new Error("Nightshift could not draft a usable reply. Try again.");
    return lines.slice(0, 3);
  }
  return replies;
}

const ROUTING_KEY = "meterless_routing_mode";

export function getRoutingMode(): string {
  const stored = lsGet(ROUTING_KEY);
  return stored || "auto";
}

export function setRoutingMode(mode: string) {
  lsSet(ROUTING_KEY, mode);
}

export const ROUTING_MODES = ["auto", "fast", "deep", "cheap", "local", "fusion"] as const;
