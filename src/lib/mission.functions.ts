import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Saved-mission prospecting: the user configures the campaign once, then hits
// "Run Mission". We dispatch .github/workflows/run-mission.yml which drives
// Playwright + Lovable AI and streams leads back to /api/public/run-events.

export const DEFAULT_MISSION = {
  product_name: "Business AI solutions",
  product_url: "https://splashdevelopmentwebsite.base44.app",
  audience:
    "Canadian business owners and entrepreneurs asking for AI tools, booking/appointment software, customer management or business automation",
  country: "Canada",
  max_contacts: 30,
  duration_minutes: 40,
  scans: 30,
  pace_per_minute: 1,
  recency_minutes: 60,
  subreddits: [
    "smallbusiness",
    "Entrepreneur",
    "CanadaBusiness",
    "smallbusinesscanada",
    "askcanada",
    "artificial",
    "AI_Agents",
    "SaaS",
    "automation",
    "Barber",
    "Salons",
    "msp",
  ],
  specifications: "",
};

export type Mission = typeof DEFAULT_MISSION & { id?: string };

function callbackUrl() {
  try {
    const req = getRequest();
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) return `${proto}://${host}/api/public/run-events`;
  } catch {}
  const override = process.env.PUBLIC_SITE_URL;
  if (override) return `${override.replace(/\/$/, "")}/api/public/run-events`;
  throw new Error("Unable to determine callback URL. Set PUBLIC_SITE_URL.");
}

const MissionSchema = z.object({
  product_name: z.string().min(1).max(120),
  product_url: z.string().url().max(500),
  audience: z.string().min(1).max(1000),
  country: z.string().min(2).max(60),
  max_contacts: z.number().int().min(1).max(200),
  duration_minutes: z.number().int().min(1).max(240),
  scans: z.number().int().min(1).max(200),
  pace_per_minute: z.number().int().min(1).max(10),
  recency_minutes: z.number().int().min(5).max(1440),
  subreddits: z.array(z.string().min(1).max(40)).min(1).max(20),
  specifications: z.string().max(4000),
});

/** Reads the saved mission, creating the default one on first use. */
export const getMission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("missions").select("*").eq("user_id", userId).maybeSingle();
    if (data) return data as unknown as Mission;

    const { data: created, error } = await supabase
      .from("missions")
      .insert({ user_id: userId, ...DEFAULT_MISSION })
      .select("*")
      .single();
    if (error) throw error;
    return created as unknown as Mission;
  });

export const saveMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MissionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("missions")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });

const RunMissionInput = z.object({
  threadId: z.string().uuid().optional(),
  extraInstructions: z.string().max(4000).optional(),
});

export const runMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunMissionInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!repo || !token) throw new Error("GitHub isn't configured (GITHUB_REPO / GITHUB_DISPATCH_TOKEN).");
    if (!process.env.WORKFLOW_CALLBACK_SECRET) throw new Error("Missing WORKFLOW_CALLBACK_SECRET");

    const { data: missionRow } = await supabase
      .from("missions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const mission = { ...DEFAULT_MISSION, ...(missionRow ?? {}) } as Record<string, unknown>;

    // Thread to attach the report to
    let threadId = data.threadId;
    if (!threadId) {
      const { data: thread, error } = await supabase
        .from("threads")
        .insert({
          user_id: userId,
          title: `Mission — ${new Date().toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`,
        })
        .select("id")
        .single();
      if (error || !thread) throw new Error(error?.message || "failed to create thread");
      threadId = thread.id;
    }

    const command = [
      `Run mission: find ${mission.max_contacts} ${mission.country} prospects asking for ${mission.product_name}`,
      `pace ${mission.pace_per_minute}/min, stop after ${mission.duration_minutes} min`,
      data.extraInstructions ? `Extra: ${data.extraInstructions}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    await supabase.from("messages").insert({
      thread_id: threadId,
      user_id: userId,
      role: "user",
      content: { text: command },
    });

    const { data: run, error: runErr } = await supabase
      .from("runs")
      .insert({ thread_id: threadId, user_id: userId, command, status: "running" })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(runErr?.message || "failed to create run");

    const payload = {
      product_name: mission.product_name,
      product_url: mission.product_url,
      audience: mission.audience,
      country: mission.country,
      max_contacts: mission.max_contacts,
      duration_minutes: mission.duration_minutes,
      scans: mission.scans,
      pace_per_minute: mission.pace_per_minute,
      recency_minutes: mission.recency_minutes,
      subreddits: mission.subreddits,
      specifications: mission.specifications,
      extra_instructions: data.extraInstructions ?? "",
    };

    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/run-mission.yml/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "lovable-orchestrator-app",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            run_id: run.id,
            thread_id: threadId,
            user_id: userId,
            mission: JSON.stringify(payload),
            callback_url: callbackUrl(),
          },
        }),
      },
    );

    if (!res.ok) {
      const msg = `GitHub dispatch failed (${res.status}): ${(await res.text()).slice(0, 400)}`;
      await supabase.from("runs").update({ status: "failed", error: msg }).eq("id", run.id);
      throw new Error(msg);
    }

    await supabase.from("run_events").insert({
      run_id: run.id,
      user_id: userId,
      kind: "log",
      data: { message: "Mission dispatched — the browser worker is starting up…" } as never,
    });

    return { runId: run.id, threadId };
  });

export const stopMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("runs")
      .update({ status: "stopped", error: "Stopped by the operator" })
      .eq("id", data.runId)
      .eq("user_id", context.userId);
    return { ok: true };
  });
