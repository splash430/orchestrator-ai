import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LoadingScreen, Panel } from "@/routes/dashboard";
import { Button } from "@/components/ui/button";
import { useRequireSession } from "@/hooks/use-session";
import { getGithubStatus, setupGithubSecrets } from "@/lib/orchestrator.functions";

export const Route = createFileRoute("/integrations")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Integrations — Operator" },
      { name: "description", content: "Connected services powering your AI browser assistant." },
      { property: "og:title", content: "Integrations — Operator" },
      {
        property: "og:description",
        content: "Connected services powering your AI browser assistant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { userId } = useRequireSession();
  const [status, setStatus] = useState<{
    repo: string | null;
    hasToken: boolean;
    hasAnthropic: boolean;
    hasCallbackSecret: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const getStatus = useServerFn(getGithubStatus);
  const setupFn = useServerFn(setupGithubSecrets);

  useEffect(() => {
    if (!userId) return;
    getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [userId, getStatus]);

  if (userId === undefined) return <LoadingScreen />;
  if (userId === null) return null;

  const ready = !!status?.repo && !!status?.hasToken && !!status?.hasAnthropic;

  const cards = [
    {
      name: "Claude AI",
      desc: "Writes personalised, human-sounding content for every task.",
      ok: !!status?.hasAnthropic,
    },
    {
      name: "GitHub Actions",
      desc: status?.repo ? `Runs the browser worker in ${status.repo}` : "Runs the browser worker",
      ok: !!status?.repo && !!status?.hasToken,
    },
    {
      name: "Playwright browser",
      desc: "A real headless browser that opens pages, searches and captures screenshots.",
      ok: ready,
    },
    {
      name: "Secure callbacks",
      desc: "Signed updates so live progress reaches this app safely.",
      ok: !!status?.hasCallbackSecret,
    },
  ];

  return (
    <AppShell title="Integrations" subtitle="Everything your assistant is plugged into">
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <div key={c.name} className="surface lift p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{c.name}</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  c.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}
              >
                {c.ok ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                {c.ok ? "Connected" : "Not ready"}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{c.desc}</p>
          </div>
        ))}
      </div>

      <Panel title="Worker setup">
        <p className="text-sm text-muted-foreground">
          One click re-syncs the keys your browser worker needs. You never have to touch GitHub.
        </p>
        <Button
          className="mt-3 gap-2 rounded-xl"
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await setupFn();
              setMsg(`Synced: ${r.secrets.join(", ")}`);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />} Sync worker keys
        </Button>
        {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      </Panel>
    </AppShell>
  );
}
