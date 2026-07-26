// Playwright worker: exposes a small HTTP API that the Lovable app calls
// from server functions on behalf of Claude's tool use.
//
// Auth: every request must include `Authorization: Bearer <WORKER_TOKEN>`
// where WORKER_TOKEN is a random string set by the Lovable app at deploy time.
//
// Endpoints:
//   GET  /healthz                       -> { ok: true }
//   POST /browse   { url, wait_for?, timeout_ms? }
//                                       -> { url, title, text, screenshot } (screenshot = base64 PNG)
//   POST /extract  { url, selector, attribute?, wait_for?, timeout_ms? }
//                                       -> { items: string[] }
//   POST /screenshot { url, full_page?, wait_for?, timeout_ms? }
//                                       -> { screenshot } (base64 PNG)
//   POST /script   { url, script, wait_for?, timeout_ms? }
//                                       -> { result }   // runs a small JS snippet in page context
//                                       // NOTE: only enabled when WORKER_ALLOW_SCRIPT=true

import express from "express";
import { chromium } from "playwright";

const PORT = process.env.PORT || 10000;
const WORKER_TOKEN = process.env.WORKER_TOKEN;
const ALLOW_SCRIPT = process.env.WORKER_ALLOW_SCRIPT === "true";

if (!WORKER_TOKEN) {
  console.error("FATAL: WORKER_TOKEN env var is required.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// Keep one browser alive across requests for speed.
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

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== WORKER_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
    // Give SPAs a moment.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  }
}

app.post("/browse", requireAuth, async (req, res) => {
  const { url, wait_for, timeout_ms } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });
  try {
    const out = await withPage(async (page) => {
      await gotoAndWait(page, url, { wait_for, timeout_ms });
      const title = await page.title();
      const text = (await page.evaluate(() => document.body?.innerText || "")).slice(0, 12000);
      const shot = await page.screenshot({ type: "png", fullPage: false });
      return { url: page.url(), title, text, screenshot: shot.toString("base64") };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/extract", requireAuth, async (req, res) => {
  const { url, selector, attribute, wait_for, timeout_ms } = req.body || {};
  if (!url || !selector) return res.status(400).json({ error: "url and selector required" });
  try {
    const items = await withPage(async (page) => {
      await gotoAndWait(page, url, { wait_for: wait_for || selector, timeout_ms });
      return await page.$$eval(
        selector,
        (nodes, attr) =>
          nodes.map((n) => (attr ? n.getAttribute(attr) : n.textContent?.trim() || "")).filter(Boolean),
        attribute || null,
      );
    });
    res.json({ items: items.slice(0, 200) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/screenshot", requireAuth, async (req, res) => {
  const { url, full_page, wait_for, timeout_ms } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const shot = await withPage(async (page) => {
      await gotoAndWait(page, url, { wait_for, timeout_ms });
      const buf = await page.screenshot({ type: "png", fullPage: !!full_page });
      return buf.toString("base64");
    });
    res.json({ screenshot: shot });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/script", requireAuth, async (req, res) => {
  if (!ALLOW_SCRIPT) return res.status(403).json({ error: "script execution disabled" });
  const { url, script, wait_for, timeout_ms } = req.body || {};
  if (!url || !script) return res.status(400).json({ error: "url and script required" });
  try {
    const result = await withPage(async (page) => {
      await gotoAndWait(page, url, { wait_for, timeout_ms });
      return await page.evaluate(`(async () => { ${script} })()`);
    });
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Playwright worker listening on :${PORT}`);
});
