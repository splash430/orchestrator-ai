import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Health check used by Settings — proves the app can reach Apify server-side. */
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

const RedditScanInput = z.object({
  reddit_urls: z
    .array(z.string().url())
    .min(1)
    .max(30)
    .refine(
      (urls) =>
        urls.every((url) => {
          try {
            const host = new URL(url).hostname.toLowerCase();
            return host === "reddit.com" || host.endsWith(".reddit.com");
          } catch {
            return false;
          }
        }),
      "Only reddit.com URLs are allowed",
    ),
  keywords: z.array(z.string().min(1).max(80)).max(15).default([]),
  post_limit: z.union([
    z.literal(10),
    z.literal(25),
    z.literal(40),
    z.literal(50),
    z.literal(70),
    z.literal(100),
  ]),
  sort_order: z.enum(["new", "hot", "top"]),
  recency_minutes: z.number().int().min(5).max(1440),
});

/** Starts an Apify Reddit Actor run and records the scan job. */
export const startRedditScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RedditScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { REDDIT_ACTOR, redditActorInput, startActorRun } = await import("./apify.server");

    const { data: job, error } = await context.supabase
      .from("scan_jobs")
      .insert({
        user_id: context.userId,
        source: "reddit",
        actor_id: REDDIT_ACTOR,
        status: "queued",
        config: data as never,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(error?.message ?? "Could not create the scan job");

    try {
      const run = await startActorRun(REDDIT_ACTOR, redditActorInput(data));
      await context.supabase
        .from("scan_jobs")
        .update({ apify_run_id: run.runId, dataset_id: run.datasetId, status: "running" })
        .eq("id", job.id)
        .eq("user_id", context.userId);
      return { scanJobId: job.id, apifyRunId: run.runId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await context.supabase
        .from("scan_jobs")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("user_id", context.userId);
      throw new Error(message);
    }
  });

const WebsiteScanInput = z.object({
  websites: z.array(z.string().url()).min(1).max(20),
  max_pages: z.number().int().min(1).max(50).default(5),
});

/** Starts an Apify Website Actor run to build company/contact leads. */
export const startWebsiteScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WebsiteScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { WEBSITE_ACTOR, websiteActorInput, startActorRun } = await import("./apify.server");

    const { data: job, error } = await context.supabase
      .from("scan_jobs")
      .insert({
        user_id: context.userId,
        source: "website",
        actor_id: WEBSITE_ACTOR,
        status: "queued",
        config: data as never,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(error?.message ?? "Could not create the scan job");

    try {
      const run = await startActorRun(WEBSITE_ACTOR, websiteActorInput(data));
      await context.supabase
        .from("scan_jobs")
        .update({ apify_run_id: run.runId, dataset_id: run.datasetId, status: "running" })
        .eq("id", job.id)
        .eq("user_id", context.userId);
      return { scanJobId: job.id, apifyRunId: run.runId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await context.supabase
        .from("scan_jobs")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("user_id", context.userId);
      throw new Error(message);
    }
  });

/**
 * Polls one scan job. When the Actor has finished, the dataset is imported,
 * scored by Lovable AI and turned into opportunities. Safe to call repeatedly.
 */
export const syncScanJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scanJobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { syncOneScanJob } = await import("./scan-sync.server");
    return syncOneScanJob(context.supabase, context.userId, data.scanJobId);
  });

export const listScanJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("scan_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw error;
    return data ?? [];
  });

/** Re-runs a failed scan with the exact same configuration. */
export const retryScanJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scanJobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("scan_jobs")
      .select("source, config")
      .eq("id", data.scanJobId)
      .eq("user_id", context.userId)
      .single();
    if (error || !job) throw new Error("Scan job not found");

    const { REDDIT_ACTOR, WEBSITE_ACTOR, redditActorInput, websiteActorInput, startActorRun } =
      await import("./apify.server");
    const isReddit = job.source === "reddit";
    const actor = isReddit ? REDDIT_ACTOR : WEBSITE_ACTOR;
    const input = isReddit
      ? redditActorInput(RedditScanInput.parse(job.config))
      : websiteActorInput(WebsiteScanInput.parse(job.config));

    const { data: retry, error: insertError } = await context.supabase
      .from("scan_jobs")
      .insert({
        user_id: context.userId,
        source: job.source,
        actor_id: actor,
        status: "running",
        config: job.config as never,
      })
      .select("id")
      .single();
    if (insertError || !retry) throw new Error(insertError?.message ?? "Could not retry the scan");

    const run = await startActorRun(actor, input);
    await context.supabase
      .from("scan_jobs")
      .update({ apify_run_id: run.runId, dataset_id: run.datasetId })
      .eq("id", retry.id)
      .eq("user_id", context.userId);
    return { scanJobId: retry.id };
  });
