// Reddit prospecting mission runner. Runs inside GitHub Actions
// (.github/workflows/run-mission.yml) on GitHub's servers — so it keeps running
// even if the operator closes the browser tab. Drives a real browser with
// Playwright, uses Lovable AI to qualify leads + write personalised replies,
// and streams every event back to the app over a signed HTTPS callback.

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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const mission = JSON.parse(MISSION);
const cfg = {
  productName: mission.product_name || "Business AI solutions",
  productUrl: mission.product_url || "https://splashdevelopmentwebsite.base44.app",
  audience: mission.audience || "Canadian business owners",
  country: mission.country || "Canada",
  maxContacts: clamp(Number(mission.max_contacts) || 30, 1, 200),
  durationMinutes: clamp(Number(mission.duration_minutes) || 240, 1, 240),
  scans: clamp(Number(mission.scans) || 30, 1, 200),
  contactGapMs: clamp(Number(mission.contact_gap_seconds) || 150, 15, 3600) * 1000,
  recencyMinutes: clamp(Number(mission.recency_minutes) || 180, 5, 1440),
  subreddits: (mission.subreddits?.length ? mission.subreddits : ["smallbusiness"]).slice(0, 20),
  specifications: mission.specifications || "",
  extra: mission.extra_instructions || "",
};

const deadline = Date.now() + cfg.durationMinutes * 60_000;
const PARALLEL_SCANNERS = 6;

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
  "AI automation for my business",
  "hire someone to automate",
  "chatbot for my business",
  "drowning in admin work",
  "missed calls losing customers",
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

const QUALIFY_SYSTEM = `You qualify Reddit posts as sales leads for a business-AI product and write one genuinely helpful reply that answers the person's actual question.

Product: ${cfg.productName}
Product URL: ${cfg.productUrl}
Ideal prospect: ${cfg.audience}
Country requirement: the poster must plausibly be in ${cfg.country}. Look for explicit signals (province/city names, "Canada", CAD, GST/HST, Canadian subreddits). If there is no signal at all, treat it as not qualified.
Extra instructions from the operator: ${cfg.specifications} ${cfg.extra}

Understand meaning, not keywords: qualify people who are shopping for or asking about business AI / automation, booking-scheduling-CRM software, or are drowning in admin. Do NOT qualify job posts, self-promotion, memes, or people with no real need.

WRITING RULES — this must not read like AI:
- Answer their question first, in plain spoken English, like one business owner replying to another.
- Reference a concrete detail from their post (their trade, their city, the exact bottleneck, the tool they named).
- 2-4 short sentences. Contractions. No bullet lists.
- BANNED words and shapes: "I hope this helps", "Great question", "Hi there", "As an AI", "leverage", "streamline", "seamless", "robust", "in today's fast-paced", "elevate", "unlock", "game-changer", "delve", "furthermore", "moreover", em dashes used as drama, emoji, hashtags, exclamation marks.
- No sales pitch language and no feature lists. Mention that you build this kind of thing and drop the URL once, casually, at the end.
- Every reply must be worded completely differently from any other reply. Vary sentence length and openers; never start two replies the same way.

Answer strictly as JSON:
{"qualified": boolean, "intent_score": 0-100, "country_signal": "short reason or empty", "problem": "one line", "message": "the reply, empty if not qualified"}`;

/* ---------------- Reddit discovery via Playwright ---------------- */

let browser;
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

async function newScanner() {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  return { context, page };
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

function scanUrls() {
  const urls = [];
  for (const q of QUERIES) {
    urls.push(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=25`);
  }
  for (const sub of cfg.subreddits) {
    urls.push(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=25`);
  }
  return urls;
}

/** Fires PARALLEL_SCANNERS browser tabs at Reddit at once — seconds, not minutes. */
async function discover(seenUrls) {
  const urls = scanUrls();
  const cutoff = Date.now() - cfg.recencyMinutes * 60_000;
  const found = [];
  let cursor = 0;

  await logEvent("log", {
    message: `Launching ${PARALLEL_SCANNERS} parallel scanners across ${urls.length} Reddit feeds…`,
  });

  const workers = Array.from({ length: PARALLEL_SCANNERS }, async () => {
    const { context, page } = await newScanner();
    try {
      while (true) {
        const i = cursor++;
        if (i >= urls.length || Date.now() > deadline) break;
        const url = urls[i];
        try {
          const json = await fetchJson(page, url);
          for (const p of normalise(json?.data?.children)) {
            if (seenUrls.has(p.url)) continue;
            seenUrls.add(p.url);
            if (p.createdMs && p.createdMs < cutoff) continue;
            found.push(p);
          }
        } catch (e) {
          console.error("scan failed", url, e?.message);
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  });

  await Promise.all(workers);
  found.sort((a, b) => b.createdMs - a.createdMs);
  await logEvent("log", {
    message: `Scan complete — ${found.length} fresh conversation${found.length === 1 ? "" : "s"} collected.`,
  });
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- main mission loop ---------------- */

async function main() {
  let contacted = 0;
  let reviewed = 0;
  let cycles = 0;
  const seenUrls = new Set();

  try {
    await logEvent("mission_start", {
      maxContacts: cfg.maxContacts,
      durationMinutes: cfg.durationMinutes,
      country: cfg.country,
      contactGapSeconds: Math.round(cfg.contactGapMs / 1000),
      parallelScanners: PARALLEL_SCANNERS,
    });

    // Proof-of-browser screenshot, taken once up front.
    try {
      const { context, page } = await newScanner();
      await page.goto("https://www.reddit.com/r/smallbusiness/new/", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const shot = await page.screenshot({ type: "png" });
      await logEvent("screenshot", {
        data_url: `data:image/png;base64,${shot.toString("base64")}`,
      });
      await context.close().catch(() => {});
    } catch {}

    // Scan → contact → repeat, until the campaign window closes.
    while (Date.now() < deadline) {
      cycles++;
      await logEvent("log", { message: `Scan cycle ${cycles} starting.` });

      const candidates = (await discover(seenUrls)).slice(0, cfg.scans * 4);
      let contactedThisCycle = 0;

      for (const p of candidates) {
        if (Date.now() > deadline) break;
        if (contacted >= cfg.maxContacts * 8) break;
        if (contactedThisCycle >= cfg.maxContacts) break;

        reviewed++;
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
        contactedThisCycle++;
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

        // Pace outreach: one lead every contactGapMs.
        const jitter = Math.round(Math.random() * 15_000);
        if (Date.now() + cfg.contactGapMs + jitter < deadline) {
          await sleep(cfg.contactGapMs + jitter);
        } else {
          break;
        }
      }

      if (Date.now() >= deadline) break;
      if (!contactedThisCycle) {
        await logEvent("log", {
          message: "No new qualified conversation this cycle — pausing 5 minutes, then scanning again.",
        });
        await sleep(Math.min(5 * 60_000, Math.max(0, deadline - Date.now())));
      }
    }

    const hours = Math.round((cfg.durationMinutes / 60) * 10) / 10;
    const summary = [
      `**Mission complete — ${contacted} lead${contacted === 1 ? "" : "s"} ready.**`,
      "",
      `- Scan cycles run: ${cycles} over ${hours}h`,
      `- Conversations reviewed: ${reviewed}`,
      `- Qualified ${cfg.country} prospects queued: ${contacted}`,
      `- Pace: one reply every ${Math.round(cfg.contactGapMs / 6000) / 10} min`,
      `- Product linked: ${cfg.productUrl}`,
      "",
      contacted
        ? "Each lead below has a reply written for their exact question — open the thread and post it as yourself."
        : "No fresh conversation met the intent + country bar in this window. Widen the recency window or add subreddits in Mission settings.",
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
