import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Brain,
  Loader2,
  Play,
  Plug,
  Plus,
  Sparkle,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useRequireSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, STATUS_TONE } from "@/lib/agent-ui";
import { listMemories, type Memory } from "@/lib/memory";
import { createThread } from "@/lib/orchestrator.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Home — Operator AI assistant" },
      {
        name: "description",
        content:
          "Your AI browser assistant home: start automations, review recent tasks and see live agent activity.",
      },
      { property: "og:title", content: "Home — Operator AI assistant" },
      {
        property: "og:description",
        content: "Start automations, review recent tasks and watch your AI agent work live.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

type Run = {
  id: string;
  thread_id: string;
  command: string;
  status: string;
  created_at: string;
};
type Ev = { id: string; kind: string; data: Record<string, unknown>; created_at: string };

function DashboardPage() {
  const { userId, email } = useRequireSession();
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [creating, setCreating] = useState(false);
  const createThreadFn = useServerFn(createThread);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("runs")
      .select("id, thread_id, command, status, created_at")
      .order("created_at", { ascending: false })
      .limit(6)
      .then(({ data }) => setRuns((data as Run[]) ?? []));
    supabase
      .from("run_events")
      .select("id, kind, data, created_at")
      .order("created_at", { ascending: false })
      .limit(12)
      .then(({ data }) => setEvents((data as Ev[]) ?? []));
    listMemories().then(setMemories).catch(() => {});

    const ch = supabase
      .channel("dashboard-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, (p) =>
        setEvents((prev) => [p.new as Ev, ...prev].slice(0, 12)),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, () => {
        supabase
          .from("runs")
          .select("id, thread_id, command, status, created_at")
          .order("created_at", { ascending: false })
          .limit(6)
          .then(({ data }) => setRuns((data as Run[]) ?? []));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const active = runs.filter((r) => r.status === "running" || r.status === "pending");
  const name = email?.split("@")[0] ?? "there";

  async function startNew() {
    setCreating(true);
    try {
      const { id } = await createThreadFn({ data: {} });
      window.location.href = "/chat";
    } finally {
      setCreating(false);
    }
  }

  if (userId === undefined) return <LoadingScreen />;
  if (userId === null) return null;

  return (
    <AppShell title="Home" subtitle="Your assistant at a glance">
      {/* Welcome */}
      <section className="surface fade-up relative overflow-hidden p-6 md:p-8">
        <div className="brand-gradient pointer-events-none absolute -right-16 -top-20 size-56 rounded-full opacity-15 blur-2xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkle className="size-3.5" /> Assistant ready
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
            Hi {name} — what should I work on?
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Describe a task in plain English. I&apos;ll plan it, open a real browser, collect what
            I find, and write anything you need — using everything I remember about you.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={startNew} disabled={creating} className="gap-2 rounded-xl">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create automation
            </Button>
            <Button asChild variant="outline" className="gap-2 rounded-xl">
              <Link to="/tasks">
                <Play className="size-4" /> Run a previous task
              </Link>
            </Button>
            <Button asChild variant="outline" className="gap-2 rounded-xl">
              <Link to="/memory">
                <Brain className="size-4" /> View memory
              </Link>
            </Button>
            <Button asChild variant="ghost" className="gap-2 rounded-xl">
              <Link to="/integrations">
                <Plug className="size-4" /> Integrations
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Recent tasks"
            action={
              <Link to="/tasks" className="text-xs text-primary hover:underline">
                See all
              </Link>
            }
          >
            {runs.length === 0 ? (
              <Empty text="No tasks yet — your first automation will show up here." />
            ) : (
              <ul className="divide-y">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_TONE[r.status] ?? STATUS_TONE.pending,
                      )}
                    >
                      {r.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{r.command}</span>
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {relativeTime(r.created_at)}
                    </span>
                    <Link
                      to="/chat"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Open task"
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Active automations">
            {active.length === 0 ? (
              <Empty text="Nothing running right now." />
            ) : (
              <ul className="space-y-3">
                {active.map((r) => (
                  <li key={r.id} className="rounded-xl border bg-muted/40 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span className="truncate">{r.command}</span>
                    </div>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                      Started {relativeTime(r.created_at)} · browser session in progress
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="AI activity feed">
            {events.length === 0 ? (
              <Empty text="The agent hasn't done anything yet." />
            ) : (
              <ol className="relative space-y-4 pl-4">
                <span className="absolute left-[3px] top-1 h-[calc(100%-0.5rem)] w-px bg-border" />
                {events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-4 top-1.5 size-1.5 rounded-full bg-primary" />
                    <p className="text-sm">{describeEvent(e)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {relativeTime(e.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel
            title="Memory highlights"
            action={
              <Link to="/memory" className="text-xs text-primary hover:underline">
                Manage
              </Link>
            }
          >
            {memories.length === 0 ? (
              <Empty text="Tell the assistant about your business and it will remember." />
            ) : (
              <ul className="space-y-2">
                {memories.slice(0, 4).map((m) => (
                  <li key={m.id} className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                    {m.content}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

export function describeEvent(e: { kind: string; data: Record<string, unknown> }) {
  switch (e.kind) {
    case "tool_call":
      return `Using ${String(e.data.name ?? "a browser tool")}…`;
    case "tool_result":
      return `Got results from ${String(e.data.name ?? "the browser")}`;
    case "screenshot":
      return "Captured a screenshot of the page";
    case "error":
      return `Error: ${String(e.data.error ?? "unknown")}`;
    default:
      return String(e.data.message ?? e.kind);
  }
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface fade-up p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading…
    </div>
  );
}
