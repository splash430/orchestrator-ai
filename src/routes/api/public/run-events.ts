// Public callback endpoint invoked by the GitHub Actions worker to stream
// events, prospects and final results back into the app. Verifies HMAC
// signature (shared WORKFLOW_CALLBACK_SECRET) before writing with admin creds.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

type EventPayload = {
  type: "event";
  runId: string;
  userId: string;
  threadId: string;
  kind: string;
  data: Record<string, unknown>;
};

type ProspectPayload = {
  type: "prospect";
  runId: string;
  userId: string;
  threadId: string;
  prospect: Record<string, unknown>;
};

type FinalPayload = {
  type: "final";
  runId: string;
  threadId: string;
  userId: string;
  status: "succeeded" | "failed";
  text?: string;
  error?: string;
};

type Payload = EventPayload | ProspectPayload | FinalPayload;

function verifySignature(raw: string, sig: string | null, secret: string) {
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/run-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WORKFLOW_CALLBACK_SECRET;
        if (!secret) return new Response("misconfigured", { status: 500 });

        const raw = await request.text();
        const sig = request.headers.get("x-signature");
        if (!verifySignature(raw, sig, secret)) {
          return new Response("bad signature", { status: 401 });
        }

        let body: Payload;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (body.type === "event") {
          await supabaseAdmin.from("run_events").insert({
            run_id: body.runId,
            user_id: body.userId,
            kind: body.kind,
            data: body.data as never,
          });
          return Response.json({ ok: true });
        }

        if (body.type === "prospect") {
          const p = body.prospect ?? {};
          const { error } = await supabaseAdmin.from("prospects").upsert(
            {
              user_id: body.userId,
              run_id: body.runId,
              source: "reddit",
              post_url: String(p.post_url ?? ""),
              author: (p.author as string) ?? null,
              subreddit: (p.subreddit as string) ?? null,
              title: (p.title as string) ?? null,
              excerpt: (p.excerpt as string) ?? null,
              problem: (p.problem as string) ?? null,
              message: (p.message as string) ?? null,
              country_signal: (p.country_signal as string) ?? null,
              intent_score: (p.intent_score as number) ?? null,
              status: "generated",
            },
            { onConflict: "user_id,post_url", ignoreDuplicates: true },
          );
          if (error) console.error("prospect insert", error.message);
          return Response.json({ ok: true });
        }

        if (body.type === "final") {
          await supabaseAdmin
            .from("runs")
            .update({
              status: body.status,
              result: body.text ? { text: body.text } : null,
              error: body.error ?? null,
            })
            .eq("id", body.runId);

          if (body.status === "succeeded" && body.text) {
            await supabaseAdmin.from("messages").insert({
              thread_id: body.threadId,
              user_id: body.userId,
              role: "assistant",
              content: { text: body.text },
            });
          } else if (body.status === "failed") {
            await supabaseAdmin.from("messages").insert({
              thread_id: body.threadId,
              user_id: body.userId,
              role: "assistant",
              content: { text: `⚠️ Run failed: ${body.error ?? "unknown"}` },
            });
          }
          await supabaseAdmin
            .from("threads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", body.threadId);
          return Response.json({ ok: true });
        }

        return new Response("unknown type", { status: 400 });
      },
    },
  },
});
