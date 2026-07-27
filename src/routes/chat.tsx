import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  createThread,
  deleteThread,
  getGithubStatus,
  renameThread,
  runCommand,
} from "@/lib/orchestrator.functions";

export const Route = createFileRoute("/chat")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operator — AI browser control" },
      { property: "og:title", content: "Operator — AI browser control" },
      {
        name: "description",
        content:
          "Chat interface that turns your commands into real headless-browser actions via Claude.",
      },
      {
        property: "og:description",
        content:
          "Chat interface that turns your commands into real headless-browser actions via Claude.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

type Thread = { id: string; title: string; updated_at: string };
type Message = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: { text?: string };
  created_at: string;
};
type RunEvent = {
  id: string;
  run_id: string;
  kind: string;
  data: Record<string, unknown>;
  created_at: string;
};
type Run = {
  id: string;
  thread_id: string;
  status: string;
  command: string;
  created_at: string;
};

function useSession() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return userId;
}

function ChatPage() {
  const navigate = useNavigate();
  const userId = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const createThreadFn = useServerFn(createThread);
  const renameThreadFn = useServerFn(renameThread);
  const deleteThreadFn = useServerFn(deleteThread);
  const runCommandFn = useServerFn(runCommand);

  useEffect(() => {
    if (userId === null) navigate({ to: "/auth" });
  }, [userId, navigate]);

  // Load threads
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setThreads((data as Thread[]) ?? []);
        if (!activeId && data && data.length) setActiveId(data[0].id);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Load messages + runs when thread changes; subscribe to realtime
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    supabase
      .from("messages")
      .select("*")
      .eq("thread_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data }) => !cancelled && setMessages((data as Message[]) ?? []));
    supabase
      .from("runs")
      .select("*")
      .eq("thread_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data }) => !cancelled && setRuns((data as Run[]) ?? []));

    const ch = supabase
      .channel(`thread-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${activeId}` },
        (payload) => setMessages((m) => [...m, payload.new as Message]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `thread_id=eq.${activeId}` },
        (payload) => {
          setRuns((prev) => {
            const next = prev.filter((r) => r.id !== (payload.new as Run).id);
            if (payload.eventType !== "DELETE") next.push(payload.new as Run);
            return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  // Subscribe to events for all runs in this thread
  const runIds = useMemo(() => runs.map((r) => r.id), [runs]);
  useEffect(() => {
    if (!runIds.length) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("run_events")
      .select("*")
      .in("run_id", runIds)
      .order("created_at", { ascending: true })
      .then(({ data }) => !cancelled && setEvents((data as RunEvent[]) ?? []));

    const ch = supabase
      .channel(`events-${runIds.join(",")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "run_events" },
        (payload) => {
          const ev = payload.new as RunEvent;
          if (runIds.includes(ev.run_id)) setEvents((prev) => [...prev, ev]);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [runIds]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, events]);

  async function newThread() {
    const { id } = await createThreadFn({ data: {} });
    setThreads((t) => [{ id, title: "New chat", updated_at: new Date().toISOString() }, ...t]);
    setActiveId(id);
  }

  async function send() {
    const text = input.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    setInput("");
    // Optimistic user message
    const optimisticId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      {
        id: optimisticId,
        thread_id: activeId,
        role: "user",
        content: { text },
        created_at: new Date().toISOString(),
      },
    ]);
    // Auto-title
    const t = threads.find((x) => x.id === activeId);
    if (t && t.title === "New chat") {
      const title = text.slice(0, 60);
      renameThreadFn({ data: { id: activeId, title } }).catch(() => {});
      setThreads((prev) => prev.map((x) => (x.id === activeId ? { ...x, title } : x)));
    }
    try {
      await runCommandFn({ data: { threadId: activeId, command: text } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          thread_id: activeId,
          role: "assistant",
          content: { text: `⚠️ ${msg}` },
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function removeThread(id: string) {
    if (!confirm("Delete this chat?")) return;
    await deleteThreadFn({ data: { id } });
    setThreads((t) => t.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(null);
  }

  if (userId === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (userId === null) return null;

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex flex-col border-r bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold">Operator</div>
          <button
            onClick={newThread}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            + New
          </button>
        </div>
        <GithubStatusPanel />
        <div className="flex-1 overflow-auto">
          {threads.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">No chats yet.</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center justify-between border-b px-4 py-2 text-sm ${
                activeId === t.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <button className="flex-1 truncate text-left" onClick={() => setActiveId(t.id)}>
                {t.title}
              </button>
              <button
                onClick={() => removeThread(t.id)}
                className="ml-2 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="border-t px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          Sign out
        </button>
      </aside>

      {/* Main */}
      <main className="flex flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p>No chat selected.</p>
              <button
                onClick={newThread}
                className="mt-2 rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
              >
                Start a chat
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto px-6 py-6">
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((m) => (
                  <MessageView key={m.id} m={m} events={events.filter((e) => {
                    // Attach events to the assistant message that closed the run.
                    // Simpler: show events under user messages.
                    const run = runs.find((r) => r.command === m.content.text);
                    return m.role === "user" && run && e.run_id === run.id;
                  })} />
                ))}
                {sending && (
                  <div className="text-sm text-muted-foreground">Operator is working…</div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>
            <div className="border-t bg-card px-6 py-4">
              <div className="mx-auto flex max-w-3xl gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder="e.g. scan recent Reddit posts about AI automation and draft 3 replies"
                  className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="self-end rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MessageView({ m, events }: { m: Message; events: RunEvent[] }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {m.content.text}
        </div>
        {isUser && events.length > 0 && (
          <details className="rounded-md border bg-card p-3 text-left text-xs open:shadow-sm">
            <summary className="cursor-pointer select-none text-muted-foreground">
              {events.filter((e) => e.kind === "tool_call").length} tool call
              {events.filter((e) => e.kind === "tool_call").length === 1 ? "" : "s"} · click to
              expand
            </summary>
            <div className="mt-2 space-y-2">
              {events.map((e) => (
                <EventView key={e.id} e={e} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function EventView({ e }: { e: RunEvent }) {
  if (e.kind === "screenshot") {
    const url = e.data.data_url as string | undefined;
    if (!url) return null;
    return (
      <div>
        <div className="mb-1 text-muted-foreground">📸 screenshot</div>
        <img src={url} alt="screenshot" className="max-h-64 rounded border" />
      </div>
    );
  }
  if (e.kind === "tool_call") {
    return (
      <div>
        <div className="text-muted-foreground">🔧 {String(e.data.name)}</div>
        <pre className="mt-1 overflow-auto rounded bg-muted p-2">
          {JSON.stringify(e.data.input, null, 2)}
        </pre>
      </div>
    );
  }
  if (e.kind === "tool_result") {
    return (
      <div>
        <div className="text-muted-foreground">→ {String(e.data.name)} result</div>
        <pre className="mt-1 overflow-auto rounded bg-muted p-2">{String(e.data.preview ?? "")}</pre>
      </div>
    );
  }
  if (e.kind === "error") {
    return <div className="text-destructive">⚠️ {String(e.data.error ?? "error")}</div>;
  }
  if (e.kind === "log") {
    return <div className="text-muted-foreground">· {String(e.data.message ?? "")}</div>;
  }
  return null;
}

function GithubStatusPanel() {
  const [status, setStatus] = useState<{
    repo: string | null;
    hasToken: boolean;
    hasAnthropic: boolean;
    hasCallbackSecret: boolean;
  } | null>(null);
  const getStatus = useServerFn(getGithubStatus);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus(null));
  }, [getStatus]);

  if (!status) return null;

  const ready =
    !!status.repo && status.hasToken && status.hasAnthropic && status.hasCallbackSecret;

  return (
    <div className="border-b bg-muted/30 px-4 py-3 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">GitHub Actions worker</span>
        <span className={ready ? "text-green-600" : "text-muted-foreground"}>
          {ready ? "ready" : "setup needed"}
        </span>
      </div>
      {status.repo ? (
        <div className="truncate text-muted-foreground">
          repo: <span className="font-mono">{status.repo}</span>
        </div>
      ) : (
        <div className="text-destructive">GITHUB_REPO secret missing</div>
      )}
      {!ready && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>
            Push this project to GitHub. The workflow lives at{" "}
            <span className="font-mono">.github/workflows/run-command.yml</span>.
          </li>
          <li>
            In your repo → Settings → Secrets and variables → Actions, add repo secrets{" "}
            <span className="font-mono">ANTHROPIC_API_KEY</span> and{" "}
            <span className="font-mono">WORKFLOW_CALLBACK_SECRET</span> (same value as this app).
          </li>
          <li>
            Ensure the app secrets <span className="font-mono">GITHUB_REPO</span> (owner/repo) and{" "}
            <span className="font-mono">GITHUB_DISPATCH_TOKEN</span> (PAT with{" "}
            <span className="font-mono">workflow</span> scope) are set.
          </li>
        </ol>
      )}
    </div>
  );
}

