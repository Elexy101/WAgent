import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export function AuthCard() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.href },
        });
        if (error) throw error;
        if (!data.session) setMsg("Check your email to confirm your account, then sign in.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr(null);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) setErr(r.error.message ?? "Google sign-in failed");
  }

  return (
    <section className="vn-panel mx-auto mt-8 max-w-md p-6">
      <h2 className="text-lg font-semibold">{mode === "in" ? "Sign in" : "Create your account"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your investigations, sources and decisions are saved to your private history.
      </p>
      <Button type="button" variant="outline" onClick={() => void google()} className="mt-5 w-full">
        Continue with Google
      </Button>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="vn-input"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="vn-input"
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "in" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      {msg && <p className="mt-3 text-sm text-brand">{msg}</p>}
      <Button
        type="button"
        variant="link"
        className="mt-4 text-xs text-muted-foreground underline"
        onClick={() => setMode(mode === "in" ? "up" : "in")}
      >
        {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
      </Button>
    </section>
  );
}
