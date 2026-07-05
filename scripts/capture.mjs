// capture.mjs — Observation tool: captures screenshots across an accelerated cycle.
// Usage: node scripts/capture.mjs [speed] [output-dir] [cycle]
//   speed: time multiplier (default 60 = 5-min cycle in 5s)
//   output-dir: where to save PNGs (default captures/)
//   cycle: optional cycle number override (?cycle=N)
//
// Starts a Vite dev server, opens the world at ?speed=N&debug,
// takes a screenshot at each phase transition + some intermediate points.

import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const speed = parseInt(process.argv[2] || "60", 10);
const outDir = process.argv[3] || "captures";
const cycleOverride = process.argv[4] ? parseInt(process.argv[4], 10) : null;

// Phase boundaries (cumulative fractions)
const PHASES = ["genesis", "exploration", "organization", "complexity", "dissolution", "silence"];
const PHASE_BOUNDARIES = [0.10, 0.30, 0.55, 0.80, 0.92, 1.0];

// Capture points: start of each phase + midpoints
const CAPTURE_POINTS = [];
let prev = 0;
for (let i = 0; i < PHASES.length; i++) {
  CAPTURE_POINTS.push({ name: `${PHASES[i]}-start`, progress: prev + 0.001 });
  CAPTURE_POINTS.push({ name: `${PHASES[i]}-mid`, progress: (prev + PHASE_BOUNDARIES[i]) / 2 });
  prev = PHASE_BOUNDARIES[i];
}

const CYCLE_DURATION = 300; // seconds
const effectiveCycleDuration = CYCLE_DURATION / speed;

/** Save the canvas at its native 256x144 resolution as a PNG */
async function saveCanvasNative(page, filepath) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.getElementById("world");
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  });
  if (dataUrl) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const { writeFileSync } = await import("fs");
    writeFileSync(filepath, Buffer.from(base64, "base64"));
  }
}

async function main() {
  const absOut = resolve(projectRoot, outDir);
  if (!existsSync(absOut)) mkdirSync(absOut, { recursive: true });

  console.log(`Starting Vite dev server...`);
  const server = await createServer({
    root: projectRoot,
    server: { port: 5199, strictPort: true },
    logLevel: "warn",
  });
  await server.listen();
  console.log(`Dev server on http://localhost:5199`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  const url = `http://localhost:5199/?speed=${speed}&debug${cycleOverride !== null ? `&cycle=${cycleOverride}` : ""}`;
  console.log(`Loading ${url}`);
  await page.goto(url);

  // Click to init audio (dismissed quickly)
  await page.click("canvas");
  await page.mouse.move(2, 2); // park off-canvas so the cursor indicator doesn't render
  console.log(`Capturing ${CAPTURE_POINTS.length} frames across one cycle (~${Math.round(effectiveCycleDuration)}s real time)...`);

  // Wait for initial render
  await page.waitForTimeout(500);

  // Take an initial screenshot (both full viewport and native canvas resolution)
  await page.screenshot({ path: resolve(absOut, `00-initial.png`) });
  await saveCanvasNative(page, resolve(absOut, `00-initial-native.png`));
  console.log(`  00-initial.png (+ native)`);

  // Capture on ACTUAL cycle progress (window.__mote.progress from ?debug),
  // not wall-clock timing. The fixed-timestep sim advances at speed×realtime,
  // but the live world loads mid-cycle (catch-up) and screenshot latency
  // drifts wall-clock estimates late — both broke the old timing model, so we
  // poll the real progress instead. First wait for a fresh cycle start so the
  // phase frames line up (a locked ?cycle already starts at 0).
  const startReal = Date.now();
  for (let i = 0; i < 500; i++) {
    const t = await page.evaluate(() => window.__mote);
    if (t && t.progress < 0.02) break; // at/near the start of a cycle
    await page.waitForTimeout(30);
    if (Date.now() - startReal > effectiveCycleDuration * 2000 + 15000) break;
  }

  let captureIndex = 0;
  let sawProgress = false;
  while (captureIndex < CAPTURE_POINTS.length) {
    const point = CAPTURE_POINTS[captureIndex];
    const truth = await page.evaluate(() => window.__mote);
    const progress = truth ? truth.progress : 0;
    // If the cycle already wrapped past the remaining points, stop.
    if (sawProgress && progress < 0.02 && captureIndex > 0) break;
    if (truth && progress > 0.001) sawProgress = true;

    if (truth && progress >= point.progress) {
      const filename = `${String(captureIndex + 1).padStart(2, "0")}-${point.name}.png`;
      const nativeFilename = `${String(captureIndex + 1).padStart(2, "0")}-${point.name}-native.png`;
      await page.screenshot({ path: resolve(absOut, filename) });
      await saveCanvasNative(page, resolve(absOut, nativeFilename));
      console.log(`  ${filename} (+ native, progress ~${(progress * 100).toFixed(1)}%)`);
      captureIndex++;
    } else {
      await page.waitForTimeout(30);
    }

    // Safety: don't run longer than ~4 full cycles of real time
    if (Date.now() - startReal > effectiveCycleDuration * 4000 + 15000) {
      console.log(`Timeout — captured ${captureIndex} of ${CAPTURE_POINTS.length} frames`);
      break;
    }
  }

  // Final full-cycle screenshot
  await page.screenshot({ path: resolve(absOut, `99-final.png`) });
  await saveCanvasNative(page, resolve(absOut, `99-final-native.png`));
  console.log(`  99-final.png (+ native)`);

  console.log(`\nDone! ${captureIndex + 2} screenshots saved to ${absOut}`);

  await browser.close();
  await server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
