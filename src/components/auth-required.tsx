import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { AuthScreen } from "@/components/auth-screen";
import { useSession } from "@/hooks/use-session";

export function AuthRequired({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  if (userId === undefined) return <div className="grid min-h-screen place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (userId === null) return <AuthScreen />;
  return children;
}