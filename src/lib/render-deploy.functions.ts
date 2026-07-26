import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createWorkerService, getRenderService, normalizeRepoUrl } from "@/lib/render-deploy.server";

// Deploys / provisions the Playwright worker on Render using the user's
// RENDER_API_KEY. The repo built is the same repo this Lovable app lives in
// (GitHub sync must be enabled); the worker Dockerfile is under `worker/`.
//
// We store `render_service_id` + `worker_url` on `worker_settings` and mark
// status ready once Render reports the service is live.

export const getWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("worker_settings")
      .select("status, worker_url, render_service_id, last_error, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data ?? { status: "not_deployed" as const };
  });

// Configure an existing Render service by id (skip creating one).
type DeployInput = { repoUrl: string; branch?: string };

export const deployWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const raw = (input ?? {}) as Partial<DeployInput>;
    if (!raw.repoUrl || typeof raw.repoUrl !== "string") {
      throw new Error("repoUrl is required (your GitHub repo URL for this Lovable app)");
    }
    return { repoUrl: normalizeRepoUrl(raw.repoUrl), branch: raw.branch || "main" };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const renderKey = process.env.RENDER_API_KEY;
    const workerToken = process.env.WORKER_TOKEN;
    if (!renderKey) throw new Error("Missing RENDER_API_KEY");
    if (!workerToken) throw new Error("Missing WORKER_TOKEN");

    await supabase
      .from("worker_settings")
      .upsert({ user_id: userId, status: "deploying", last_error: null }, { onConflict: "user_id" });

    try {
      // Create a Docker-based web service using the worker/ subdir.
      const { serviceId, url } = await createWorkerService({
        renderKey,
        workerToken,
        userId,
        repoUrl: data.repoUrl,
        branch: data.branch,
      });

      await supabase
        .from("worker_settings")
        .upsert(
          {
            user_id: userId,
            render_service_id: serviceId,
            worker_url: url ?? null,
            status: "deploying",
            last_error: null,
          },
          { onConflict: "user_id" },
        );

      return { ok: true as const, serviceId, url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("worker_settings")
        .upsert(
          { user_id: userId, status: "failed", last_error: msg },
          { onConflict: "user_id" },
        );
      return { ok: false as const, error: msg };
    }
  });

// Poll Render for status; when the service is live and /healthz responds, mark ready.
export const refreshWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const renderKey = process.env.RENDER_API_KEY;
    const workerToken = process.env.WORKER_TOKEN;
    if (!renderKey) throw new Error("Missing RENDER_API_KEY");

    const { data: settings } = await supabase
      .from("worker_settings")
      .select("render_service_id, worker_url, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!settings?.render_service_id) {
      return { status: "not_deployed" as const };
    }

    const svc = await getRenderService(renderKey, settings.render_service_id);
    const url = svc.serviceDetails?.url || settings.worker_url;

    // Try /healthz to confirm reachability
    let ready = false;
    let err: string | null = null;
    if (url && workerToken) {
      try {
        const r = await fetch(`${url.replace(/\/$/, "")}/healthz`, {
          headers: { authorization: `Bearer ${workerToken}` },
        });
        ready = r.ok;
        if (!r.ok) err = `healthz ${r.status}`;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
    }

    await supabase
      .from("worker_settings")
      .update({
        worker_url: url ?? null,
        status: ready ? "ready" : "deploying",
        last_error: err,
      })
      .eq("user_id", userId);

    return { status: ready ? "ready" : "deploying", worker_url: url, error: err };
  });
