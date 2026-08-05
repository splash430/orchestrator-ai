import { Link, useNavigate } from "@tanstack/react-router";
import { BarChart3, Crosshair, LogOut, Radar, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

const navigation = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/opportunities", label: "Opportunities", icon: Crosshair },
  { to: "/leads", label: "Lead CRM", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { email } = useSession();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-border bg-sidebar md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-16 items-center gap-3 px-4">
          <div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Crosshair className="size-5" /></div>
          <div><p className="text-sm font-semibold">AI Opportunity Finder</p><p className="text-xs text-muted-foreground">Reddit discovery</p></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:pb-0" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-sidebar-accent-foreground">
              <Icon className="size-4" />{label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t p-3 md:absolute md:inset-x-0 md:bottom-0 md:block">
          <p className="truncate px-2 text-xs text-muted-foreground">{email}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start gap-2" onClick={signOut}><LogOut className="size-4" />Sign out</Button>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}