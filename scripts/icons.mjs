import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const browser = await chromium.launch({ executablePath: process.env.WAKU_CHROMIUM || chromium.executablePath(), headless: true });
try {
  const svg = await readFile(new URL("../extension/assets/icon.svg", import.meta.url), "utf8");
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../extension/assets/icon${size}.png`, import.meta.url)), omitBackground: true });
  }
} finally { await browser.close(); }
