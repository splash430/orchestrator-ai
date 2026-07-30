import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  Plug,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard, hint: "Overview" },
  { to: "/chat", label: "Assistant", icon: MessagesSquare, hint: "Chat & run tasks" },
  { to: "/memory", label: "Memory", icon: Brain, hint: "What the AI remembers" },
  { to: "/tasks", label: "Tasks", icon: ListChecks, hint: "Automations" },
  { to: "/activity", label: "Live activity", icon: Activity, hint: "Browser view" },
  { to: "/integrations", label: "Integrations", icon: Plug, hint: "Connections" },
] as const;

export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "brand-gradient grid place-items-center rounded-xl text-primary-foreground shadow-sm",
          size === "sm" ? "size-7" : "size-9",
        )}
      >
        <svg viewBox="0 0 24 24" className={size === "sm" ? "size-4" : "size-5"} aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <ellipse
            cx="12"
            cy="12"
            rx="3.1"
            ry="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className={cn("font-semibold tracking-tight", size === "sm" ? "text-sm" : "text-base")}>
          Operator
        </div>
        <div className="text-[11px] text-muted-foreground">AI browser assistant</div>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {active && <span className="size-1.5 rounded-full bg-sidebar-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const { email } = useSession();
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto space-y-2 border-t border-sidebar-border p-3">
        <div className="truncate px-2 text-xs text-muted-foreground">{email ?? "Signed in"}</div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
  padded = true,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-[248px] shrink-0 border-r border-sidebar-border md:block">
        <div className="sticky top-0 h-screen">
          <SidebarInner />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur-md md:px-8">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarInner onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{title}</h1>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground md:text-sm">{subtitle}</p>
            )}
          </div>
          {actions}
        </header>

        <main className={cn("flex min-h-0 flex-1 flex-col", padded && "gap-6 p-4 md:p-8")}>
          {children}
        </main>
      </div>
    </div>
  );
}
