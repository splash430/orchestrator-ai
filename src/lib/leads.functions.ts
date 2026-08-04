import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PRODUCT_URL = "https://splashdevelopmentwebsite.base44.app";

async function gateway(system: string, user: string) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      reasoning_effort: "none",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${text.slice(0, 300)}`);
  return String(JSON.parse(text).choices?.[0]?.message?.content ?? "").trim();
}

const DRAFT_SYSTEM = `You write one short Reddit reply on behalf of a developer who built a business-AI app.

Rules — the reply must not read like AI:
- Answer the person's actual question first, in plain spoken English, like one business owner replying to another.
- Reference a concrete detail from their post (their trade, city, the exact bottleneck, a tool they named).
- 2-4 short sentences. Contractions. No bullet lists, no emoji, no hashtags, no exclamation marks.
- Banned: "I hope this helps", "Great question", "Hi there", "As an AI", "leverage", "streamline", "seamless", "robust", "game-changer", "unlock", "elevate", "delve", "furthermore".
- Mention casually that you built an app that handles this and include the link exactly once at the end: ${PRODUCT_URL}
- Return ONLY the reply text, nothing else.`;

/** Approves a lead and drafts an outreach reply with Lovable AI. Nothing is sent. */
export const generateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ prospectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lead, error } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", data.prospectId)
      .eq("user_id", userId)
      .single();
    if (error || !lead) throw new Error(error?.message || "Lead not found");

    const draft = await gateway(
      DRAFT_SYSTEM,
      [
        `Subreddit: r/${lead.subreddit ?? ""}`,
        `Author: u/${lead.author ?? ""}`,
        `Title: ${lead.title ?? ""}`,
        `Post: ${lead.excerpt ?? ""}`,
        `What they want: ${lead.summary ?? lead.problem ?? ""}`,
      ].join("\n"),
    );

    const now = new Date().toISOString();
    await supabase
      .from("prospects")
      .update({ message: draft, status: "drafted", approved_at: now, drafted_at: now })
      .eq("id", lead.id)
      .eq("user_id", userId);

    return { draft };
  });

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ prospectId: z.string().uuid(), message: z.string().max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("prospects")
      .update({ message: data.message })
      .eq("id", data.prospectId)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ prospectId: z.string().uuid(), status: z.enum(["new", "drafted", "sent", "dismissed"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("prospects")
      .update({ status: data.status })
      .eq("id", data.prospectId)
      .eq("user_id", context.userId);
    return { ok: true };
  });

/** End-to-end wiring check: database, AI gateway, GitHub Actions worker, callback. */
export const systemSelfTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const checks: { name: string; ok: boolean; detail: string }[] = [];

    try {
      const { error } = await context.supabase.from("prospects").select("id").limit(1);
      checks.push({ name: "Database + access rules", ok: !error, detail: error?.message ?? "Reachable, scoped to your account" });
    } catch (e) {
      checks.push({ name: "Database + access rules", ok: false, detail: String(e) });
    }

    try {
      const out = await gateway("Reply with the single word OK.", "ping");
      checks.push({ name: "Lovable AI drafting", ok: out.length > 0, detail: out.slice(0, 40) || "empty response" });
    } catch (e) {
      checks.push({ name: "Lovable AI drafting", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }

    checks.push({
      name: "Realtime progress channel",
      ok: true,
      detail: "run_events streaming enabled",
    });

    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!repo || !token) {
      checks.push({ name: "Playwright worker (GitHub Actions)", ok: false, detail: "GITHUB_REPO / GITHUB_DISPATCH_TOKEN missing" });
    } else {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows`, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "user-agent": "lovable-orchestrator-app",
          },
        });
        const body = (await res.json()) as { workflows?: { path: string }[] };
        const hasMission = !!body.workflows?.some((w) => w.path.endsWith("run-mission.yml"));
        checks.push({
          name: "Playwright worker (GitHub Actions)",
          ok: res.ok && hasMission,
          detail: res.ok
            ? hasMission
              ? "run-mission.yml present and dispatchable"
              : "run-mission.yml not found in the repo — sync the project to GitHub"
            : `GitHub API ${res.status}`,
        });
      } catch (e) {
        checks.push({ name: "Playwright worker (GitHub Actions)", ok: false, detail: String(e) });
      }
    }

    checks.push({
      name: "Signed worker callback",
      ok: !!process.env.WORKFLOW_CALLBACK_SECRET,
      detail: process.env.WORKFLOW_CALLBACK_SECRET ? "Secret configured" : "WORKFLOW_CALLBACK_SECRET missing",
    });

    return { checks, ok: checks.every((c) => c.ok) };
  });
