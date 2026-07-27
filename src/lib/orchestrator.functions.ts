import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// GitHub-Actions-backed orchestrator: each `runCommand` dispatches a
// workflow (`.github/workflows/run-command.yml`) in the user's repo that
// runs the Claude + Playwright loop and streams events back to
// `/api/public/run-events`.

function callbackUrl() {
  try {
    const req = getRequest();
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) return `${proto}://${host}/api/public/run-events`;
  } catch {}
  const override = process.env.PUBLIC_SITE_URL;
  if (override) return `${override.replace(/\/$/, "")}/api/public/run-events`;
  throw new Error(
    "Unable to determine callback URL. Set PUBLIC_SITE_URL env var to your published site (e.g. https://your.lovable.app)",
  );
}

export const getGithubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return {
      repo: process.env.GITHUB_REPO ?? null,
      hasToken: !!process.env.GITHUB_DISPATCH_TOKEN,
      hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
      hasCallbackSecret: !!process.env.WORKFLOW_CALLBACK_SECRET,
    };
  });

const RunInput = z.object({
  threadId: z.string().uuid(),
  command: z.string().min(1).max(4000),
});

export const runCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!repo || !token) {
      throw new Error(
        "GitHub isn't configured yet. Add GITHUB_REPO (owner/repo) and GITHUB_DISPATCH_TOKEN in project secrets.",
      );
    }
    if (!process.env.WORKFLOW_CALLBACK_SECRET) {
      throw new Error("Missing WORKFLOW_CALLBACK_SECRET");
    }

    // Persist the user message
    await supabase.from("messages").insert({
      thread_id: data.threadId,
      user_id: userId,
      role: "user",
      content: { text: data.command },
    });

    // Create run row (status=running; the worker will mark succeeded/failed)
    const { data: run, error: runErr } = await supabase
      .from("runs")
      .insert({
        thread_id: data.threadId,
        user_id: userId,
        command: data.command,
        status: "running",
      })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(runErr?.message || "failed to create run");
    const runId = run.id;

    const cbUrl = callbackUrl();

    // Trigger the GitHub Actions workflow
    const dispatchRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/run-command.yml/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            run_id: runId,
            thread_id: data.threadId,
            user_id: userId,
            command: data.command,
            callback_url: cbUrl,
          },
        }),
      },
    );

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      const msg = `GitHub dispatch failed (${dispatchRes.status}): ${errText.slice(0, 400)}`;
      await supabase.from("runs").update({ status: "failed", error: msg }).eq("id", runId);
      await supabase.from("run_events").insert({
        run_id: runId,
        user_id: userId,
        kind: "error",
        data: { error: msg } as never,
      });
      throw new Error(msg);
    }

    await supabase.from("run_events").insert({
      run_id: runId,
      user_id: userId,
      kind: "log",
      data: { message: "Dispatched GitHub Actions workflow — waiting for worker to start…" } as never,
    });

    return { runId };
  });

// ----- Thread management -----
export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("threads")
      .insert({ user_id: context.userId, title: data.title || "New chat" })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("threads")
      .update({ title: data.title })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("threads")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
