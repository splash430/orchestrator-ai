// Server-only Apify + AI helpers. Never import this from a component.
import type { SupabaseClient } from "@supabase/supabase-js";

const GATEWAY = "https://connector-gateway.lovable.dev/apify";

export const REDDIT_ACTOR = "trudax~reddit-scraper-lite";
export const WEBSITE_ACTOR = "apify~website-content-crawler";

export type ScanSource = "reddit" | "website";

function keys() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const apify = process.env["APIFY_API_KEY"];
  if (!lovable) throw new Error("LOVABLE_API_KEY is not configured");
  if (!apify) throw new Error("Apify is not connected to this project");
  return { lovable, apify };
}

export async function apify(path: string, init?: RequestInit) {
  const { lovable, apify: connectionKey } = keys();
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": connectionKey,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Apify ${path} failed [${response.status}]: ${body}`);
    throw new Error(`Apify request failed [${response.status}]: ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<{ data: Record<string, unknown> }>;
}

/** Apify's `time` filter is coarse — map the user's minute window onto it. */
export function timeWindow(minutes: number) {
  if (minutes <= 60) return "hour";
  if (minutes <= 1440) return "day";
  return "week";
}

export function redditActorInput(config: {
  reddit_urls: string[];
  keywords: string[];
  post_limit: number;
  sort_order: string;
  recency_minutes: number;
}) {
  return {
    startUrls: config.reddit_urls.map((url) => ({ url, method: "GET" })),
    searches: config.keywords.slice(0, 10),
    searchPosts: true,
    searchComments: false,
    searchCommunities: false,
    searchUsers: false,
    skipComments: false,
    skipUserPosts: true,
    sort: config.sort_order,
    time: timeWindow(config.recency_minutes),
    maxItems: config.post_limit,
    maxPostCount: config.post_limit,
    maxComments: 5,
    debugMode: false,
  };
}

export function websiteActorInput(config: { websites: string[]; max_pages: number }) {
  return {
    startUrls: config.websites.map((url) => ({ url })),
    crawlerType: "cheerio",
    maxCrawlPages: config.max_pages,
    maxCrawlDepth: 1,
    saveMarkdown: false,
    proxyConfiguration: { useApifyProxy: true },
  };
}

export async function startActorRun(actorId: string, input: unknown) {
  const { data } = await apify(`/acts/${actorId}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    runId: String(data["id"]),
    datasetId: String(data["defaultDatasetId"] ?? ""),
    status: String(data["status"] ?? "READY"),
  };
}

export async function getActorRun(runId: string) {
  const { data } = await apify(`/actor-runs/${runId}`);
  return {
    status: String(data["status"] ?? "UNKNOWN"),
    datasetId: String(data["defaultDatasetId"] ?? ""),
    startedAt: data["startedAt"] as string | undefined,
    finishedAt: data["finishedAt"] as string | undefined,
    statusMessage: (data["statusMessage"] as string | undefined) ?? null,
  };
}

export async function getDatasetItems(datasetId: string, limit = 200) {
  const { lovable, apify: connectionKey } = keys();
  const response = await fetch(`${GATEWAY}/datasets/${datasetId}/items?clean=true&limit=${limit}`, {
    headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": connectionKey },
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Apify dataset read failed [${response.status}]: ${body}`);
    throw new Error(`Apify dataset read failed [${response.status}]`);
  }
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

// ---------------------------------------------------------------- AI scoring

export type Qualification = {
  score: number;
  intent: "HIGH" | "MEDIUM" | "LOW";
  problem: string;
  summary: string;
  recommended_solution: string;
  suggested_offer: string;
  location: string;
  qualification_reason: string;
  rejected: boolean;
};

const SCORING_SYSTEM = `You qualify buyer intent for a business-automation / AI-tools vendor.

For every item decide whether the author is a potential BUYER of automation, AI tools, SaaS, business software or automation services.

Score 0-100:
- 80-100 HIGH: actively looking to buy, hire, or get a tool/software recommendation.
- 50-79 MEDIUM: clear pain (manual work, wasted hours, bad system) but not shopping yet.
- 0-49 LOW: general discussion, news, tutorials, opinions, not a buyer.

Location: infer the author's country/city ONLY from explicit evidence in the text (city, province, ".ca" domain, "here in Canada"). Otherwise return "unknown".

Reject (rejected=true) when: score < 50, it is news/tutorial/opinion, or there is no solvable business problem.

Return STRICT JSON: {"results":[{"index":0,"score":0,"intent":"LOW","problem":"","summary":"","recommended_solution":"","suggested_offer":"","location":"","qualification_reason":"","rejected":true}]}
One result per input item, same index. Keep every string under 300 characters and factual — never invent details that are not in the item.`;

async function ai(system: string, user: string) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": key },
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
  const raw = await response.text();
  if (!response.ok) {
    console.error(`AI gateway failed [${response.status}]: ${raw}`);
    if (response.status === 402) throw new Error("AI credits are exhausted");
    if (response.status === 429) throw new Error("AI is busy; try again shortly");
    throw new Error(`AI request failed [${response.status}]`);
  }
  const content = String(JSON.parse(raw).choices?.[0]?.message?.content ?? "{}");
  return JSON.parse(content) as Record<string, unknown>;
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Qualifies a batch of scraped items in a single AI call. */
export async function qualifyBatch(
  items: { title: string; body: string; author: string; context: string }[],
  profile: { product_name: string; audience: string; country: string; specifications: string },
): Promise<Qualification[]> {
  const user = [
    `Vendor product: ${profile.product_name}`,
    `Ideal customer: ${profile.audience}`,
    `Preferred country: ${profile.country} (do not fabricate location evidence)`,
    profile.specifications ? `Notes: ${profile.specifications}` : "",
    "",
    ...items.map((item, index) =>
      [
        `--- item ${index} ---`,
        `author: ${item.author}`,
        `context: ${item.context}`,
        `title: ${item.title}`,
        `body: ${item.body.slice(0, 2500)}`,
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await ai(SCORING_SYSTEM, user);
  const results = Array.isArray(parsed["results"]) ? (parsed["results"] as Record<string, unknown>[]) : [];

  return items.map((_, index) => {
    const row = results.find((r) => Number(r["index"]) === index) ?? results[index] ?? {};
    const score = clampScore(row["score"]);
    const intent = score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";
    return {
      score,
      intent,
      problem: String(row["problem"] ?? ""),
      summary: String(row["summary"] ?? ""),
      recommended_solution: String(row["recommended_solution"] ?? ""),
      suggested_offer: String(row["suggested_offer"] ?? ""),
      location: String(row["location"] ?? "unknown"),
      qualification_reason: String(row["qualification_reason"] ?? ""),
      rejected: row["rejected"] === true || score < 50,
    };
  });
}

// ------------------------------------------------------------- normalisation

export type RedditItem = {
  url: string;
  title: string;
  body: string;
  author: string;
  subreddit: string;
  postedAt: string | null;
  upvotes: number;
  comments: unknown[];
  engagement: Record<string, unknown>;
};

function firstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizeRedditItem(row: Record<string, unknown>): RedditItem | null {
  const url = firstString(row, ["url", "postUrl", "link", "permalink"]);
  if (!url || !/reddit\.com/i.test(url)) return null;
  const upvotes = Number(row["upVotes"] ?? row["upvotes"] ?? row["score"] ?? 0) || 0;
  const numberOfComments = Number(row["numberOfComments"] ?? row["numComments"] ?? 0) || 0;
  return {
    url,
    title: firstString(row, ["title", "postTitle"]),
    body: firstString(row, ["body", "text", "selftext", "description", "content"]),
    author: firstString(row, ["username", "author", "userName"]).replace(/^u\//, ""),
    subreddit: firstString(row, ["communityName", "subreddit", "parsedCommunityName"]).replace(/^r\//, ""),
    postedAt: firstString(row, ["createdAt", "created_at", "postedAt", "date"]) || null,
    upvotes,
    comments: Array.isArray(row["comments"]) ? (row["comments"] as unknown[]).slice(0, 5) : [],
    engagement: { upvotes, comments: numberOfComments },
  };
}

export type WebsiteItem = {
  website: string;
  company_name: string;
  text: string;
  emails: string[];
  phones: string[];
};

export function normalizeWebsiteItem(row: Record<string, unknown>): WebsiteItem | null {
  const website = firstString(row, ["url", "loadedUrl"]);
  if (!website) return null;
  const metadata = (row["metadata"] as Record<string, unknown> | undefined) ?? {};
  const text = firstString(row, ["text", "markdown", "content"]).slice(0, 6000);
  const emails = Array.from(
    new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) ?? []).map((value) => value.toLowerCase())),
  ).slice(0, 3);
  const phones = Array.from(
    new Set(text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? []),
  ).slice(0, 3);
  return {
    website,
    company_name: firstString(metadata as Record<string, unknown>, ["title"]) || new URL(website).hostname,
    text,
    emails,
    phones,
  };
}

/**
 * Pulls a finished Apify dataset, qualifies it with Lovable AI and writes
 * opportunities / website leads. Returns how many rows were created.
 */
export async function ingestDataset(
  supabase: SupabaseClient,
  job: { id: string; user_id: string; source: ScanSource; dataset_id: string; config: Record<string, unknown> },
  profile: { product_name: string; audience: string; country: string; specifications: string },
) {
  const rows = await getDatasetItems(job.dataset_id, Number(job.config["post_limit"] ?? 100));
  let created = 0;

  if (job.source === "reddit") {
    const items = rows.map(normalizeRedditItem).filter((item): item is RedditItem => item !== null);
    for (let i = 0; i < items.length; i += 6) {
      const batch = items.slice(i, i + 6);
      const verdicts = await qualifyBatch(
        batch.map((item) => ({
          title: item.title,
          body: item.body,
          author: item.author,
          context: `reddit r/${item.subreddit}`,
        })),
        profile,
      );
      const payload = batch.map((item, index) => {
        const verdict = verdicts[index]!;
        return {
          user_id: job.user_id,
          scan_job_id: job.id,
          source: "reddit",
          platform: "reddit",
          post_url: item.url,
          author: item.author,
          subreddit: item.subreddit,
          title: item.title,
          excerpt: item.body.slice(0, 1200),
          post_content: item.body,
          comments: item.comments as never,
          engagement: item.engagement as never,
          posted_at: item.postedAt,
          problem: verdict.problem,
          summary: verdict.summary,
          ai_summary: verdict.summary,
          recommended_solution: verdict.recommended_solution,
          suggested_offer: verdict.suggested_offer,
          location: verdict.location,
          country_signal: verdict.location,
          intent_score: verdict.score,
          intent_level: verdict.intent,
          qualification_reason: verdict.qualification_reason,
          rejected: verdict.rejected,
          rejection_reason: verdict.rejected ? verdict.qualification_reason : null,
          status: verdict.rejected ? "rejected" : "qualified",
        };
      });
      const { error } = await supabase.from("prospects").insert(payload as never);
      if (error) console.error(`prospect insert failed: ${error.message}`);
      else created += payload.filter((row) => !row.rejected).length;
    }
    return { collected: items.length, created };
  }

  const items = rows.map(normalizeWebsiteItem).filter((item): item is WebsiteItem => item !== null);
  for (let i = 0; i < items.length; i += 6) {
    const batch = items.slice(i, i + 6);
    const verdicts = await qualifyBatch(
      batch.map((item) => ({
        title: item.company_name,
        body: item.text,
        author: item.company_name,
        context: `website ${item.website}`,
      })),
      profile,
    );
    const payload = batch.map((item, index) => {
      const verdict = verdicts[index]!;
      return {
        user_id: job.user_id,
        scan_job_id: job.id,
        company_name: item.company_name,
        website: item.website,
        contact_page: /contact/i.test(item.website) ? item.website : null,
        email: item.emails[0] ?? null,
        phone: item.phones[0] ?? null,
        location: verdict.location,
        excerpt: item.text.slice(0, 1200),
        score: verdict.score,
        intent_level: verdict.intent,
        problem: verdict.problem,
        ai_summary: verdict.summary,
        recommended_solution: verdict.recommended_solution,
        suggested_offer: verdict.suggested_offer,
        status: verdict.rejected ? "archived" : "new",
      };
    });
    const { error } = await supabase
      .from("website_leads")
      .upsert(payload as never, { onConflict: "user_id,website" });
    if (error) console.error(`website lead upsert failed: ${error.message}`);
    else created += payload.filter((row) => row.status === "new").length;
  }
  return { collected: items.length, created };
}
