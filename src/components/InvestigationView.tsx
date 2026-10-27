import { useState } from "react";
import { Check, CircleAlert, Copy, ExternalLink, Search, Send, ShieldCheck, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NightshiftReplyDrafts } from "@/components/MeterlessPanel";
import type { AgentResult } from "@/lib/agent.functions";

type Source = { title: string; url: string; date?: string | null };

export function InvestigationView(props: {
  result: AgentResult;
  queries: string[];
  sources: Source[];
  checkedAt: string;
  decision: string;
  requestText?: string;
  decidedOption?: string | null | undefined;
  onDecide?: (decision: "confirmed" | "declined", option: string, url: string) => void;
}) {
  const { result, queries, sources, checkedAt, decision } = props;
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const rec = result.options[result.recommended_index];
  const minsAgo = Math.max(0, Math.round((Date.now() - new Date(checkedAt).getTime()) / 60000));

  return (
    <div className="space-y-5">
      <section className="vn-panel p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="vn-tag">
            <ShieldCheck className="size-3" /> Confidence: {result.confidence}
          </span>
          <span className="vn-tag">Checked {minsAgo < 1 ? "just now" : `${minsAgo} min ago`}</span>
          <span className="vn-tag">{sources.length} sources</span>
        </div>
        <h2 className="mt-3 text-xl font-bold leading-snug">{result.headline}</h2>
        <p className="mt-2 text-sm text-muted-foreground">I understood: {result.understood_request}</p>

        {result.assumptions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Assumptions I made</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {result.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {result.clarifying_questions.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Details that could change the result</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {result.clarifying_questions.map((question, i) => <li key={i}>{question}</li>)}
            </ul>
          </div>
        )}
      </section>

      {rec && (
        <section className="vn-panel border-brand/60 p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-brand">
            <Trophy className="size-4" /> Recommended: {rec.name}
          </h3>
          <p className="mt-3 text-[0.95rem] leading-relaxed">{result.why}</p>
          {result.rejected_reasoning.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Why not the others</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {result.rejected_reasoning.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5">
            {decision === "confirmed" ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-brand">
                <Check className="size-4" /> You confirmed {props.decidedOption ?? rec.name}
              </p>
            ) : decision === "declined" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <X className="size-4" /> You declined this recommendation
              </p>
            ) : props.onDecide && !showConfirm ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setShowConfirm(true)}>
                  Book / order this
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => props.onDecide?.("declined", rec.name, "")}
                >
                  Not this one
                </Button>
              </div>
            ) : props.onDecide ? (
              <div className="rounded-[var(--radius-lg)] border border-border bg-surface-2 p-4">
                <p className="text-sm">
                  Confirm <b>{rec.name}</b> for <b>{rec.total_price}</b>? I'll open{" "}
                  {rec.action_url ? new URL(rec.action_url).hostname : "the provider"} so you can finish and pay there.
                  Prices can change — check the final total before paying.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    onClick={() => props.onDecide?.("confirmed", rec.name, rec.action_url)}
                  >
                    YES, continue
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowConfirm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="px-1 text-sm font-semibold text-muted-foreground">Options compared</h3>
        {result.options.map((o, i) => (
          <article key={i} className={`vn-panel p-5 ${i === result.recommended_index ? "border-brand/60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{o.name}</p>
                <p className="text-xs text-muted-foreground">{o.provider}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-brand">{o.total_price}</p>
                <p className="text-xs text-muted-foreground">Rating: {o.rating}</p>
              </div>
            </div>
            <p className="mt-3 text-sm">{o.price_breakdown}</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              {o.highlights.length > 0 && (
                <ul className="space-y-1">
                  {o.highlights.map((h, j) => (
                    <li key={j} className="flex gap-1.5">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-brand" /> {h}
                    </li>
                  ))}
                </ul>
              )}
              {o.drawbacks.length > 0 && (
                <ul className="space-y-1 text-muted-foreground">
                  {o.drawbacks.map((h, j) => (
                    <li key={j} className="flex gap-1.5">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {o.source_url && (
              <a
                href={o.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-brand underline"
              >
                Source: {o.source_title || new URL(o.source_url).hostname} <ExternalLink className="size-3" />
              </a>
            )}
          </article>
        ))}
      </section>

      {result.caveats.length > 0 && (
        <section className="vn-panel p-5">
          <h3 className="text-sm font-semibold text-muted-foreground">Verify before paying</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {result.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="vn-panel p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Send className="size-4 text-brand" /> Reply to your friend
        </h3>
        <p className="mt-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap">{result.whatsapp_reply}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className="vn-btn vn-btn-brand"
            href={`https://wa.me/?text=${encodeURIComponent(result.whatsapp_reply)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Send className="size-4" /> Send on WhatsApp
          </a>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(result.whatsapp_reply);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <NightshiftReplyDrafts requestText={props.requestText ?? result.understood_request} result={result} />
      </section>

      <details className="vn-panel p-5">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Search className="size-4" /> Audit trail — what I searched and read
        </summary>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase">Searches</p>
            <ul className="mt-1 list-disc pl-5">
              {queries.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase">Pages read</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                    {s.title || s.url}
                  </a>
                  {s.date ? <span className="text-muted-foreground"> · {s.date}</span> : null}
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">Searched at {new Date(checkedAt).toLocaleString()}</p>
        </div>
      </details>
    </div>
  );
}
