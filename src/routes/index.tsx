import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Crosshair, Radar, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthRequired } from "@/components/auth-required";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: "AI Opportunity Finder | Reddit lead dashboard" }, { name: "description", content: "Find high-intent Reddit posts about AI and business automation, then review every reply before posting." }, { property: "og:title", content: "AI Opportunity Finder" }, { property: "og:description", content: "Discover and qualify Reddit automation opportunities without spam or auto-posting." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <AuthRequired><AppShell><Dashboard /></AppShell></AuthRequired>,
});

function Dashboard() {
  const [stats, setStats] = useState({ opportunities: 0, high: 0, leads: 0, drafts: 0 });
  useEffect(() => { Promise.all([
    supabase.from("prospects").select("intent_score,status"),
    supabase.from("leads").select("id", { count: "exact", head: true }),
  ]).then(([opps, leads]) => { const rows = opps.data ?? []; setStats({ opportunities: rows.length, high: rows.filter((r) => (r.intent_score ?? 0) >= 75).length, leads: leads.count ?? 0, drafts: rows.filter((r) => r.status === "drafted" || r.status === "reply_drafted").length }); }); }, []);
  const cards = [{ label: "Opportunities", value: stats.opportunities, icon: Crosshair }, { label: "High intent", value: stats.high, icon: Sparkles }, { label: "Saved leads", value: stats.leads, icon: Users }, { label: "Drafts awaiting you", value: stats.drafts, icon: Radar }];
  return <div className="mx-auto max-w-6xl p-5 md:p-8"><header><p className="text-sm text-primary">Browser-based Reddit discovery</p><h1 className="mt-1 text-3xl font-semibold">Opportunity dashboard</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Scan public Reddit pages, qualify real business problems, and prepare authentic replies. Nothing is submitted without your final action on Reddit.</p></header><section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon }) => <div className="surface p-5" key={label}><Icon className="size-4 text-primary" /><p className="mt-5 text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></div>)}</section><section className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]"><div className="surface p-6"><h2 className="text-lg font-semibold">Start with Reddit URLs</h2><p className="mt-2 text-sm text-muted-foreground">Add subreddit, search, or individual post pages. Choose recency, post volume, and sorting before launching the browser worker.</p><Button asChild className="mt-6 gap-2"><Link to="/scanner">Open scanner <ArrowRight className="size-4" /></Link></Button></div><div className="surface p-6"><h2 className="text-lg font-semibold">Human approval is required</h2><p className="mt-2 text-sm text-muted-foreground">Generate three reply options, edit one, approve it, then open Reddit. The app never clicks Reddit's final submit button.</p><Button asChild variant="secondary" className="mt-6"><Link to="/opportunities">Review opportunities</Link></Button></div></section></div>;
}