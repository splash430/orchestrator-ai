import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  Camera,
  Check,
  History,
  Loader2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { createThread, deleteThread, renameThread, runCommand } from "@/lib/orchestrator.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operator — tell the AI what to browse" },
      {
        name: "description",
        content:
          "One chat box. Ask the AI to browse Reddit or any site with Playwright and report back the results.",
      },
      { property: "og:title", content: "Operator — tell the AI what to browse" },
      {
        property: "og:description",
        content: "One chat box for real browser automation: Reddit scans, research and drafts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type Thread = { id: string; title: string; updated_at: string };
type Message = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: { text?: string };
  created_at: string;
};
type RunEvent = { id: string; run_id: string; kind: string; data: Record<string, unknown> };
type Run = { id: string; thread_id: string; status: string; command: string; created_at: string };

const SUGGESTIONS = [
  "Scan r/AI_Agents for the 5 newest posts about automation and summarise them",
  "Open reddit.com/r/SaaS, find complaints about onboarding, draft 3 helpful replies",
  "Search Google for 'AI automation agency pricing' and screenshot the top 3 pages",
];

function dedupe<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function HomePage() {
  const { userId } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const createThreadFn = useServerFn(createThread);
  const renameThreadFn = useServerFn(renameThread);
  const deleteThreadFn = useServerFn(deleteThread);
  const runCommandFn = useServerFn(runCommand);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load chat history
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .then(({ data }) => setThreads((data as Thread[]) ?? []));
  }, [userId]);

  // Load + subscribe to the active conversation
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
        (p) => {
          const row = p.new as Message;
          setMessages((prev) =>
            dedupe([
              // drop the optimistic copy of the same user message
              ...prev.filter(
                (m) => !(m.id.startsWith("tmp-") && m.role === row.role && m.content.text === row.content.text),
              ),
              row,
            ]),
          );
        },
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

  // Events for the runs in this conversation
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, events]);

  useEffect(() => {
    boxRef.current?.focus();
  }, [activeId, sending]);

  const running = runs.some((r) => r.status === "running" || r.status === "pending");
  const busy = sending || running;

  async function send(text: string) {
    const command = text.trim();
    if (!command || busy || !userId) return;
    setSending(true);
    setInput("");

    let threadId = activeId;
    try {
      if (!threadId) {
        const { id } = await createThreadFn({ data: {} });
        threadId = id;
        setThreads((t) => [
          { id, title: command.slice(0, 60), updated_at: new Date().toISOString() },
          ...t,
        ]);
        setActiveId(id);
        renameThreadFn({ data: { id, title: command.slice(0, 60) } }).catch(() => {});
      }

      setMessages((m) =>
        dedupe([
          ...m,
          {
            id: `tmp-${crypto.randomUUID()}`,
            thread_id: threadId!,
            role: "user",
            content: { text: command },
            created_at: new Date().toISOString(),
          },
        ]),
      );

      await runCommandFn({ data: { threadId, command } });
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${crypto.randomUUID()}`,
          thread_id: threadId ?? "",
          role: "assistant",
          content: { text: `Couldn't start that task: ${e instanceof Error ? e.message : String(e)}` },
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function removeThread(id: string) {
    await deleteThreadFn({ data: { id } });
    setThreads((t) => t.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(null);
  }

  const empty = messages.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Minimal top bar */}
      <header className="flex items-center gap-2 px-4 py-3 md:px-6">
        <div className="brand-gradient grid size-7 place-items-center rounded-lg text-primary-foreground">
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <ellipse cx="12" cy="12" rx="3.1" ry="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-tight">Operator</span>

        <div className="ml-auto flex items-center gap-1">
          {!empty && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setActiveId(null)}>
              <Plus className="size-4" /> New
            </Button>
          )}
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <History className="size-4" /> History
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] p-0">
              <SheetTitle className="border-b px-5 py-4 text-sm">Previous tasks</SheetTitle>
              <div className="overflow-auto p-2">
                {threads.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">Nothing yet.</p>
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
                      aria-label="Delete task"
                      onClick={() => removeThread(t.id)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {empty ? (
        /* ---------- Home: the one big chat box ---------- */
        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
          <div className="w-full max-w-2xl text-center">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              What should I do in the browser?
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground md:text-base">
              Type a task in plain English. I open a real browser with Playwright, do the work on
              Reddit or any site, and report back here.
            </p>

            <div className="mt-8">
              <Composer
                value={input}
                onChange={setInput}
                onSend={() => send(input)}
                busy={busy}
                inputRef={boxRef}
                big
              />
            </div>

            <div className="mt-6 grid gap-2 text-left">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="surface lift px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </main>
      ) : (
        /* ---------- Conversation ---------- */
        <>
          <main className="flex-1 overflow-auto px-4 md:px-6">
            <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
              {messages.map((m) => {
                const run = runs.find((r) => r.command === m.content.text);
                const runEvents = run ? events.filter((e) => e.run_id === run.id) : [];
                return (
                  <div key={m.id} className="space-y-3">
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                          {m.content.text}
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {m.content.text}
                      </div>
                    )}
                    {runEvents.length > 0 && <Progress events={runEvents} status={run?.status} />}
                    {run && run.status === "running" && runEvents.length === 0 && <Working />}
                  </div>
                );
              })}
              {sending && <Working />}
              <div ref={bottomRef} />
            </div>
          </main>

          <div className="sticky bottom-0 bg-gradient-to-t from-background via-background px-4 pb-5 pt-3 md:px-6">
            <div className="mx-auto max-w-2xl">
              <Composer
                value={input}
                onChange={setInput}
                onSend={() => send(input)}
                busy={busy}
                inputRef={boxRef}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  busy,
  inputRef,
  big = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  big?: boolean;
}) {
  return (
    <div className="surface relative flex items-end gap-2 p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={big ? 3 : 2}
        placeholder="e.g. scan r/AI_Agents for new automation posts and draft replies"
        className={cn(
          "max-h-48 flex-1 resize-none bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground",
          big ? "text-base" : "text-sm",
        )}
      />
      <Button
        size="icon"
        className="size-9 shrink-0 rounded-xl"
        onClick={onSend}
        disabled={busy || !value.trim()}
        aria-label="Send task"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </Button>
    </div>
  );
}

function Working() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Working on it…
    </div>
  );
}

/** Friendly, collapsed-by-default view of what the browser actually did. */
function Progress({ events, status }: { events: RunEvent[]; status?: string }) {
  const shots = events.filter((e) => e.kind === "screenshot" && e.data.data_url);
  const errors = events.filter((e) => e.kind === "error");
  const steps = events.filter((e) => e.kind === "tool_call").length;

  return (
    <div className="space-y-3">
      <details className="surface overflow-hidden text-sm">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-muted-foreground">
          {status === "running" ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : errors.length ? (
            <TriangleAlert className="size-4 text-destructive" />
          ) : (
            <Check className="size-4 text-success" />
          )}
          <span>
            {status === "running" ? "Browsing" : errors.length ? "Finished with an issue" : "Done"}
            {steps > 0 && ` · ${steps} browser step${steps === 1 ? "" : "s"}`}
          </span>
        </summary>
        <ul className="space-y-1.5 border-t px-4 py-3 text-xs text-muted-foreground">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <Search className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 break-words">{describe(e)}</span>
            </li>
          ))}
        </ul>
      </details>

      {shots.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {shots.map((s) => (
            <figure key={s.id} className="surface overflow-hidden">
              <img
                src={String(s.data.data_url)}
                alt="Browser screenshot captured by the assistant"
                loading="lazy"
                className="w-full object-cover"
              />
              <figcaption className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <Camera className="size-3" /> Page screenshot
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {errors.map((e) => (
        <p key={e.id} className="text-xs text-destructive">
          {String(e.data.error ?? "Something went wrong")}
        </p>
      ))}
    </div>
  );
}

function describe(e: RunEvent) {
  const name = String(e.data.name ?? "").toLowerCase();
  switch (e.kind) {
    case "tool_call":
      if (name.includes("browse") || name.includes("goto")) return `Opening ${String((e.data.input as Record<string, unknown>)?.url ?? "a page")}`;
      if (name.includes("extract") || name.includes("read")) return "Reading the page content";
      if (name.includes("screenshot")) return "Taking a screenshot";
      return `Using ${name || "the browser"}`;
    case "tool_result":
      return "Got the results back";
    case "screenshot":
      return "Captured a screenshot";
    case "error":
      return String(e.data.error ?? "error");
    default:
      return String(e.data.message ?? e.kind);
  }
}
