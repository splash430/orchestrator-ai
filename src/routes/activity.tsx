import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { describeEvent, Empty, LoadingScreen, Panel } from "@/routes/dashboard";
import { useRequireSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/agent-ui";

export const Route = createFileRoute("/activity")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live activity — Operator" },
      { name: "description", content: "Watch the browser agent work: pages, actions and screenshots." },
      { property: "og:title", content: "Live activity — Operator" },
      {
        property: "og:description",
        content: "Watch the browser agent work: pages, actions and screenshots.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActivityPage,
});

type Ev = { id: string; kind: string; data: Record<string, unknown>; created_at: string };

function ActivityPage() {
  const { userId } = useRequireSession();
  const [events, setEvents] = useState<Ev[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("run_events")
      .select("id, kind, data, created_at")
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data }) => setEvents((data as Ev[]) ?? []));
    const ch = supabase
      .channel("activity-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, (p) =>
        setEvents((prev) => [p.new as Ev, ...prev].slice(0, 60)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  if (userId === undefined) return <LoadingScreen />;
  if (userId === null) return null;

  const shots = events.filter((e) => e.kind === "screenshot" && e.data.data_url);

  return (
    <AppShell title="Live activity" subtitle="Exactly what the agent is doing, as it happens">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Browser previews">
          {shots.length === 0 ? (
            <Empty text="Screenshots appear here while a task runs." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shots.slice(0, 6).map((s) => (
                <figure key={s.id} className="overflow-hidden rounded-xl border">
                  <img
                    src={String(s.data.data_url)}
                    alt="Browser screenshot captured by the agent"
                    className="h-40 w-full object-cover object-top"
                    loading="lazy"
                  />
                  <figcaption className="truncate bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
                    {String(s.data.url ?? "page")} · {relativeTime(s.created_at)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Agent decisions">
          {events.length === 0 ? (
            <Empty text="No activity yet." />
          ) : (
            <ol className="relative space-y-4 pl-4">
              <span className="absolute left-[3px] top-1 h-[calc(100%-0.5rem)] w-px bg-border" />
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-4 top-1.5 size-1.5 rounded-full bg-primary" />
                  <p className="text-sm">{describeEvent(e)}</p>
                  <p className="text-[11px] text-muted-foreground">{relativeTime(e.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
