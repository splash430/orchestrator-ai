import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2, Save, Target } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { DEFAULT_MISSION, getMission, saveMission } from "@/lib/mission.functions";

export const Route = createFileRoute("/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mission Builder — set up your Reddit outreach once" },
      {
        name: "description",
        content:
          "Save your product URL, who to contact, how many replies, timing and pacing once — then run the mission from the home screen with one button.",
      },
      { property: "og:title", content: "Mission Builder" },
      {
        property: "og:description",
        content: "Configure your outreach mission once and run it with one button.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

type Form = typeof DEFAULT_MISSION;

function SettingsPage() {
  const { userId } = useSession();
  const getMissionFn = useServerFn(getMission);
  const saveMissionFn = useServerFn(saveMission);

  const [form, setForm] = useState<Form>(DEFAULT_MISSION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    getMissionFn()
      .then((m) => setForm({ ...DEFAULT_MISSION, ...(m as Partial<Form>) }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, getMissionFn]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveMissionFn({
        data: {
          product_name: form.product_name,
          product_url: form.product_url,
          audience: form.audience,
          country: form.country,
          max_contacts: Number(form.max_contacts),
          duration_minutes: Number(form.duration_minutes),
          scans: Number(form.scans),
          pace_per_minute: Number(form.pace_per_minute),
          contact_gap_seconds: Math.round(Number(form.contact_gap_seconds)),
          recency_minutes: Number(form.recency_minutes),
          subreddits: form.subreddits,
          specifications: form.specifications ?? "",
        },
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/">
            <ArrowLeft className="size-4" /> Home
          </Link>
        </Button>
        <div className="ml-2 flex items-center gap-2">
          <div className="brand-gradient grid size-7 place-items-center rounded-lg text-primary-foreground">
            <Target className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Mission Builder</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Set it up once, then just hit Run
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Answer these once. The home screen button uses these answers every time, so you never have
          to describe the task again.
        </p>

        {loading ? (
          <div className="surface mt-6 flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your mission…
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <Card title="What are you selling?">
              <Field label="Product / offer name">
                <Input
                  value={form.product_name}
                  onChange={(e) => set("product_name", e.target.value)}
                />
              </Field>
              <Field label="Product or website URL" hint="Shared in every reply.">
                <Input
                  type="url"
                  value={form.product_url}
                  onChange={(e) => set("product_url", e.target.value)}
                />
              </Field>
            </Card>

            <Card title="Who should I contact?">
              <Field
                label="Who to contact"
                hint="I reply to people asking questions — not random posts."
              >
                <Textarea
                  rows={4}
                  value={form.audience}
                  onChange={(e) => set("audience", e.target.value)}
                />
              </Field>
              <Field label="Country" hint="Only leads with signals from this country are contacted.">
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
              </Field>
              <Field label="Communities to search" hint="Comma-separated subreddits.">
                <Textarea
                  rows={3}
                  value={form.subreddits.join(", ")}
                  onChange={(e) =>
                    set(
                      "subreddits",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim().replace(/^r\//, ""))
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            </Card>

            <Card title="How many, and how fast?">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How many comments (leads)">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.max_contacts}
                    onChange={(e) => set("max_contacts", Number(e.target.value))}
                  />
                </Field>
                <Field
                  label="Minutes between replies"
                  hint="2.5 minutes = about 24 replies an hour. Slower is safer."
                >
                  <Input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={60}
                    value={form.contact_gap_seconds / 60}
                    onChange={(e) =>
                      set("contact_gap_seconds", Math.round(Number(e.target.value) * 60))
                    }
                  />
                </Field>
                <Field label="How long should it run? (minutes)">
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={form.duration_minutes}
                    onChange={(e) => set("duration_minutes", Number(e.target.value))}
                  />
                </Field>
                <Field label="Scan rounds">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.scans}
                    onChange={(e) => set("scans", Number(e.target.value))}
                  />
                </Field>
                <Field
                  label="Only posts newer than (minutes)"
                  hint="Fresh questions get the best response."
                >
                  <Input
                    type="number"
                    min={5}
                    max={1440}
                    value={form.recency_minutes}
                    onChange={(e) => set("recency_minutes", Number(e.target.value))}
                  />
                </Field>
              </div>
            </Card>

            <Card title="Anything else I should know?">
              <Field
                label="Specifications"
                hint="Tone, what to avoid, offers to mention. Applied to every reply."
              >
                <Textarea
                  rows={5}
                  placeholder="Be helpful first, never spammy. Mention a free demo. Avoid pricing claims."
                  value={form.specifications ?? ""}
                  onChange={(e) => set("specifications", e.target.value)}
                />
              </Field>
            </Card>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="sticky bottom-4 flex flex-wrap items-center gap-3">
              <Button size="lg" className="gap-2" onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : saved ? (
                  <Check className="size-4" />
                ) : (
                  <Save className="size-4" />
                )}
                {saved ? "Saved" : "Save mission"}
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface space-y-4 p-5 md:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
