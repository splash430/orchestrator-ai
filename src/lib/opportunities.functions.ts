import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generateReplyOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ prospectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: prospect, error } = await context.supabase.from("prospects").select("*").eq("id", data.prospectId).eq("user_id", context.userId).single();
    if (error || !prospect) throw new Error("Opportunity not found");
    const { data: settings } = await context.supabase.from("missions").select("product_name, product_url, audience, writing_style, specifications").eq("user_id", context.userId).maybeSingle();
    const key = process.env['LOVABLE_API_KEY'];
    if (!key) throw new Error("AI drafting is not configured");
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return JSON with an options array of exactly 3 helpful Reddit replies: helpful expert, short conversational, and soft introduction. Each must answer the post first, be specific, non-promotional, under 700 characters, and never claim to have read anything not supplied. Mention the product only when genuinely relevant. No hype, spam, emojis, or hashtags." },
          { role: "user", content: `Post title: ${prospect.title ?? ""}\nPost: ${prospect.post_content ?? prospect.excerpt ?? ""}\nProblem: ${prospect.problem ?? ""}\nProduct: ${settings?.product_name ?? "automation services"}\nProduct URL: ${settings?.product_url ?? ""}\nTarget customer: ${settings?.audience ?? ""}\nTone: ${settings?.writing_style ?? "casual"}\nNotes: ${settings?.specifications ?? ""}` },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(response.status === 402 ? "AI credits are exhausted" : response.status === 429 ? "AI is busy; try again shortly" : "AI reply generation failed");
    const content = String(JSON.parse(raw).choices?.[0]?.message?.content ?? "{}");
    const parsed = JSON.parse(content) as { options?: unknown[] };
    const options = (parsed.options ?? []).filter((value): value is string => typeof value === "string").slice(0, 3);
    if (!options.length) throw new Error("AI returned no usable replies");
    await context.supabase.from("prospects").update({ reply_options: options, message: options[0], status: "drafted", drafted_at: new Date().toISOString() }).eq("id", prospect.id).eq("user_id", context.userId);
    return { options };
  });

export const approveReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ prospectId: z.string().uuid(), reply: z.string().min(1).max(4000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("prospects").update({ approved_reply: data.reply, message: data.reply, status: "reply_drafted", approved_at: new Date().toISOString() }).eq("id", data.prospectId).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });