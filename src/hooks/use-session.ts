import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

let ensuring: Promise<void> | null = null;

/** Makes sure there's always a session — no login screen needed. */
async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  await supabase.auth.signInAnonymously();
}

/** undefined = loading, null = failed, string = user id */
export function useSession() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    ensuring = ensuring ?? ensureSession();
    ensuring
      .then(() => supabase.auth.getSession())
      .then(({ data }) => {
        if (alive) setUserId(data.session?.user.id ?? null);
      })
      .catch(() => alive && setUserId(null));

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user.id) setUserId(session.user.id);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId };
}
