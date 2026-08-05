// Reddit JOB FINDER — discovery only. Runs inside GitHub Actions
// (.github/workflows/run-mission.yml) so it keeps working after the operator
// closes the tab. Fires 40 parallel Playwright scanners at Reddit, qualifies
// every candidate with Lovable AI, and streams progress + leads back to the
// app over a signed HTTPS callback.
//
// It NEVER posts a comment or sends a DM. Outreach drafts are generated in the
// app only after the operator approves a lead.

import { chromium } from "playwright";
import { createHmac } from "node:crypto";

// Safety invariant: this worker discovers and analyzes only. Reddit posting is
// intentionally impossible in this workflow; the final Comment click is human-only.
const ALLOW_REDDIT_POSTING = false;
if (ALLOW_REDDIT_POSTING) throw new Error("Automated Reddit posting is disabled by design");

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

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mission = JSON.parse(MISSION);

const KEYWORDS = [
  "AI chatbot",
  "AI automation",
  "AI agent",
  "lead generation AI",
  "appointment booking AI",
  "customer support AI",
  "sales automation",
  "CRM automation",
  "workflow automation",
  "business automation",
];

const DEFAULT_SUBS = [
  "smallbusiness",
  "Entrepreneur",
  "SaaS",
  "startups",
  "automation",
  "Business_Ideas",
  "ArtificialInteligence",
  "leadgeneration",
  "sales",
];

const cfg = {
  productName: mission.product_name || "Business AI solutions",
  productUrl: mission.product_url || "https://splashdevelopmentwebsite.base44.app",
  audience: mission.audience || "business owners looking to buy AI automation",
  country: mission.country || "",
  maxLeads: clamp(Number(mission.max_contacts) || 30, 1, 200),
  recencyMinutes: clamp(Number(mission.recency_minutes) || 360, 30, 1440),
  subreddits: (mission.subreddits?.length ? mission.subreddits : DEFAULT_SUBS).slice(0, 24),
  specifications: mission.specifications || "",
  extra: mission.extra_instructions || "",
  urls: Array.isArray(mission.reddit_urls) ? mission.reddit_urls.slice(0, 30) : [],
  keywords: Array.isArray(mission.keywords) && mission.keywords.length ? mission.keywords.slice(0, 30) : KEYWORDS,
  postLimit: clamp(Number(mission.post_limit) || 40, 10, 100),
  sort: ["new", "hot", "top"].includes(mission.sort_order) ? mission.sort_order : "new",
  writingStyle: mission.writing_style || "casual",
};

const SCANNERS = 40;
const HARD_DEADLINE = Date.now() + 20 * 60_000;

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

/* ---------------- Lovable AI qualification ---------------- */

async function ai(system, user) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
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
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

const QUALIFY_SYSTEM = `You are a lead qualifier for a business-AI product. You read one Reddit post and decide whether the AUTHOR is actively looking to hire, buy, or get recommendations for an AI / automation solution.

Product being sold: ${cfg.productName} (${cfg.productUrl})
Ideal buyer: ${cfg.audience}
${cfg.country ? `Preferred location: ${cfg.country} (a location match raises intent_score, it is NOT required).` : ""}
Operator notes: ${cfg.specifications} ${cfg.extra}

QUALIFY only when the author is: asking for a tool/vendor/agency recommendation, asking how to automate a real business problem they own, asking to hire someone to build it, or comparing products to buy.

REJECT: people selling or promoting their own product, agency self-promo, job listings hiring employees, memes, "I built this" show-offs, general news or opinion about AI, students, resellers, and anything with no real business need.

Answer strictly as JSON:
{"qualified": boolean, "intent_score": 0-100, "summary": "one sentence describing what they are asking for", "qualification_reason": "why this is a buying-intent lead, quoting a concrete detail from the post", "rejection_reason": "if not qualified, the exact reason", "country_signal": "location evidence or empty"}`;

/* ---------------- Playwright scanning ---------------- */

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
  return { context, page: await context.newPage() };
}

async function extractVisiblePosts(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response || response.status() >= 400) throw new Error(`reddit ${response?.status()}`);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => {
    const postElements = Array.from(document.querySelectorAll("shreddit-post, article, [data-testid='post-container']"));
    const posts = postElements.map((element) => {
      const link = element.querySelector("a[href*='/comments/']");
      const href = link?.getAttribute("href") || element.getAttribute("permalink") || "";
      const absolute = href ? new URL(href, location.origin).href : "";
      const title = element.getAttribute("post-title") || element.querySelector("h1,h2,h3")?.textContent?.trim() || "";
      const author = element.getAttribute("author") || element.querySelector("a[href*='/user/']")?.textContent?.trim()?.replace(/^u\//, "") || "";
      const subreddit = element.getAttribute("subreddit-prefixed-name")?.replace(/^r\//, "") || absolute.match(/\/r\/([^/]+)/)?.[1] || "";
      const time = element.querySelector("time")?.getAttribute("datetime") || "";
      const visible = element.textContent?.trim() || "";
      const comments = Array.from(element.querySelectorAll("shreddit-comment, [data-testid='comment']")).slice(0, 8).map((comment) => comment.textContent?.trim() || "").filter(Boolean);
      const scoreText = element.getAttribute("score") || element.querySelector("[data-testid='post-score']")?.textContent?.trim() || "";
      const commentText = element.getAttribute("comment-count") || "";
      return { url: absolute, author, subreddit, title, body: visible.slice(0, 4000), comments, engagement: { score: scoreText, comments: commentText }, createdMs: time ? Date.parse(time) : Date.now() };
    });
    if (!posts.length && location.pathname.includes("/comments/")) {
      const title = document.querySelector("h1")?.textContent?.trim() || document.title;
      posts.push({ url: location.href, author: document.querySelector("a[href*='/user/']")?.textContent?.trim()?.replace(/^u\//, "") || "", subreddit: location.pathname.match(/\/r\/([^/]+)/)?.[1] || "", title, body: document.querySelector("main")?.textContent?.trim()?.slice(0, 4000) || "", comments: Array.from(document.querySelectorAll("shreddit-comment")).slice(0, 8).map((comment) => comment.textContent?.trim() || "").filter(Boolean), engagement: {}, createdMs: Date.now() });
    }
    return posts.filter((post) => post.url && post.title);
  });
}

/** Builds >=40 independent search streams: keyword searches, subreddit feeds
 *  and keyword-scoped subreddit searches. */
function buildStreams() {
  const streams = [];
  for (const input of cfg.urls) {
    try {
      const url = new URL(input);
      url.searchParams.delete("raw_json");
      streams.push({ label: `provided page ${url.pathname}`, url: url.href });
    } catch {}
  }
  for (const q of cfg.keywords) {
    streams.push({
      label: `search "${q}"`,
      url: `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=${cfg.sort}&t=day`,
    });
  }
  for (const sub of cfg.subreddits) {
    streams.push({ label: `r/${sub} ${cfg.sort}`, url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/${cfg.sort}/` });
    streams.push({
      label: `r/${sub} AI search`,
      url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/search/?q=${encodeURIComponent("AI automation OR chatbot OR automate")}&restrict_sr=1&sort=${cfg.sort}&t=week`,
    });
  }
  return streams;
}

/* ---------------- main ---------------- */

async function main() {
  const streams = buildStreams();
  const cutoff = Date.now() - cfg.recencyMinutes * 60_000;
  const seen = new Set();
  const candidates = [];
  const rejections = [];
  let leads = 0;
  let evaluated = 0;
  let done = 0;

  try {
    await logEvent("mission_start", {
      scanners: SCANNERS,
      streams: streams.length,
      keywords: KEYWORDS,
      subreddits: cfg.subreddits,
      recencyMinutes: cfg.recencyMinutes,
      maxLeads: cfg.maxLeads,
    });

    const progress = (phase, extra = {}) =>
      logEvent("progress", {
        phase,
        streams_done: done,
        streams_total: streams.length,
        candidates: candidates.length,
        evaluated,
        leads,
        ...extra,
      });

    await progress("launching");

    // Phase 1 — 40 parallel scanners tear through every stream.
    let cursor = 0;
    const workers = Array.from({ length: SCANNERS }, async () => {
      const { context, page } = await newScanner();
      try {
        while (true) {
          const i = cursor++;
          if (i >= streams.length || Date.now() > HARD_DEADLINE) break;
          const s = streams[i];
          try {
            const extracted = await extractVisiblePosts(page, s.url);
            let fresh = 0;
            for (const p of extracted) {
              if (seen.has(p.url)) continue;
              seen.add(p.url);
              if (p.createdMs && p.createdMs < cutoff) continue;
              candidates.push(p);
              fresh++;
            }
            done++;
            await progress("scanning", { stream: s.label, fresh });
          } catch (e) {
            done++;
            await progress("scanning", { stream: s.label, error: String(e?.message).slice(0, 120) });
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
    });
    await Promise.all(workers);

    candidates.sort((a, b) => b.createdMs - a.createdMs);
    await logEvent("log", {
      message: `${done}/${streams.length} streams scanned · ${candidates.length} fresh posts collected. Qualifying now…`,
    });
    await progress("qualifying");

    // Phase 2 — qualify in small parallel batches.
    const queue = candidates.slice(0, cfg.postLimit);
    let qcursor = 0;
    const qualifiers = Array.from({ length: 6 }, async () => {
      while (true) {
        const i = qcursor++;
        if (i >= queue.length || leads >= cfg.maxLeads || Date.now() > HARD_DEADLINE) break;
        const p = queue[i];
        let v;
        try {
          v = await ai(
            QUALIFY_SYSTEM,
            `Subreddit: r/${p.subreddit}\nAuthor: u/${p.author}\nPosted: ${new Date(p.createdMs).toISOString()}\nTitle: ${p.title}\nBody: ${p.body}`,
          );
        } catch (e) {
          console.error("qualify failed", e?.message);
          continue;
        }
        evaluated++;

        if (!v.qualified) {
          if (rejections.length < 40) {
            rejections.push({
              author: p.author,
              subreddit: p.subreddit,
              title: p.title.slice(0, 140),
              url: p.url,
              reason: String(v.rejection_reason || "No buying intent for an AI solution").slice(0, 240),
            });
          }
          await progress("qualifying");
          continue;
        }

        leads++;
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
            excerpt: p.body.slice(0, 600),
             post_content: p.body,
             comments: p.comments,
             engagement: p.engagement,
            summary: String(v.summary || "").slice(0, 400),
             ai_summary: String(v.summary || "").slice(0, 600),
             recommended_solution: cfg.productName,
             intent_level: Number(v.intent_score) >= 75 ? "high" : Number(v.intent_score) >= 45 ? "medium" : "low",
            qualification_reason: String(v.qualification_reason || "").slice(0, 400),
            problem: String(v.summary || "").slice(0, 300),
            country_signal: String(v.country_signal || "").slice(0, 200),
            intent_score: Math.round(Number(v.intent_score) || 0),
            posted_at: new Date(p.createdMs || Date.now()).toISOString(),
          },
        });
        await logEvent("prospect_found", {
          author: p.author,
          subreddit: p.subreddit,
          url: p.url,
          intent_score: Math.round(Number(v.intent_score) || 0),
          count: leads,
        });
        await progress("qualifying");
      }
    });
    await Promise.all(qualifiers);

    await progress("done");

    const summary = leads
      ? [
          `**Scan complete — ${leads} qualified lead${leads === 1 ? "" : "s"} found.**`,
          "",
          `- ${done}/${streams.length} parallel search streams scanned (${SCANNERS} scanners)`,
          `- ${candidates.length} fresh posts collected from the last ${Math.round(cfg.recencyMinutes / 60)}h`,
          `- ${evaluated} posts evaluated for buying intent`,
          `- ${leads} leads saved and waiting for your approval`,
          "",
          "No message was sent. Open a lead card and hit **Approve & draft reply** when you're ready.",
        ].join("\n")
      : [
          `**Scan complete — no qualified leads this pass.**`,
          "",
          `- Subreddits searched: ${cfg.subreddits.map((s) => `r/${s}`).join(", ")}`,
          `- Keywords searched: ${KEYWORDS.join(", ")}`,
          `- ${candidates.length} fresh posts collected, ${evaluated} evaluated`,
          "",
          "**Why each candidate was rejected:**",
          ...rejections.slice(0, 20).map((r) => `- u/${r.author} in r/${r.subreddit} — ${r.reason} (${r.url})`),
          "",
          "Widen the recency window or add subreddits in Mission settings and scan again.",
        ].join("\n");

    await logEvent("diagnostics", {
      keywords: KEYWORDS,
      subreddits: cfg.subreddits,
      candidates: candidates.length,
      evaluated,
      leads,
      rejections,
    });

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
    await sleep(300);
    await browser?.close().catch(() => {});
  }
}

main();
