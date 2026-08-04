import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { generateDraft, saveDraft, setLeadStatus, systemSelfTest } from "@/lib/leads.functions";
import { runMission } from "@/lib/mission.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reddit Job Finder — buying-intent leads for your Business AI app" },
      {
        name: "description",
        content:
          "Scan Reddit with 40 parallel Playwright scanners, surface people actively looking to buy AI automation, and draft a personal reply only after you approve the lead.",
      },
      { property: "og:title", content: "Reddit Job Finder for Business AI" },
      {
        property: "og:description",
        content: "40 parallel scanners find buying-intent Reddit posts. You approve each lead before any draft is written.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type Lead = {
  id: string;
  post_url: string;
  author: string | null;
  subreddit: string | null;
  title: string | null;
  excerpt: string | null;
  summary: string | null;
  qualification_reason: string | null;
  problem: string | null;
  message: string | null;
  intent_score: number | null;
  posted_at: string | null;
  status: string;
  created_at: string;
};
type Run = { id: string; status: string; created_at: string };
type RunEvent = { id: string; run_id: string; kind: string; data: Record<string, unknown>; created_at: string };

function dedupe<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function timeAgo(iso: string | null) {
  if (!iso) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function HomePage() {
  const { userId, email } = useSession();
  if (userId === undefined) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (userId === null) return <AuthScreen />;
  return <Dashboard userId={userId} email={email} />;
}

function Dashboard({ userId, email }: { userId: string; email: string | null }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [selftest, setSelftest] = useState<{ checks: { name: string; ok: boolean; detail: string }[]; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const runMissionFn = useServerFn(runMission);
  const generateDraftFn = useServerFn(generateDraft);
  const saveDraftFn = useServerFn(saveDraft);
  const setStatusFn = useServerFn(setLeadStatus);
  const selfTestFn = useServerFn(systemSelfTest);

  // Leads + realtime
  useEffect(() => {
    supabase
      .from("prospects")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setLeads((data as Lead[]) ?? []));

    const ch = supabase
      .channel("leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, (p) => {
        const row = p.new as Lead;
        if (!row?.id) return;
        setLeads((prev) => dedupe([row, ...prev.filter((l) => l.id !== row.id)]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  // Latest run + its live events (keeps streaming after a tab reload)
  useEffect(() => {
    let alive = true;
    supabase
      .from("runs")
      .select("id, status, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => alive && setRun(((data as Run[]) ?? [])[0] ?? null));

    const ch = supabase
      .channel("runs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, (p) =>
        setRun((prev) => {
          const row = p.new as Run;
          if (!row?.id) return prev;
          return !prev || row.id === prev.id || new Date(row.created_at) > new Date(prev.created_at) ? row : prev;
        }),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const runId = run?.id;
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    supabase
      .from("run_events")
      .select("id, run_id, kind, data, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .then(({ data }) => alive && setEvents(dedupe((data as RunEvent[]) ?? [])));

    const ch = supabase
      .channel(`events-${runId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, (p) => {
        const ev = p.new as RunEvent;
        if (ev.run_id === runId) setEvents((prev) => dedupe([...prev, ev]));
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [runId]);

  const running = starting || run?.status === "running" || run?.status === "pending";

  const progress = useMemo(() => {
    const last = [...events].reverse().find((e) => e.kind === "progress");
    const d = (last?.data ?? {}) as Record<string, number | string>;
    const doneN = Number(d.streams_done ?? 0);
    const totalN = Number(d.streams_total ?? 0);
    return {
      phase: String(d.phase ?? (running ? "starting" : "idle")),
      done: doneN,
      total: totalN,
      candidates: Number(d.candidates ?? 0),
      evaluated: Number(d.evaluated ?? 0),
      leads: Number(d.leads ?? 0),
      stream: String(d.stream ?? ""),
      pct: totalN ? Math.min(99, Math.round((doneN / totalN) * 100)) : running ? 4 : 0,
    };
  }, [events, running]);

  const diagnostics = useMemo(() => {
    const ev = [...events].reverse().find((e) => e.kind === "diagnostics");
    return ev?.data as
      | { keywords?: string[]; subreddits?: string[]; candidates?: number; evaluated?: number; rejections?: { author: string; subreddit: string; title: string; url: string; reason: string }[] }
      | undefined;
  }, [events]);

  const visible = leads.filter((l) => l.status !== "dismissed");

  async function scan() {
    if (running) return;
    setError(null);
    setStarting(true);
    setEvents([]);
    try {
      const { runId: id } = await runMissionFn({ data: {} });
      setRun({ id, status: "running", created_at: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function approve(lead: Lead) {
    setDrafting(lead.id);
    setError(null);
    try {
      const { draft } = await generateDraftFn({ data: { prospectId: lead.id } });
      setEdits((p) => ({ ...p, [lead.id]: draft }));
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, message: draft, status: "drafted" } : l)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(null);
    }
  }

  async function runSelfTest() {
    setTesting(true);
    try {
      setSelftest(await selfTestFn({ data: {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
        <div className="brand-gradient grid size-7 place-items-center rounded-lg text-primary-foreground">
          <Target className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Reddit Job Finder</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="gap-2" onClick={runSelfTest} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            <span className="hidden sm:inline">Test wiring</span>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/settings">
              <Settings className="size-4" />
              <span className="hidden sm:inline">Mission</span>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={async () => {
              await supabase.auth.signOut();
            }}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
        <section className="surface p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Find people asking to buy business AI</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            One click launches 40 parallel Playwright scanners across business subreddits and buying-intent keywords.
            Nothing is ever posted automatically — you approve each lead, then a personal draft is written for your review.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg" className="gap-2 px-6 text-base" onClick={scan} disabled={running}>
              {running ? <Loader2 className="size-5 animate-spin" /> : <Radar className="size-5" />}
              {running ? "Scanning Reddit…" : "Scan for leads"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Runs on background workers — you can close this tab.
            </span>
          </div>

          {(running || progress.done > 0) && (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="capitalize">
                  {progress.phase}
                  {progress.stream ? ` · ${progress.stream}` : ""}
                </span>
                <span>
                  {progress.done}/{progress.total || 58} streams · {progress.candidates} posts · {progress.evaluated}{" "}
                  evaluated · {progress.leads} leads
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full bg-primary transition-all duration-500", running && "animate-pulse")}
                  style={{ width: `${running ? Math.max(progress.pct, 4) : 100}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
          {email && <p className="mt-4 text-xs text-muted-foreground">Signed in as {email}</p>}
        </section>

        {selftest && (
          <section className="surface mt-6 p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              {selftest.ok ? <Check className="size-4 text-success" /> : <TriangleAlert className="size-4 text-destructive" />}
              {selftest.ok ? "System status: 100% operational & fully wired" : "System status: needs attention"}
            </div>
            <ul className="mt-3 space-y-1.5 text-xs">
              {selftest.checks.map((c) => (
                <li key={c.name} className="flex gap-2">
                  {c.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> : <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">
              Qualified leads {visible.length ? `· ${visible.length}` : ""}
            </h2>
          </div>

          {visible.length === 0 && !running && (
            <div className="surface p-6 text-sm text-muted-foreground">
              No leads yet. Hit <span className="font-medium text-foreground">Scan for leads</span> to start.
              {diagnostics && (
                <div className="mt-4 space-y-2 text-xs">
                  <p className="font-medium text-foreground">Last scan found nothing. Here is exactly what was searched:</p>
                  <p>Subreddits: {(diagnostics.subreddits ?? []).map((s) => `r/${s}`).join(", ")}</p>
                  <p>Keywords: {(diagnostics.keywords ?? []).join(", ")}</p>
                  <p>
                    {diagnostics.candidates ?? 0} fresh posts collected · {diagnostics.evaluated ?? 0} evaluated
                  </p>
                  <ul className="space-y-1">
                    {(diagnostics.rejections ?? []).slice(0, 15).map((r) => (
                      <li key={r.url}>
                        <a href={r.url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                          u/{r.author} in r/{r.subreddit}
                        </a>{" "}
                        — {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {visible.map((lead) => {
            const draft = edits[lead.id] ?? lead.message ?? "";
            return (
              <article key={lead.id} className="surface lift p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">u/{lead.author ?? "unknown"}</span>
                  <span>r/{lead.subreddit ?? "unknown"}</span>
                  <span>{timeAgo(lead.posted_at ?? lead.created_at)}</span>
                  {typeof lead.intent_score === "number" && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      intent {lead.intent_score}
                    </span>
                  )}
                  <a
                    href={lead.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 underline decoration-dotted underline-offset-4"
                  >
                    Open post <ExternalLink className="size-3" />
                  </a>
                </div>

                <h3 className="mt-2 font-medium leading-snug">{lead.title}</h3>
                {(lead.summary ?? lead.problem) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Asking for: </span>
                    {lead.summary ?? lead.problem}
                  </p>
                )}
                {lead.qualification_reason && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Why it qualifies: </span>
                    {lead.qualification_reason}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" className="gap-2" onClick={() => approve(lead)} disabled={drafting === lead.id}>
                    {drafting === lead.id ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {draft ? "Redraft reply" : "Approve & draft reply"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2"
                    onClick={async () => {
                      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "dismissed" } : l)));
                      await setStatusFn({ data: { prospectId: lead.id, status: "dismissed" } });
                    }}
                  >
                    <X className="size-4" /> Not a fit
                  </Button>
                </div>

                {draft && (
                  <div className="mt-4">
                    <textarea
                      value={draft}
                      onChange={(e) => setEdits((p) => ({ ...p, [lead.id]: e.target.value }))}
                      rows={5}
                      className="w-full resize-y rounded-xl border bg-transparent p-3 text-sm outline-none focus:border-primary"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-2"
                        onClick={async () => {
                          await navigator.clipboard.writeText(draft);
                          setCopied(lead.id);
                          setTimeout(() => setCopied(null), 1500);
                          await saveDraftFn({ data: { prospectId: lead.id, message: draft } });
                        }}
                      >
                        {copied === lead.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                        {copied === lead.id ? "Copied" : "Copy reply"}
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="gap-2">
                        <a href={lead.post_url} target="_blank" rel="noreferrer">
                          Post it yourself <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Nothing is sent automatically — review, copy, and post it as yourself.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
