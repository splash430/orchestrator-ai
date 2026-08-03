// Runs inside GitHub Actions (workflow: .github/workflows/run-command.yml).
// Executes the Claude tool-use loop directly, calling local Playwright for
// browser tools, and streams every event back to the Lovable app via a
// signed HTTPS callback. No long-running server needed.

import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const {
  LOVABLE_API_KEY,
  WORKFLOW_CALLBACK_SECRET,
  RUN_ID,
  THREAD_ID,
  USER_ID,
  COMMAND,
  CALLBACK_URL,
} = process.env;

for (const [k, v] of Object.entries({
  LOVABLE_API_KEY,
  WORKFLOW_CALLBACK_SECRET,
  RUN_ID,
  THREAD_ID,
  USER_ID,
  COMMAND,
  CALLBACK_URL,
})) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const MAX_TURNS = 12;

const rawTools = [
  {
    name: "browse",
    description:
      "Load a web page in a headless browser and return its title, visible text (up to 12k chars), and a screenshot.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        wait_for: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "extract",
    description:
      "Load a page and extract text (or an attribute) from every element matching a CSS selector.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        selector: { type: "string" },
        attribute: { type: "string" },
      },
      required: ["url", "selector"],
    },
  },
  {
    name: "screenshot",
    description: "Load a page and capture a screenshot.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, full_page: { type: "boolean" } },
      required: ["url"],
    },
  },
];

const tools = rawTools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

const SYSTEM_PROMPT = `You are an autonomous AI operator with access to a real headless browser via tools.
Plan the task, call the tools to actually visit pages, extract data, take screenshots, and iterate.
Be concrete: cite URLs you visited and quote or summarize what you found.
When done, produce a final message in clear markdown with:
  - What you did
  - Key findings (with links)
  - Any drafted replies / outputs the user asked for
Do not fabricate. If a tool fails, try a different approach or explain.`;

async function post(body) {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", WORKFLOW_CALLBACK_SECRET).update(raw).digest("hex");
  const res = await fetch(CALLBACK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body: raw,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`callback ${res.status}: ${t.slice(0, 300)}`);
  }
}

const logEvent = (kind, data) =>
  post({ type: "event", runId: RUN_ID, userId: USER_ID, threadId: THREAD_ID, kind, data });

async function llm(messages) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      reasoning_effort: "none",
      tools,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ai gateway ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body).choices[0].message;
}

let browserPromise;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

async function gotoAndWait(page, url, opts = {}) {
  const timeout = Math.min(Number(opts.timeout_ms) || 30000, 60000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  if (opts.wait_for) {
    await page.waitForSelector(opts.wait_for, { timeout }).catch(() => {});
  } else {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  }
}

async function runTool(name, input) {
  if (name === "browse") {
    return await withPage(async (page) => {
      await gotoAndWait(page, input.url, input);
      const title = await page.title();
      const text = (await page.evaluate(() => document.body?.innerText || "")).slice(0, 12000);
      const shot = await page.screenshot({ type: "png", fullPage: false });
      return { url: page.url(), title, text, screenshot: shot.toString("base64") };
    });
  }
  if (name === "extract") {
    return await withPage(async (page) => {
      await gotoAndWait(page, input.url, { wait_for: input.wait_for || input.selector });
      const items = await page.$$eval(
        input.selector,
        (nodes, attr) =>
          nodes
            .map((n) => (attr ? n.getAttribute(attr) : n.textContent?.trim() || ""))
            .filter(Boolean),
        input.attribute || null,
      );
      return { items: items.slice(0, 200) };
    });
  }
  if (name === "screenshot") {
    return await withPage(async (page) => {
      await gotoAndWait(page, input.url, input);
      const shot = await page.screenshot({ type: "png", fullPage: !!input.full_page });
      return { screenshot: shot.toString("base64") };
    });
  }
  throw new Error(`unknown tool ${name}`);
}

async function main() {
  const history = [{ role: "user", content: COMMAND }];
  let finalText = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      await logEvent("log", { message: `Claude turn ${turn + 1}` });
      const response = await anthropic(history);
      history.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          await logEvent("assistant_text", { text: block.text });
          finalText = block.text;
        }
      }

      if (response.stop_reason !== "tool_use") break;

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        await logEvent("tool_call", { name: block.name, input: block.input });
        try {
          const r = await runTool(block.name, block.input);
          if (r.screenshot) {
            await logEvent("screenshot", { data_url: `data:image/png;base64,${r.screenshot}` });
          }
          const preview =
            block.name === "browse"
              ? JSON.stringify({ url: r.url, title: r.title, text: r.text })
              : block.name === "extract"
                ? JSON.stringify({ items: r.items })
                : JSON.stringify({ ok: true });
          await logEvent("tool_result", { name: block.name, preview: preview.slice(0, 400) });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: preview });
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

    await post({
      type: "final",
      runId: RUN_ID,
      threadId: THREAD_ID,
      userId: USER_ID,
      status: "succeeded",
      text: finalText || "(no response)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("error", { error: msg });
    await post({
      type: "final",
      runId: RUN_ID,
      threadId: THREAD_ID,
      userId: USER_ID,
      status: "failed",
      error: msg,
    });
    process.exitCode = 1;
  } finally {
    try {
      const b = await browserPromise;
      await b?.close();
    } catch {}
  }
}

main();
