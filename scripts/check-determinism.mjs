// check-determinism.mjs — same cycle at two speeds must produce identical timelines.
// The fixed-timestep sim makes this exact; any divergence is a determinism bug.
// Usage: node scripts/check-determinism.mjs [cycle]
import { chromium } from "playwright";
import { createServer } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cycle = parseInt(process.argv[2] || "1234", 10);

async function runOnce(page, speed) {
  await page.goto(`http://localhost:5196/?cycle=${cycle}&speed=${speed}&debug`);
  await page.click("canvas");
  await page.mouse.move(2, 2);
  for (;;) {
    const t = await page.evaluate(() => window.__mote);
    if (t && t.snapshots.length >= 9) return t.snapshots;
    await page.waitForTimeout(50);
  }
}

const server = await createServer({ root: projectRoot, server: { port: 5196, strictPort: true }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
const a = await runOnce(page, 40);
const b = await runOnce(page, 80);
await browser.close();
await server.close();

const sa = JSON.stringify(a), sb = JSON.stringify(b);
if (sa !== sb) {
  console.error("DETERMINISM FAILURE for cycle", cycle);
  console.error("speed 40:", sa);
  console.error("speed 80:", sb);
  process.exit(1);
}
console.log(`Determinism OK for cycle ${cycle}: ${a.length} decile snapshots identical across speeds 40/80.`);
