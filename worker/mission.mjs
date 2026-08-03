// Reddit prospecting mission runner. Runs inside GitHub Actions
// (.github/workflows/run-mission.yml), drives a real browser with Playwright,
// uses Lovable AI to qualify leads + write personalised replies, and streams
// every event back to the app over a signed HTTPS callback.

import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const {
  LOVABLE_API_KEY,
  WORKFLOW_CALLBACK_SECRET,
  RUN_ID,
  THREAD_ID,
  USER_ID,
  MISSION,
  CALLBACK_URL,
} = process.env;

for (const [k, v] of Object.entries({
  LOVABLE_API_KEY,
  WORKFLOW_CALLBACK_SECRET,
  RUN_ID,
  THREAD_ID,
  USER_ID,
  MISSION,
  CALLBACK_URL,
})) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const mission = JSON.parse(MISSION);
const cfg = {
  productName: mission.product_name || "Business AI solutions",
  productUrl: mission.product_url,
  audience: mission.audience || "Canadian business owners",
  country: mission.country || "Canada",
  maxContacts: clamp(Number(mission.max_contacts) || 30, 1, 200),
  durationMinutes: clamp(Number(mission.duration_minutes) || 40, 1, 240),
  scans: clamp(Number(mission.scans) || 30, 1, 200),
  pacePerMinute: clamp(Number(mission.pace_per_minute) || 1, 1, 10),
  recencyMinutes: clamp(Number(mission.recency_minutes) || 60, 5, 1440),
  subreddits: (mission.subreddits?.length ? mission.subreddits : ["smallbusiness"]).slice(0, 20),
  specifications: mission.specifications || "",
  extra: mission.extra_instructions || "",
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const deadline = Date.now() + cfg.durationMinutes * 60_000;
const gapMs = Math.round(60_000 / cfg.pacePerMinute);

const QUERIES = [
  "looking for booking software",
  "need appointment scheduling software",
  "recommend crm small business",
  "automate my business",
  "AI tool for my business",
  "help managing bookings",
  "scheduling nightmare clients",
  "software recommendation small business",
  "need help with customer management",
  "any AI tools for admin work",
];

/* ---------------- callback plumbing ---------------- */

async function post(body) {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", WORKFLOW_CALLBACK_SECRET).update(raw).digest("hex");
  try {
    const res = await fetch(CALLBACK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sig },
      body: raw,
    });
    if (!res.ok) console.error(`callback ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.error("callback failed", e?.message);
  }
}

const logEvent = (kind, data) =>
  post({ type: "event", runId: RUN_ID, userId: USER_ID, threadId: THREAD_ID, kind, data });

/* ---------------- Lovable AI ---------------- */

async function ai(system, user) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ai gateway ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

const QUALIFY_SYSTEM = `You qualify Reddit posts as sales leads for a business-AI product and write one genuinely helpful reply.

Product: ${cfg.productName}
Product URL: ${cfg.productUrl}
Ideal prospect: ${cfg.audience}
Country requirement: the poster must plausibly be in ${cfg.country}. Look for explicit signals (province/city names, "Canada", CAD, GST/HST, Canadian subreddits). If there is no signal at all, treat it as not qualified.
Extra instructions from the operator: ${cfg.specifications} ${cfg.extra}

Understand meaning, not keywords: qualify people asking for help, hunting for software, drowning in admin, needing scheduling/booking/CRM/automation, or asking about AI for their business. Do NOT qualify job posts, self-promotion, memes, or people with no real need.

Reply rules: 2-4 sentences, conversational, first mirror their specific problem in their words, then say you build solutions for this and mention the prototype, then include the product URL exactly once. No hype, no emoji, no "Hi there", never identical wording between leads.

Answer strictly as JSON:
{"qualified": boolean, "intent_score": 0-100, "country_signal": "short reason or empty", "problem": "one line", "message": "the reply, empty if not qualified"}`;

/* ---------------- Reddit discovery via Playwright ---------------- */

let browser;
async function getContext() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
}

async function fetchJson(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!res || !res.ok()) throw new Error(`reddit ${res?.status()} for ${url}`);
  const body = await page.evaluate(() => document.body?.innerText || "");
  return JSON.parse(body);
}

function normalise(children) {
  return (children || [])
    .map((c) => c.data)
    .filter(Boolean)
    .map((d) => ({
      id: d.id,
      url: `https://www.reddit.com${d.permalink}`,
      author: d.author,
      subreddit: d.subreddit,
      title: d.title || "",
      body: (d.selftext || d.body || "").slice(0, 1500),
      createdMs: (d.created_utc || 0) * 1000,
    }))
    .filter((p) => p.url && p.author && p.author !== "[deleted]");
}

async function discover(page) {
  const found = [];
  const cutoff = Date.now() - cfg.recencyMinutes * 60_000;
  const seen = new Set();

  const urls = [];
  for (const q of QUERIES) {
    urls.push(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=25`,
    );
  }
  for (const sub of cfg.subreddits) {
    urls.push(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=25`);
  }

  for (const url of urls) {
    if (Date.now() > deadline) break;
    try {
      const json = await fetchJson(page, url);
      const posts = normalise(json?.data?.children);
      let fresh = 0;
      for (const p of posts) {
        if (seen.has(p.url)) continue;
        seen.add(p.url);
        if (p.createdMs && p.createdMs < cutoff) continue;
        found.push(p);
        fresh++;
      }
      await logEvent("log", {
        message: `Scanned ${url.replace("https://www.reddit.com", "")} — ${fresh} fresh conversation${fresh === 1 ? "" : "s"}`,
      });
    } catch (e) {
      await logEvent("log", { message: `Scan skipped (${e.message.slice(0, 120)})` });
    }
    await sleep(1200 + Math.random() * 1200);
    if (found.length >= cfg.scans * 3) break;
  }

  found.sort((a, b) => b.createdMs - a.createdMs);
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- main mission loop ---------------- */

async function main() {
  let contacted = 0;
  let reviewed = 0;
  let scanned = 0;
  const messages = [];

  try {
    await logEvent("mission_start", {
      maxContacts: cfg.maxContacts,
      durationMinutes: cfg.durationMinutes,
      country: cfg.country,
      pacePerMinute: cfg.pacePerMinute,
    });

    const context = await getContext();
    const page = await context.newPage();

    const candidates = await discover(page);
    await logEvent("log", {
      message: `${candidates.length} recent conversations queued for qualification.`,
    });

    // A screenshot so the operator can see the browser really ran.
    try {
      await page.goto("https://www.reddit.com/r/smallbusiness/new/", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const shot = await page.screenshot({ type: "png" });
      await logEvent("screenshot", { data_url: `data:image/png;base64,${shot.toString("base64")}` });
    } catch {}

    for (const p of candidates) {
      if (contacted >= cfg.maxContacts) break;
      if (Date.now() > deadline) {
        await logEvent("log", { message: "Campaign duration reached — stopping." });
        break;
      }
      if (reviewed >= cfg.scans * 4) break;

      reviewed++;
      scanned++;
      let verdict;
      try {
        verdict = await ai(
          QUALIFY_SYSTEM,
          `Subreddit: r/${p.subreddit}\nAuthor: u/${p.author}\nPosted: ${new Date(p.createdMs).toISOString()}\nTitle: ${p.title}\nBody: ${p.body}`,
        );
      } catch (e) {
        await logEvent("log", { message: `Qualification failed: ${e.message.slice(0, 140)}` });
        continue;
      }

      if (!verdict.qualified || !verdict.message) continue;

      contacted++;
      messages.push({ url: p.url, author: p.author, message: verdict.message });
      await post({
        type: "prospect",
        runId: RUN_ID,
        userId: USER_ID,
        threadId: THREAD_ID,
        prospect: {
          post_url: p.url,
          author: p.author,
          subreddit: p.subreddit,
          title: p.title.slice(0, 300),
          excerpt: p.body.slice(0, 400),
          problem: String(verdict.problem || "").slice(0, 300),
          message: String(verdict.message).slice(0, 2000),
          country_signal: String(verdict.country_signal || "").slice(0, 200),
          intent_score: Math.round(Number(verdict.intent_score) || 0),
        },
      });
      await logEvent("prospect_found", {
        author: p.author,
        subreddit: p.subreddit,
        url: p.url,
        intent_score: Math.round(Number(verdict.intent_score) || 0),
        count: contacted,
      });

      if (contacted < cfg.maxContacts && Date.now() + gapMs < deadline) {
        await sleep(gapMs + Math.round(Math.random() * 15_000));
      }
    }

    const summary = [
      `**Mission complete — ${contacted} lead${contacted === 1 ? "" : "s"} ready.**`,
      "",
      `- Conversations reviewed: ${scanned}`,
      `- Qualified ${cfg.country} prospects contacted: ${contacted} / ${cfg.maxContacts}`,
      `- Pace: ${cfg.pacePerMinute} per minute, window ${cfg.durationMinutes} min`,
      `- Product linked: ${cfg.productUrl}`,
      "",
      contacted
        ? "Each lead below has a tailored reply written for their exact question — open the thread and post it as yourself."
        : "No fresh conversation met the intent + Canada bar in this window. Widen the recency window or add subreddits in Mission settings.",
    ].join("\n");

    await post({
      type: "final",
      runId: RUN_ID,
      threadId: THREAD_ID,
      userId: USER_ID,
      status: "succeeded",
      text: summary,
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
    await browser?.close().catch(() => {});
  }
}

main();
