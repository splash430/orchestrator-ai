import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/** undefined = loading, null = signed out, string = user id */
export function useSession() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { userId, email };
}

/** Redirects to /auth when signed out. */
export function useRequireSession() {
  const navigate = useNavigate();
  const session = useSession();
  useEffect(() => {
    if (session.userId === null) navigate({ to: "/auth" });
  }, [session.userId, navigate]);
  return session;
}
