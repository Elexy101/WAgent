// Meterless Nightshift hotspot adapter.
//
// Speaks the Meterless Nightshift runtime contract on top of a local Ollama
// server, so the app can talk "meterless/<disposition>" exactly like it would
// to the official runtime. Swap NIGHTSHIFT_URL/NIGHTSHIFT_TOKEN for a genuine
// Nightshift install and nothing in the app changes.
//
// Contract points implemented (Meterless Runtime hotspot docs):
//   GET  /v1/models            -> ids "meterless/auto|fast|deep|cheap|local|fusion"
//   GET  /healthz              -> liveness
//   POST /v1/chat/completions  -> OpenAI shape, model id is a routing disposition
//   POST /v1/audio/transcriptions -> optional, proxied to a whisper.cpp server
//   Authorization: Bearer <token>, token stored in <stateDir>/proxy-token
//   meterless-app: <app id> header on every request

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NIGHTSHIFT_PORT ?? 8088);
const STATE_DIR = resolve(process.env.NIGHTSHIFT_STATE_DIR ?? join(HERE, ".state"));
const TOKEN_FILE = join(STATE_DIR, "proxy-token");
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const WHISPER_URL = process.env.WHISPER_URL ? process.env.WHISPER_URL.replace(/\/+$/, "") : "";
const REQUIRE_APP_HEADER = process.env.NIGHTSHIFT_REQUIRE_APP_HEADER === "1";
const APP_HEADER = process.env.NIGHTSHIFT_APP_ID ?? "voicereply-web";
const REQUEST_TIMEOUT_MS = Number(process.env.NIGHTSHIFT_TIMEOUT_MS ?? 240000);

const DISPOSITIONS = ["auto", "fast", "deep", "cheap", "local", "fusion"];

const MODEL_DEFAULTS = {
  auto: "qwen2.5:3b-instruct-q4_K_M",
  fast: "qwen2.5:1.5b-instruct-q4_K_M",
  deep: "qwen2.5:7b-instruct-q4_K_M",
  cheap: "qwen2.5:1.5b-instruct-q4_K_M",
  local: "qwen2.5:3b-instruct-q4_K_M",
  fusion: "qwen2.5:3b-instruct-q4_K_M",
};

function modelFor(disposition) {
  const key = disposition.toUpperCase();
  return process.env[`NIGHTSHIFT_MODEL_${key}`] || MODEL_DEFAULTS[disposition] || MODEL_DEFAULTS.auto;
}

let cachedToken = null;

async function ensureToken() {
  if (cachedToken) return cachedToken;
  if (process.env.NIGHTSHIFT_TOKEN) {
    cachedToken = process.env.NIGHTSHIFT_TOKEN.trim();
    return cachedToken;
  }
  try {
    cachedToken = (await readFile(TOKEN_FILE, "utf8")).trim();
    if (cachedToken) return cachedToken;
  } catch {
    /* generated below */
  }
  await mkdir(STATE_DIR, { recursive: true });
  cachedToken = randomBytes(24).toString("hex");
  await writeFile(TOKEN_FILE, `${cachedToken}\n`, { mode: 0o600 });
  console.log(`[nightshift] generated proxy token at ${TOKEN_FILE}`);
  return cachedToken;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,meterless-app,meterless-scope",
    "access-control-max-age": "600",
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...corsHeaders(),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function authorized(req, token) {
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return presented.length > 0 && presented === token;
}

function dispositionFromModel(model) {
  const raw = String(model ?? "").trim();
  const id = raw.startsWith("meterless/") ? raw.slice("meterless/".length) : raw;
  const base = id.split(".")[0];
  return DISPOSITIONS.includes(base) ? base : "auto";
}

function extractJsonSchema(responseFormat) {
  if (!responseFormat || typeof responseFormat !== "object") return null;
  if (responseFormat.type === "json_schema" && responseFormat.json_schema) {
    const schema = responseFormat.json_schema.schema ?? responseFormat.json_schema;
    if (schema && typeof schema === "object") return schema;
  }
  return null;
}

function looksLikeJson(text) {
  const trimmed = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return /[[{]/.test(trimmed);
  }
}

async function ollamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function listOllamaModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.models) ? data.models.map((m) => String(m?.name ?? "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function callOllama({ model, messages, format, jsonMode }) {
  const body = {
    model,
    messages,
    stream: false,
    options: { temperature: 0.2, num_ctx: 8192 },
  };
  if (format) body.format = format;
  else if (jsonMode) body.format = "json";

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ollama ${res.status}: ${detail.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data?.message?.content ?? "";
  return {
    content: typeof content === "string" ? content : JSON.stringify(content),
    usage: {
      prompt_tokens: data?.prompt_eval_count ?? 0,
      completion_tokens: data?.eval_count ?? 0,
    },
  };
}

function buildMessages(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : m?.role === "system" ? "system" : "user",
      content: String(m?.content ?? ""),
    }))
    .filter((m) => m.content.length > 0);
}

async function handleChat(req, res, body) {
  const messages = buildMessages(body);
  if (messages.length === 0) {
    sendJson(res, 400, { error: { message: "messages is required", type: "invalid_request_error" } });
    return;
  }
  const disposition = dispositionFromModel(body?.model);
  const schema = extractJsonSchema(body?.response_format);
  const wantsJson = schema !== null || body?.response_format?.type === "json_object";
  const primary = modelFor(disposition);

  let result;
  try {
    result = await callOllama({ model: primary, messages, format: schema ?? undefined, jsonMode: wantsJson });
  } catch (error) {
    sendJson(res, 502, {
      error: { message: `runtime model call failed: ${error instanceof Error ? error.message : String(error)}`, type: "runtime_error" },
    });
    return;
  }

  // Repair pass: the model answered, but not in the shape we asked for.
  if (wantsJson && !looksLikeJson(result.content)) {
    const repaired = [...messages, { role: "user", content: "That reply was not valid JSON. Reply with the JSON object only, no prose and no code fences." }];
    for (const model of [modelFor("fast"), modelFor("deep")].filter((m) => m && m !== primary)) {
      try {
        const retry = await callOllama({ model, messages: repaired, format: schema ?? undefined, jsonMode: wantsJson });
        if (looksLikeJson(retry.content)) {
          result = retry;
          break;
        }
      } catch {
        /* try the next fallback model */
      }
    }
  }

  const payload = {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: `meterless/${disposition}`,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
    },
  };
  sendJson(res, 200, payload);
}

async function handleTranscription(req, res, raw) {
  if (!WHISPER_URL) {
    sendJson(res, 501, {
      error: { message: "no speech-to-text backend configured on this runtime (set WHISPER_URL)", type: "not_supported" },
    });
    return;
  }
  const contentType = req.headers["content-type"] ?? "multipart/form-data";
  const upstream = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: raw,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", ...corsHeaders() });
  res.end(text);
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (path === "/healthz" || path === "/v1/healthz") {
    const [ollama, models] = await Promise.all([ollamaAvailable(), listOllamaModels()]);
    sendJson(res, 200, {
      status: ollama ? "ok" : "degraded",
      ollama,
      ollama_models: models,
      dispositions: Object.fromEntries(DISPOSITIONS.map((d) => [d, modelFor(d)])),
    });
    return;
  }

  const token = await ensureToken();
  if (!authorized(req, token)) {
    sendJson(res, 401, { error: { message: "invalid or missing bearer token", type: "invalid_request_error" } });
    return;
  }
  if (REQUIRE_APP_HEADER && !req.headers["meterless-app"]) {
    sendJson(res, 400, { error: { message: "meterless-app header is required", type: "invalid_request_error" } });
    return;
  }

  if (path === "/v1/models" && req.method === "GET") {
    const models = DISPOSITIONS.map((disposition) => ({
      id: `meterless/${disposition}`,
      object: "model",
      created: 0,
      owned_by: "meterless",
      disposition,
      upstream_model: modelFor(disposition),
    }));
    sendJson(res, 200, { object: "list", data: models });
    return;
  }

  if (path === "/v1/chat/completions" && req.method === "POST") {
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: { message: "body must be valid JSON", type: "invalid_request_error" } });
      return;
    }
    await handleChat(req, res, body);
    return;
  }

  if (path === "/v1/audio/transcriptions" && req.method === "POST") {
    const raw = await readBody(req);
    await handleTranscription(req, res, raw);
    return;
  }

  sendJson(res, 404, { error: { message: `no route for ${req.method} ${path}`, type: "invalid_request_error" } });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[nightshift] request failed", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: { message: String(error?.message ?? error), type: "server_error" } });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, "127.0.0.1", async () => {
  await ensureToken();
  console.log(`[nightshift] listening on http://127.0.0.1:${PORT}/v1 (upstream ${OLLAMA_URL})`);
});
