import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ----- Types -----
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };

// ----- Tool schema exposed to Claude -----
const tools = [
  {
    name: "browse",
    description:
      "Load a web page in a headless browser and return its title, visible text (up to 12k chars), and a screenshot. Use this to read content from a URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full https:// URL to load." },
        wait_for: {
          type: "string",
          description: "Optional CSS selector to wait for before capturing.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "extract",
    description:
      "Load a page and extract text (or an attribute) from every element matching a CSS selector. Good for lists like search results, headlines, or links.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        selector: { type: "string", description: "CSS selector matching the items to extract." },
        attribute: {
          type: "string",
          description: "Optional attribute name (e.g. 'href'). Defaults to text content.",
        },
      },
      required: ["url", "selector"],
    },
  },
  {
    name: "screenshot",
    description: "Load a page and capture a screenshot (full page optional).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        full_page: { type: "boolean" },
      },
      required: ["url"],
    },
  },
];

const SYSTEM_PROMPT = `You are an autonomous AI operator with access to a real headless browser via tools.
The user will give you a command (e.g. "scan recent Reddit posts about AI automation and prepare replies").
Plan the task, call the tools to actually visit pages, extract data, take screenshots, and iterate.
Be concrete: cite URLs you visited and quote or summarize what you found.
When done, produce a final message in clear markdown with:
  - What you did
  - Key findings (with links)
  - Any drafted replies / outputs the user asked for
Do not fabricate content. If a tool fails, try a different approach or explain.`;

const MAX_TURNS = 12;

// ----- Helpers -----
async function callWorker(
  workerUrl: string,
  workerToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`worker ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return json as Record<string, unknown>;
}

async function anthropic(messages: AnthropicMessage[], apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body) as {
    stop_reason: string;
    content: AnthropicContentBlock[];
  };
}

// ----- The orchestrator server function -----
const RunInput = z.object({
  threadId: z.string().uuid(),
  command: z.string().min(1).max(4000),
});

export const runCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error("Missing ANTHROPIC_API_KEY");

    // Load worker URL/token
    const { data: settings } = await supabase
      .from("worker_settings")
      .select("worker_url, status")
      .eq("user_id", userId)
      .maybeSingle();

    const workerUrl = settings?.worker_url;
    const workerToken = process.env.WORKER_TOKEN;
    if (!workerUrl || settings?.status !== "ready") {
      throw new Error(
        "Playwright worker isn't ready yet. Deploy it from the app first (Deploy Worker button).",
      );
    }
    if (!workerToken) throw new Error("Missing WORKER_TOKEN");

    // Persist the user message
    await supabase.from("messages").insert({
      thread_id: data.threadId,
      user_id: userId,
      role: "user",
      content: { text: data.command },
    });

    // Create a run row
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

    const logEvent = async (kind: string, payload: Record<string, unknown>) => {
      await supabase.from("run_events").insert({
        run_id: runId,
        user_id: userId,
        kind,
        data: payload,
      });
    };

    // Load prior thread messages as Claude context
    const { data: prior } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });

    const history: AnthropicMessage[] = (prior ?? [])
      .map((m) => {
        const content = (m.content as { text?: string })?.text;
        if (!content) return null;
        return { role: m.role as "user" | "assistant", content };
      })
      .filter((v): v is AnthropicMessage => Boolean(v));

    try {
      let finalText = "";
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        await logEvent("log", { message: `Claude turn ${turn + 1}` });
        const response = await anthropic(history, anthropicKey);

        // Collect text and tool_use blocks
        const assistantBlocks: AnthropicContentBlock[] = response.content;
        history.push({ role: "assistant", content: assistantBlocks });

        for (const block of assistantBlocks) {
          if (block.type === "text" && block.text.trim()) {
            await logEvent("assistant_text", { text: block.text });
            finalText = block.text;
          }
        }

        if (response.stop_reason !== "tool_use") break;

        // Execute every tool_use in this turn
        const toolResults: AnthropicContentBlock[] = [];
        for (const block of assistantBlocks) {
          if (block.type !== "tool_use") continue;
          await logEvent("tool_call", { name: block.name, input: block.input });

          try {
            let toolContent = "";
            if (block.name === "browse") {
              const r = await callWorker(workerUrl, workerToken, "/browse", block.input);
              if (typeof r.screenshot === "string") {
                await logEvent("screenshot", { data_url: `data:image/png;base64,${r.screenshot}` });
              }
              toolContent = JSON.stringify({ url: r.url, title: r.title, text: r.text });
            } else if (block.name === "extract") {
              const r = await callWorker(workerUrl, workerToken, "/extract", block.input);
              toolContent = JSON.stringify({ items: r.items });
            } else if (block.name === "screenshot") {
              const r = await callWorker(workerUrl, workerToken, "/screenshot", block.input);
              if (typeof r.screenshot === "string") {
                await logEvent("screenshot", { data_url: `data:image/png;base64,${r.screenshot}` });
              }
              toolContent = JSON.stringify({ ok: true });
            } else {
              toolContent = JSON.stringify({ error: `unknown tool ${block.name}` });
            }
            await logEvent("tool_result", { name: block.name, preview: toolContent.slice(0, 400) });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: toolContent,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logEvent("error", { name: block.name, error: msg });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: msg,
              is_error: true,
            });
          }
        }
        history.push({ role: "user", content: toolResults });
      }

      // Persist final assistant message
      await supabase.from("messages").insert({
        thread_id: data.threadId,
        user_id: userId,
        role: "assistant",
        content: { text: finalText || "(no response)" },
      });

      await supabase
        .from("runs")
        .update({ status: "succeeded", result: { text: finalText } })
        .eq("id", runId);

      // Bump thread updated_at + title if empty
      await supabase
        .from("threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", data.threadId);

      return { runId, text: finalText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logEvent("error", { error: msg });
      await supabase.from("runs").update({ status: "failed", error: msg }).eq("id", runId);
      await supabase.from("messages").insert({
        thread_id: data.threadId,
        user_id: userId,
        role: "assistant",
        content: { text: `⚠️ Run failed: ${msg}` },
      });
      throw err;
    }
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
