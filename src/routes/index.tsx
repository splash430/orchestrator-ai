import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  Check,
  Clock,
  Copy,
  ExternalLink,
  History,
  Loader2,
  MapPin,
  Play,
  Settings,
  Sparkles,
  Square,
  Target,
  TriangleAlert,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { getMission, runMission, stopMission } from "@/lib/mission.functions";
import { deleteThread, runCommand } from "@/lib/orchestrator.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Prospector — AI lead finder for your Business AI product" },
      {
        name: "description",
        content:
          "One button runs your saved mission: find recent Canadian Reddit posts asking for business AI, then write a tailored reply for each lead.",
      },
      { property: "og:title", content: "Prospector — AI lead finder" },
      {
        property: "og:description",
        content: "Run one saved mission to discover Canadian leads and personalised replies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type Mission = Awaited<ReturnType<typeof getMission>>;
type Thread = { id: string; title: string; updated_at: string };
type Message = {
  id: string;
  thread_id: string;
  role: string;
  content: { text?: string };
  created_at: string;
};
type Run = { id: string; thread_id: string; status: string; command: string; created_at: string };
type RunEvent = { id: string; run_id: string; kind: string; data: Record<string, unknown> };
type Prospect = {
  id: string;
  post_url: string;
  author: string | null;
  subreddit: string | null;
  title: string | null;
  problem: string | null;
  message: string | null;
  country_signal: string | null;
  intent_score: number | null;
  status: string;
  created_at: string;
};

function dedupe<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function HomePage() {
  const { userId } = useSession();
  const [mission, setMission] = useState<Mission | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [extra, setExtra] = useState("");
  const [starting, setStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getMissionFn = useServerFn(getMission);
  const runMissionFn = useServerFn(runMission);
  const stopMissionFn = useServerFn(stopMission);
  const runCommandFn = useServerFn(runCommand);
  const deleteThreadFn = useServerFn(deleteThread);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    getMissionFn().then(setMission).catch(() => {});
    supabase
      .from("threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .then(({ data }) => setThreads((data as Thread[]) ?? []));
  }, [userId, getMissionFn]);

  // Active mission thread
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setRuns([]);
      setEvents([]);
      return;
    }
    let alive = true;
    supabase
      .from("messages")
      .select("id, thread_id, role, content, created_at")
      .eq("thread_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data }) => alive && setMessages(dedupe((data as Message[]) ?? [])));
    supabase
      .from("runs")
      .select("id, thread_id, status, command, created_at")
      .eq("thread_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data }) => alive && setRuns((data as Run[]) ?? []));

    const ch = supabase
      .channel(`thread-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${activeId}` },
        (p) => setMessages((prev) => dedupe([...prev, p.new as Message])),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `thread_id=eq.${activeId}` },
        (p) => {
          const row = p.new as Run;
          setRuns((prev) => dedupe([...prev.filter((r) => r.id !== row.id), row]));
        },
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  const runIds = useMemo(() => runs.map((r) => r.id).join(","), [runs]);
  useEffect(() => {
    if (!runIds) {
      setEvents([]);
      return;
    }
    const ids = runIds.split(",");
    let alive = true;
    supabase
      .from("run_events")
      .select("id, run_id, kind, data")
      .in("run_id", ids)
      .order("created_at", { ascending: true })
      .then(({ data }) => alive && setEvents(dedupe((data as RunEvent[]) ?? [])));
    const ch = supabase
      .channel(`events-${ids[0]}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, (p) => {
        const ev = p.new as RunEvent;
        if (ids.includes(ev.run_id)) setEvents((prev) => dedupe([...prev, ev]));
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [runIds]);

  // Leads (all-time, newest first) + realtime
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("prospects")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setProspects((data as Prospect[]) ?? []));

    const ch = supabase
      .channel("prospects")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prospects" }, (p) =>
        setProspects((prev) => dedupe([p.new as Prospect, ...prev])),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  useEffect(() => {
    if (activeId) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, events, activeId]);

  const activeRun = runs.find((r) => r.status === "running" || r.status === "pending");
  const running = !!activeRun || starting;

  const runProspects = prospects;

  const status = starting
    ? "Starting"
    : activeRun
      ? "Running"
      : runs.length
        ? "Completed"
        : "Ready";

  async function start() {
    if (running || !userId) return;
    setError(null);
    setStarting(true);
    try {
      const { threadId } = await runMissionFn({
        data: { extraInstructions: extra.trim() || undefined },
      });
      setActiveId(threadId);
      setExtra("");
      setThreads((t) => [
        { id: threadId, title: "Mission run", updated_at: new Date().toISOString() },
        ...t.filter((x) => x.id !== threadId),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!activeRun) return;
    await stopMissionFn({ data: { runId: activeRun.id } });
    setRuns((prev) => prev.map((r) => (r.id === activeRun.id ? { ...r, status: "stopped" } : r)));
  }

  async function askInChat() {
    const command = extra.trim();
    if (!command || !userId) return;
    setExtra("");
    setStarting(true);
    try {
      const threadId = activeId;
      if (!threadId) {
        const { threadId: id } = await runMissionFn({ data: { extraInstructions: command } });
        setActiveId(id);
      } else {
        await runCommandFn({ data: { threadId, command } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const searched = events.filter((e) => e.kind === "log").length;
  const generated = runProspects.filter((p) => p.message).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
        <div className="brand-gradient grid size-7 place-items-center rounded-lg text-primary-foreground">
          <Target className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Prospector</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          AI lead finder for {mission?.product_name ?? "your product"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <History className="size-4" />
                <span className="hidden sm:inline">History</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] p-0">
              <SheetTitle className="border-b px-5 py-4 text-sm">Previous missions</SheetTitle>
              <div className="overflow-auto p-2">
                {threads.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">No missions yet.</p>
                )}
                {threads.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2",
                      activeId === t.id && "bg-accent",
                    )}
                  >
                    <button
                      className="flex-1 truncate py-2.5 text-left text-sm"
                      onClick={() => {
                        setActiveId(t.id);
                        setHistoryOpen(false);
                      }}
                    >
                      {t.title}
                    </button>
                    <button
                      aria-label="Delete mission"
                      onClick={async () => {
                        await deleteThreadFn({ data: { id: t.id } });
                        setThreads((prev) => prev.filter((x) => x.id !== t.id));
                        if (activeId === t.id) setActiveId(null);
                      }}
                      className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/settings">
              <Settings className="size-4" />
              <span className="hidden sm:inline">Mission</span>
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
        {/* Mission card + the one button */}
        <section className="surface p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                status === "Running" || status === "Starting"
                  ? "bg-primary/10 text-primary"
                  : status === "Completed"
                    ? "bg-success/10 text-success"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {status === "Running" || status === "Starting" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              {status}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3" /> {mission?.country ?? "Canada"} only
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3" /> {mission?.max_contacts ?? 30} leads max
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />{" "}
              {Math.round(((mission?.duration_minutes ?? 240) / 60) * 10) / 10}h · 1 reply every{" "}
              {Math.round((((mission as never as { contact_gap_seconds?: number })?.contact_gap_seconds ?? 150) / 6)) / 10} min
            </span>
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight md:text-3xl">
            Scan & Run — already set up
          </h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            I scan Reddit for {mission?.country ?? "Canadian"} people who just asked for help with
            bookings, scheduling, customer management or business AI — then write each one a tailored
            reply pointing to{" "}
            <a
              href={mission?.product_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4"
            >
              your product
            </a>
            .
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" className="gap-2 px-6 text-base" onClick={start} disabled={running}>
              {running ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Play className="size-5" />
              )}
              {running ? "Scanning & contacting…" : "Scan & Run"}
            </Button>
            {activeRun && (
              <Button size="lg" variant="outline" className="gap-2" onClick={stop}>
                <Square className="size-4" /> Stop
              </Button>
            )}
            <Button asChild size="lg" variant="ghost" className="gap-2">
              <Link to="/settings">
                <Settings className="size-4" /> Edit mission
              </Link>
            </Button>
          </div>

          {/* Optional extra instructions for this run only */}
          <div className="surface mt-6 flex items-end gap-2 border-dashed p-2">
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askInChat();
                }
              }}
              rows={2}
              placeholder="Optional: anything extra for this run (e.g. focus on salon and clinic owners in Ontario)"
              className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="icon"
              variant="secondary"
              className="size-9 shrink-0 rounded-xl"
              onClick={askInChat}
              disabled={!extra.trim() || starting}
              aria-label="Send extra instructions"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>

          {error && (
            <p className="mt-4 flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </section>

        {/* Stats */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Scans done" value={searched} />
          <Stat label="Leads found" value={runProspects.length} />
          <Stat label="Replies written" value={generated} />
          <Stat
            label="Target"
            value={`${runProspects.length}/${mission?.max_contacts ?? 30}`}
          />
        </section>

        {/* Live activity */}
        {activeId && (events.length > 0 || messages.length > 0) && (
          <section className="mt-6 space-y-3">
            {messages
              .filter((m) => m.role === "assistant")
              .map((m) => (
                <div key={m.id} className="surface whitespace-pre-wrap p-5 text-sm leading-relaxed">
                  {m.content.text}
                </div>
              ))}
            <details className="surface overflow-hidden text-sm">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-muted-foreground">
                {activeRun ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <Check className="size-4 text-success" />
                )}
                Live activity · {events.length} step{events.length === 1 ? "" : "s"}
              </summary>
              <ul className="space-y-1.5 border-t px-4 py-3 text-xs text-muted-foreground">
                {events.slice(-60).map((e) => (
                  <li key={e.id} className="break-words">
                    {describe(e)}
                  </li>
                ))}
              </ul>
            </details>
            <div ref={bottomRef} />
          </section>
        )}

        {/* Leads */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Leads &amp; ready-to-post replies
          </h2>
          {runProspects.length === 0 ? (
            <p className="surface mt-3 p-5 text-sm text-muted-foreground">
              No leads yet. Hit <strong>Run Mission</strong> — qualified {mission?.country ?? "Canadian"}{" "}
              prospects appear here as they're found, each with a reply written for their exact
              question.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {runProspects.map((p) => (
                <LeadCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function LeadCard({ p }: { p: Prospect }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState(p.status);

  async function mark(next: string) {
    setStatus(next);
    await supabase
      .from("prospects")
      .update({ status: next, posted_at: next === "sent" ? new Date().toISOString() : null })
      .eq("id", p.id);
  }

  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">u/{p.author ?? "unknown"}</span>
        {p.subreddit && <span>· r/{p.subreddit}</span>}
        {typeof p.intent_score === "number" && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            intent {p.intent_score}
          </span>
        )}
        {p.country_signal && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" /> {p.country_signal}
          </span>
        )}
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5",
            status === "sent" ? "bg-success/10 text-success" : "bg-muted",
          )}
        >
          {status}
        </span>
      </div>

      {p.title && <h3 className="mt-2 text-sm font-medium leading-snug">{p.title}</h3>}
      {p.problem && (
        <p className="mt-1 text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline size-3" />
          {p.problem}
        </p>
      )}

      {p.message && (
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-muted/60 p-3 text-sm leading-relaxed">
          {p.message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="gap-2"
          onClick={() => {
            navigator.clipboard.writeText(p.message ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy reply"}
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-2">
          <a href={p.post_url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" /> Open post
          </a>
        </Button>
        {status !== "sent" && (
          <Button size="sm" variant="ghost" className="gap-2" onClick={() => mark("sent")}>
            <Check className="size-4" /> Mark as posted
          </Button>
        )}
      </div>
    </article>
  );
}

function describe(e: RunEvent) {
  const d = e.data ?? {};
  if (e.kind === "log") return String(d.message ?? "Working…");
  if (e.kind === "prospect_found")
    return `Lead #${d.count}: u/${d.author} in r/${d.subreddit} (intent ${d.intent_score})`;
  if (e.kind === "mission_start")
    return `Mission started — up to ${d.maxContacts} ${d.country} leads over ${d.durationMinutes} min`;
  if (e.kind === "screenshot") return "Captured a browser screenshot";
  if (e.kind === "tool_call") return `Browser: ${String(d.name)}`;
  if (e.kind === "error") return `Issue: ${String(d.error ?? d.name)}`;
  return e.kind;
}
