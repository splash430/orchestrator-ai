import { chromium } from "playwright";
import fs from "node:fs";

const url = process.env.TARGET_URL || "https://www.reddit.com";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  const title = await page.title();
  await page.screenshot({ path: "selftest.png" });
  const size = fs.statSync("selftest.png").size;
  console.log(
    JSON.stringify({ url, status: res?.status() ?? null, title, screenshotBytes: size }, null, 2),
  );
} finally {
  await browser.close();
}
