import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Clock3,
  FileAudio2,
  Loader2,
  LogOut,
  MapPin,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/AuthCard";
import { InvestigationView } from "@/components/InvestigationView";
import { MeterlessSection } from "@/components/MeterlessPanel";
import { useAuth } from "@/hooks/use-auth";
import { fileToWav } from "@/lib/audio-wav";
import { takeSharedFile } from "@/lib/register-sw";
import { investigate, recordDecision, type AgentResult } from "@/lib/agent.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoiceReply — Evidence-backed recommendations" },
      {
        name: "description",
        content:
          "Compare flights, food, groceries, products and places with live web sources, clear reasoning and private saved history.",
      },
      { property: "og:title", content: "VoiceReply — Evidence-backed recommendations" },
      {
        property: "og:description",
        content: "Turn a voice note or message into a sourced comparison and a clear next step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CATEGORIES = [
  { id: "auto", label: "Auto-detect" },
  { id: "flights", label: "Flights" },
  { id: "food", label: "Food & restaurants" },
  { id: "supermarket", label: "Supermarkets" },
  { id: "product", label: "Products" },
  { id: "places", label: "Places" },
] as const;

const PRIORITIES = [
  { id: "cheapest", label: "Cheapest total" },
  { id: "best_rated", label: "Best rated" },
  { id: "fastest", label: "Fastest" },
  { id: "balanced", label: "Best balance" },
] as const;

type Category = (typeof CATEGORIES)[number]["id"];
type Priority = (typeof PRIORITIES)[number]["id"];
type Stage = "idle" | "decoding" | "transcribing" | "researching";
type EvidenceSource = { title: string; url: string; date?: string | null };
type HistoryRow = {
  id: string;
  request_text: string;
  source: string;
  category: string | null;
  location: string | null;
  priority: string | null;
  queries: string[];
  sources: EvidenceSource[];
  result: AgentResult;
  decision: string;
  decided_option: string | null;
  created_at: string;
};
type ActiveResult = {
  id: string;
  createdAt: string;
  checkedAt: string;
  requestText: string;
  queries: string[];
  sources: EvidenceSource[];
  result: AgentResult;
  decision: string;
  decidedOption?: string | null;
};

function Index() {
  const { user, loading: authLoading } = useAuth();
  const runInvestigation = useServerFn(investigate);
  const saveDecision = useServerFn(recordDecision);
  const audioInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<Category>("auto");
  const [priority, setPriority] = useState<Priority>("cheapest");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [active, setActive] = useState<ActiveResult | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [audioName, setAudioName] = useState("");
  const busy = stage !== "idle";

  const refreshHistory = useCallback(async () => {
    if (!user) return;
    const { data, error: readError } = await supabase
      .from("investigations")
      .select("id, request_text, source, category, location, priority, queries, sources, result, decision, decided_option, created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    if (readError) {
      setError("Could not load your saved history. Please try again.");
      return;
    }
    setHistory((data ?? []) as unknown as HistoryRow[]);
  }, [user]);

  useEffect(() => {
    if (user) void refreshHistory();
    else {
      setHistory([]);
      setActive(null);
      setActiveId(null);
    }
  }, [user, refreshHistory]);

  const runText = useCallback(
    async (text: string, source: "voice" | "text") => {
      if (!user) {
        setError("Sign in to search and save this investigation.");
        return;
      }
      setError(null);
      setStage("researching");
      setActive(null);
      setActiveId(null);
      try {
        const out = await runInvestigation({
          data: {
            text,
            source,
            category,
            location: location.trim() || undefined,
            priority,
          },
        });
        const next: ActiveResult = {
          id: out.id,
          createdAt: out.createdAt,
          checkedAt: out.checkedAt,
          requestText: text,
          queries: out.queries,
          sources: out.sources,
          result: out.result,
          decision: "pending",
        };
        setActive(next);
        setActiveId(next.id);
        setHistoryOpen(false);
        await refreshHistory();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The search could not be completed.");
      } finally {
        setStage("idle");
      }
    },
    [user, runInvestigation, category, location, priority, refreshHistory],
  );

  const runAudio = useCallback(
    async (file: File) => {
      if (!user) {
        setPendingAudio(file);
        setAudioName(file.name);
        setError("Sign in to transcribe and investigate this voice note.");
        return;
      }
      setError(null);
      setAudioName(file.name);
      try {
        setStage("decoding");
        const wav = await fileToWav(file);
        setStage("transcribing");
        const form = new FormData();
        form.append("file", wav, "voice-note.wav");
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Sign in again to transcribe this voice note.");
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || "Could not transcribe that voice note.");
        }
        const payload = (await response.json()) as { text?: string };
        if (!payload.text?.trim()) throw new Error("No speech was detected in that voice note.");
        setMessage(payload.text);
        await runText(payload.text, "voice");
      } catch (e) {
        setError(e instanceof Error ? e.message : "The voice note could not be processed.");
        setStage("idle");
      }
    },
    [user, runText],
  );

  useEffect(() => {
    if (!user || !pendingAudio || busy) return;
    const file = pendingAudio;
    setPendingAudio(null);
    void runAudio(file);
  }, [user, pendingAudio, busy, runAudio]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("shared") !== "true") return;
    window.history.replaceState(null, "", window.location.pathname);
    void takeSharedFile().then((file) => {
      if (cancelled) return;
      if (file) {
        setAudioName(file.name);
        setPendingAudio(file);
      } else setError("That shared voice note could not be read. Choose the audio file to continue.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectHistory(row: HistoryRow) {
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const queries = Array.isArray(row.queries) ? row.queries : [];
    const result = row.result as AgentResult;
    setActive({
      id: row.id,
      createdAt: row.created_at,
      checkedAt: row.created_at,
      requestText: row.request_text,
      queries,
      sources,
      result,
      decision: row.decision,
      decidedOption: row.decided_option,
    });
    setActiveId(row.id);
    setHistoryOpen(false);
    setError(null);
  }

  async function decide(decision: "confirmed" | "declined", option: string, url: string) {
    if (!active) return;
    let handoff: Window | null = null;
    if (decision === "confirmed" && url) handoff = window.open("about:blank", "_blank");
    try {
      await saveDecision({ data: { id: active.id, decision, option } });
      setActive({ ...active, decision, decidedOption: option });
      await refreshHistory();
      if (handoff && url) handoff.location.href = url;
      else if (decision === "confirmed" && url) window.location.assign(url);
    } catch (e) {
      handoff?.close();
      setError(e instanceof Error ? e.message : "Could not save your confirmation.");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const stageLabel =
    stage === "decoding"
      ? "Preparing voice note…"
      : stage === "transcribing"
        ? "Transcribing voice note…"
        : stage === "researching"
          ? "Searching sources and comparing options…"
          : "";

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-7 sm:py-12">
      <div className="vn-glow pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <div className="relative mx-auto w-full max-w-3xl">
        <header className="flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 font-semibold" aria-label="VoiceReply home">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-brand">
              <AudioLines className="size-5" />
            </span>
            <span>VoiceReply</span>
          </a>
          {user ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden max-w-44 truncate text-xs text-muted-foreground sm:block">{user.email}</span>
              <Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={() => void signOut()}>
                <LogOut />
              </Button>
            </div>
          ) : null}
        </header>

        <section className="mt-10">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-brand uppercase">
            <Sparkles className="size-4" /> Live research · Evidence first
          </div>
          <h1 className="mt-3 max-w-2xl text-3xl leading-tight font-bold sm:text-4xl">
            Get a clear answer, <span className="vn-brand-text">with the why.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Send a voice note or paste a message. Compare flights, restaurants, groceries, products and places across live sources.
          </p>
        </section>

        {authLoading ? (
          <div className="vn-panel mt-8 flex items-center justify-center p-10" aria-label="Loading account">
            <Loader2 className="size-5 animate-spin text-brand" />
          </div>
        ) : !user ? (
          <AuthCard />
        ) : (
          <>
            <section className="vn-panel mt-7 p-4 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquareText className="size-4 text-brand" /> What did your friend ask for?
              </div>
              <textarea
                aria-label="Message or voice-note transcript"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Paste the message here — e.g. “Find me a cheap flight from Lagos to Abuja next Friday.”"
                rows={4}
                maxLength={8000}
                className="vn-input mt-4 min-h-28 resize-y leading-relaxed"
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <MapPin className="size-4 text-brand" />
                  <span className="sr-only">City or area</span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City or area (if relevant)"
                    maxLength={120}
                    className="vn-input"
                  />
                </label>
                <label className="text-xs font-semibold text-muted-foreground">
                  <span className="sr-only">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    className="vn-input"
                    aria-label="Category"
                  >
                    {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <span className="text-xs font-semibold text-muted-foreground">Prioritize</span>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Recommendation priority">
                  {PRIORITIES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-active={priority === item.id}
                      className="vn-chip"
                      onClick={() => setPriority(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                ref={audioInput}
                type="file"
                accept="audio/*,.opus,.ogg,.m4a,.mp3,.wav"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void runAudio(file);
                  e.target.value = "";
                }}
              />
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={busy || message.trim().length < 2}
                  onClick={() => void runText(message.trim(), "text")}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Search />}
                  {busy ? stageLabel : "Investigate"}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => audioInput.current?.click()}>
                  <FileAudio2 /> {audioName ? "Choose another voice note" : "Add voice note"}
                </Button>
                {audioName ? <span className="max-w-full truncate text-xs text-muted-foreground">{audioName}</span> : null}
              </div>
              {error ? (
                <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {busy ? (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" /> {stageLabel}
                </p>
              ) : null}
              <p className="mt-4 text-xs text-muted-foreground">
                You review the sources and confirm before any booking or order link opens. Payment happens on the provider’s site.
              </p>
            </section>

            <MeterlessSection />

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock3 className="size-4 text-brand" /> Your investigations
                <span className="vn-tag">{history.length}</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={historyOpen ? "secondary" : "ghost"} size="sm" onClick={() => {
                  setHistoryOpen(!historyOpen);
                  setActive(null);
                  setActiveId(null);
                }}>
                  <Clock3 /> History
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                  setHistoryOpen(false);
                  setActive(null);
                  setActiveId(null);
                  setMessage("");
                  setError(null);
                }}>
                  <Plus /> New
                </Button>
              </div>
            </div>

            {historyOpen ? (
              <section className="mt-4 space-y-2" aria-label="Saved investigations">
                {history.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Your saved investigations will appear here.</p>
                ) : history.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    data-active={activeId === row.id}
                    className="vn-panel w-full p-4 text-left transition-colors hover:border-brand/60"
                    onClick={() => selectHistory(row)}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-medium">{row.request_text}</span>
                      <span className="vn-tag">{row.decision === "confirmed" ? <Check className="size-3" /> : null}{row.decision}</span>
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()} · {row.category ?? row.source}
                    </span>
                  </button>
                ))}
              </section>
            ) : active ? (
              <section className="mt-5" aria-label="Investigation results">
                <InvestigationView
                  result={active.result}
                  queries={active.queries}
                  sources={active.sources}
                  checkedAt={active.checkedAt}
                  decision={active.decision}
                  requestText={active.requestText}
                  decidedOption={active.decidedOption}
                  onDecide={(decision, option, url) => void decide(decision, option, url)}
                />
              </section>
            ) : (
              <section className="mt-8 py-8 text-center">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-surface text-brand">
                  {pendingAudio ? <Loader2 className="size-6 animate-spin" /> : <Send className="size-6" />}
                </div>
                <p className="mt-4 text-sm font-medium">
                  {pendingAudio ? "Your shared note is ready" : "Ready when your friend sends something"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingAudio ? "Processing will begin as soon as you sign in." : "Your first search will appear here with sources and a clear recommendation."}
                </p>
              </section>
            )}
          </>
        )}

        <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Check className="size-3.5 text-brand" /> Source-backed comparisons</span>
          <span>Private saved history</span>
          <span>Payment stays on provider sites</span>
        </footer>
      </div>
    </main>
  );
}
