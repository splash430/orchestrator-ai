import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/** undefined = loading, null = signed out, string = user id */
export function useSession() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUserId(data.session?.user.id ?? null);
      setEmail(data.session?.user.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId, email };
}
