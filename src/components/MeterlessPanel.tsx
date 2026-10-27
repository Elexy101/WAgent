import { useCallback, useEffect, useState } from "react";
import { Copy, Cpu, KeyRound, Loader2, PlugZap, RefreshCw, Send, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeterless } from "@/hooks/use-meterless";
import {
  autoDetect,
  draftReplies,
  getRoutingMode,
  getStoredToken,
  getStoredUrl,
  normalizeMeterlessUrl,
  publishMeterlessState,
  ROUTING_MODES,
  setRoutingMode,
  setStoredToken,
  setStoredUrl,
  type MeterlessStatus,
} from "@/lib/meterless";
import type { AgentResult } from "@/lib/agent.functions";

const STATUS_TEXT: Record<Exclude<MeterlessStatus, "checking">, string> = {
  unset: "Not connected",
  online: "Online",
  unauthorized: "Wrong token",
  offline: "Not reachable",
};

export function MeterlessSection() {
  const { state, refresh, setEnabled } = useMeterless();
  const [open, setOpen] = useState(false);
  const [urlPaste, setUrlPaste] = useState("");
  const [tokenPaste, setTokenPaste] = useState("");
  const [routing, setRouting] = useState<string>("auto");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const { status, modelCount, enabled } = state;

  useEffect(() => {
    setUrlPaste(getStoredUrl());
    setRouting(getRoutingMode());
    void refresh();
  }, [refresh]);

  const saveAndCheck = useCallback(async () => {
    const url = normalizeMeterlessUrl(urlPaste);
    const token = tokenPaste.trim() || getStoredToken();
    if (!url) {
      setNotice("That endpoint address does not look right. Paste it exactly as Nightshift shows it.");
      return;
    }
    if (!token) {
      setNotice("Paste your Nightshift auth token too.");
      return;
    }
    setStoredUrl(url);
    setStoredToken(token);
    setUrlPaste(url);
    setTokenPaste("");
    setNotice("");
    setBusy(true);
    publishMeterlessState({ status: "checking", modelCount, enabled });
    const out = await refresh();
    setBusy(false);
    setNotice(
      out.status === "online"
        ? `Connected. ${out.modelCount} routing modes available.`
        : out.status === "unauthorized"
          ? "Nightshift answered but rejected the token. Copy it again from the Nightshift setup screen."
          : "Nothing answered at that address. Keep the Nightshift tab open and try again.",
    );
  }, [urlPaste, tokenPaste, enabled, modelCount, refresh]);

  const detect = useCallback(async () => {
    setBusy(true);
    setNotice("");
    publishMeterlessState({ status: "checking", modelCount, enabled });
    const token = tokenPaste.trim() || getStoredToken();
    const hit = await autoDetect(token);
    if (hit) {
      setStoredUrl(hit.url);
      setUrlPaste(hit.url);
      if (tokenPaste.trim()) setStoredToken(token);
      setTokenPaste("");
      publishMeterlessState({ status: hit.status, modelCount: hit.modelCount, enabled });
      setNotice(
        hit.status === "online"
          ? `Found your runtime at ${hit.url}.`
          : `Found ${hit.url} but the token was rejected — paste it and save again.`,
      );
    } else {
      publishMeterlessState({ status: getStoredToken() ? "offline" : "unset", modelCount: 0, enabled });
      setNotice("No Nightshift runtime found on this computer's usual ports. Keep the Nightshift tab open, then retry.");
    }
    setBusy(false);
  }, [tokenPaste, enabled, modelCount]);

  function disconnect() {
    setStoredUrl("");
    setStoredToken("");
    setUrlPaste("");
    setTokenPaste("");
    publishMeterlessState({ status: "unset", modelCount: 0, enabled });
    setNotice("Disconnected. Your Nightshift connection was removed from this browser.");
  }

  const online = status === "online";

  return (
    <section className="vn-panel mt-7 p-4 sm:p-6" aria-label="Nightshift AI connection">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="size-4 text-brand" /> Nightshift AI
          <span className="vn-tag" data-state={status}>
            {status === "checking" ? <Loader2 className="size-3 animate-spin" /> : <Wifi className="size-3" />}
            {STATUS_TEXT[status === "checking" ? "unset" : status]}
            {online && enabled ? " · drafting replies" : ""}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Set up"}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Connect this app to your Meterless Nightshift runtime (the OpenAI-compatible endpoint on your machine).
            Your token stays in this browser and requests go straight from this page to your runtime — never through our servers.
          </p>
          <label className="block text-xs font-semibold text-muted-foreground">
            Runtime endpoint
            <input
              value={urlPaste}
              onChange={(e) => setUrlPaste(e.target.value)}
              placeholder="http://127.0.0.1:8088/v1"
              className="vn-input mt-1 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1"><KeyRound className="size-3" /> Auth token</span>
            <input
              type="password"
              value={tokenPaste}
              onChange={(e) => setTokenPaste(e.target.value)}
              placeholder={getStoredToken() ? "Saved — paste a new one to replace it" : "Paste the token from Nightshift's setup screen"}
              className="vn-input mt-1 font-mono text-xs"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void saveAndCheck()}>
              {busy ? <Loader2 className="animate-spin" /> : <PlugZap />} Save &amp; check
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void detect()}>
              <RefreshCw /> Auto detect
            </Button>
            {getStoredToken() || getStoredUrl() ? (
              <Button type="button" size="sm" variant="ghost" onClick={disconnect}>
                <WifiOff /> Disconnect
              </Button>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="sr-only">Routing mode</span>
            <select
              value={routing}
              onChange={(e) => {
                setRouting(e.target.value);
                setRoutingMode(e.target.value);
              }}
              className="vn-input"
              aria-label="Nightshift routing mode"
            >
              {ROUTING_MODES.map((mode) => <option key={mode} value={mode}>meterless/{mode}</option>)}
            </select>
            <span className="font-normal">routing mode</span>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[hsl(var(--brand))]"
            />
            Use Nightshift to draft WhatsApp replies when it is online
          </label>
          {notice ? <p className="text-xs text-muted-foreground" role="status">{notice}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function resultContext(result: AgentResult): string {
  const rec = result.options[result.recommended_index];
  const lines = [
    `Headline: ${result.headline}`,
    rec ? `Recommended option: ${rec.name} (${rec.provider}) — ${rec.total_price}${rec.rating && rec.rating !== "Not listed" ? `, rated ${rec.rating}` : ""}` : "",
    rec ? `Why: ${rec.highlights.join("; ")}` : "",
    result.why ? `Reasoning: ${result.why}` : "",
    result.caveats.length > 0 ? `Caveats to mention: ${result.caveats.join("; ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function NightshiftReplyDrafts({
  requestText,
  result,
}: {
  requestText: string;
  result: AgentResult;
}) {
  const { state } = useMeterless();
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(-1);

  const online = state.status === "online";

  async function run() {
    setBusy(true);
    setError("");
    try {
      const out = await draftReplies({ requestText, context: resultContext(result) });
      setDrafts(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nightshift could not draft replies.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(-1), 1500);
    } catch {
      setError("Copying failed — select the text manually.");
    }
  }

  if (!online) {
    return (
      <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        The reply above was written by the cloud model. Connect Nightshift above to draft replies on your own machine.
      </p>
    );
  }

  if (!state.enabled) {
    return (
      <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        Nightshift is connected. Turn on “Use Nightshift to draft WhatsApp replies” in the Nightshift AI panel to draft
        replies on your own machine.
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 className="animate-spin" /> : <Cpu />} Draft 3 replies with Nightshift
        </Button>
        {drafts ? <span className="text-xs text-muted-foreground">Drafted on your machine · {getRoutingMode()}</span> : null}
      </div>
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
      {drafts ? (
        <ul className="mt-3 space-y-2">
          {drafts.map((draft, index) => (
            <li key={index} className="vn-panel flex items-start justify-between gap-3 p-3">
              <span className="text-sm leading-relaxed whitespace-pre-wrap">{draft}</span>
              <span className="flex shrink-0 items-center gap-1">
                <a
                  className="vn-btn vn-btn-brand"
                  href={`https://wa.me/?text=${encodeURIComponent(draft)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Send this reply on WhatsApp"
                >
                  <Send className="size-4" />
                </a>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Copy reply"
                  onClick={() => void copy(index, draft)}
                >
                  {copied === index ? <span className="text-xs">✓</span> : <Copy />}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
