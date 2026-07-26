import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operator — AI browser control" },
      {
        name: "description",
        content: "Chat with Claude and let it drive a headless browser for browsing tasks.",
      },
      { property: "og:title", content: "Operator — AI browser control" },
      {
        property: "og:description",
        content: "Chat with Claude and let it drive a headless browser for browsing tasks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/chat" : "/auth" });
  },
  component: () => null,
});
