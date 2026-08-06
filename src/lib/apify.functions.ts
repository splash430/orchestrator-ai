import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkApifyConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const lovableApiKey = process.env["LOVABLE_API_KEY"];
    const apifyApiKey = process.env["APIFY_API_KEY"];

    if (!lovableApiKey || !apifyApiKey) {
      return { connected: false, message: "Apify is not connected to this project." };
    }

    const response = await fetch("https://connector-gateway.lovable.dev/apify/users/me", {
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": apifyApiKey,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`Apify connection check failed [${response.status}]: ${detail}`);
      return { connected: false, message: `Apify returned status ${response.status}.` };
    }

    const payload = (await response.json()) as {
      data?: { username?: string; plan?: { description?: string } };
    };

    return {
      connected: true,
      message: "Apify is connected and reachable.",
      account: payload.data?.username ?? "Connected account",
      plan: payload.data?.plan?.description ?? "Active plan",
    };
  });