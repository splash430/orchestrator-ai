import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Empty, LoadingScreen, Panel } from "@/routes/dashboard";
import { useRequireSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, STATUS_TONE } from "@/lib/agent-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Tasks — Operator" },
      { name: "description", content: "Track running, completed and failed browser automations." },
      { property: "og:title", content: "Tasks — Operator" },
      {
        property: "og:description",
        content: "Track running, completed and failed browser automations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TasksPage,
});

type Run = {
  id: string;
  thread_id: string;
  command: string;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const GROUPS = [
  { key: "running", label: "Running now" },
  { key: "pending", label: "Queued" },
  { key: "succeeded", label: "Completed" },
  { key: "failed", label: "Failed" },
];

function TasksPage() {
  const { userId } = useRequireSession();
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setRuns((data as Run[]) ?? []));
  }, [userId]);

  if (userId === undefined) return <LoadingScreen />;
  if (userId === null) return null;

  return (
    <AppShell title="Tasks" subtitle="Every automation you've asked for">
      {GROUPS.map((g) => {
        const list = runs.filter((r) => r.status === g.key);
        return (
          <Panel key={g.key} title={`${g.label} (${list.length})`}>
            {list.length === 0 ? (
              <Empty text="Nothing here." />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((r) => (
                  <li key={r.id} className="lift rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                          STATUS_TONE[r.status] ?? STATUS_TONE.pending,
                        )}
                      >
                        {r.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {relativeTime(r.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm">{r.command}</p>
                    {r.error && (
                      <p className="mt-2 line-clamp-2 text-xs text-destructive">{r.error}</p>
                    )}
                    <Link
                      to="/chat"
                      className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
                    >
                      Open in assistant →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
    </AppShell>
  );
}
