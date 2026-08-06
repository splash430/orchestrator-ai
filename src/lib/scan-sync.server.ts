// Shared scan-job sync: polls the Apify run, imports + scores the dataset.
import type { SupabaseClient } from "@supabase/supabase-js";

import { getActorRun, ingestDataset, type ScanSource } from "./apify.server";

const DEFAULT_PROFILE = {
  product_name: "Business AI solutions",
  audience: "Canadian business owners looking for AI tools and business automation",
  country: "Canada",
  specifications: "",
};

export async function syncOneScanJob(supabase: SupabaseClient, userId: string, scanJobId: string) {
  const { data: job, error } = await supabase
    .from("scan_jobs")
    .select("*")
    .eq("id", scanJobId)
    .eq("user_id", userId)
    .single();
  if (error || !job) throw new Error("Scan job not found");
  if (job.status === "completed" || job.status === "failed") {
    return { status: job.status as string, collected: job.items_collected, created: job.opportunities_created };
  }
  if (!job.apify_run_id) return { status: job.status as string, collected: 0, created: 0 };

  const run = await getActorRun(job.apify_run_id);

  if (run.status === "RUNNING" || run.status === "READY") {
    return { status: "running", collected: 0, created: 0 };
  }

  if (run.status !== "SUCCEEDED") {
    await supabase
      .from("scan_jobs")
      .update({
        status: "failed",
        error: run.statusMessage ?? `Apify run ${run.status}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { status: "failed", collected: 0, created: 0 };
  }

  const { data: mission } = await supabase
    .from("missions")
    .select("product_name, audience, country, specifications")
    .eq("user_id", userId)
    .maybeSingle();

  try {
    const result = await ingestDataset(
      supabase,
      {
        id: job.id as string,
        user_id: userId,
        source: job.source as ScanSource,
        dataset_id: (job.dataset_id as string) || run.datasetId,
        config: (job.config ?? {}) as Record<string, unknown>,
      },
      { ...DEFAULT_PROFILE, ...(mission ?? {}) },
    );
    await supabase
      .from("scan_jobs")
      .update({
        status: "completed",
        items_collected: result.collected,
        opportunities_created: result.created,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { status: "completed", ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", job.id);
    throw new Error(message);
  }
}
