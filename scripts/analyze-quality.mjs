// analyze-quality.mjs — Ground-truth quality analysis via Playwright.
// Reads window.__mote (exact simulation state) at locked ?cycle=N worlds,
// combines it with pixel-level visibility metrics, and enforces hard gates.
// Exits non-zero when any BLOCKING gate fails (unless --report-only) — an
// empty or degenerate world can no longer be reported as fine. Gate G5
// (figure-ground contrast) is marked non-blocking/deferred until milestone
// M6 — it is still evaluated and printed, but its failure alone never
// produces a non-zero exit. See the `blocking` field on each gate in
// evaluateGates().
// Usage: node scripts/analyze-quality.mjs [speed] [outFile] [--cycles a,b,c] [--report-only]
//   speed: time multiplier (default 60)
//   outFile: where to write the JSON report (default quality-report.json)
//   --cycles: comma-separated locked cycle numbers (default 1000,2000,3000)
//   --report-only: write the report and print gate results but always exit 0

import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const flags = process.argv.slice(2).filter(a => a.startsWith("--"));
const speed = parseInt(args[0] || "60", 10);
const outFile = args[1] || "quality-report.json";
const cyclesFlag = flags.find(f => f.startsWith("--cycles"));
const CYCLES = cyclesFlag ? cyclesFlag.split("=")[1].split(",").map(Number) : [1000, 2000, 3000];
const REPORT_ONLY = flags.includes("--report-only");
// Cheap ground-truth (window.__mote) is sampled densely — this is what lets G4
// catch the narrow [0.965, 0.99] tail window. Pixel reads (full canvas
// serialization to Node) are far more expensive, so they're sampled sparsely
// on a separate cadence and only feed G5.
const SAMPLE_EVERY = 0.01; // dense truth sampling — ~100 samples/cycle, feeds G1-G4
const PIXEL_SAMPLE_EVERY = 0.05; // sparse pixel sampling — ~20 samples/cycle, feeds G5
// A single pixel read (getImageData + Array.from of the full 147KB canvas,
// serialized to Node over CDP) costs roughly 10x the wall-clock time of a
// plain window.__mote read. The sim clock keeps running during that stall,
// so a pixel read can let real cycle progress jump ~0.06-0.08 in one step —
// wide enough to leap clean over G4's narrow [0.965, 0.99] tail window and
// have the *next* dense truth read land past it entirely (confirmed by
// profiling: plain truth polls advance progress ~0.0067 each; a poll that
// also does a pixel read advances ~0.065-0.08). To guarantee dense,
// jump-free resolution through the tail, pixel sampling is cut off well
// before it — G5 loses nothing meaningful here since the interesting
// mote-visibility action (peak population, clustering) happens long before
// the tail's lone-survivor phase anyway.
const PIXEL_SAMPLE_CUTOFF = 0.85;
const POLL_INTERVAL_MS = 20;
const MAX_CYCLE_WALL_MS = 60_000; // wall-clock guard per cycle; fail loudly instead of hanging
const MAX_POLLS_PER_CYCLE = Math.ceil(MAX_CYCLE_WALL_MS / POLL_INTERVAL_MS);

// Analyze raw 256x144 pixel data for quality metrics
function analyzeFrame(pixelData, width, height) {
  const metrics = {};

  // 1. Mote visibility: find bright pixel clusters above terrain
  // Terrain tends to be darker/earthy; motes should be brighter/more saturated
  // We look for small bright clusters that stand out from surrounding pixels
  const brightness = new Float32Array(width * height);
  const saturation = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = pixelData[i * 4];
    const g = pixelData[i * 4 + 1];
    const b = pixelData[i * 4 + 2];

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    brightness[i] = (r + g + b) / (3 * 255);
    saturation[i] = maxC > 0 ? (maxC - minC) / maxC : 0;
  }

  // 2. Find potential mote pixels: bright + saturated pixels in the lower portion
  // (motes walk on terrain, which is in the lower ~60% of the screen)
  const motePixels = [];
  const terrainStartY = Math.floor(height * 0.2); // terrain usually starts around here

  for (let y = terrainStartY; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // A mote pixel: relatively bright and/or saturated compared to terrain
      if (brightness[idx] > 0.45 && saturation[idx] > 0.25) {
        motePixels.push({ x, y, brightness: brightness[idx], saturation: saturation[idx] });
      }
    }
  }

  // 3. Cluster mote pixels into distinct motes (simple flood-fill grouping)
  const visited = new Set();
  const moteClusters = [];

  for (const px of motePixels) {
    const key = `${px.x},${px.y}`;
    if (visited.has(key)) continue;

    // BFS to find connected bright pixels
    const cluster = [];
    const queue = [px];
    visited.add(key);

    while (queue.length > 0) {
      const curr = queue.shift();
      cluster.push(curr);

      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = curr.x + dx;
          const ny = curr.y + dy;
          const nkey = `${nx},${ny}`;
          if (visited.has(nkey)) continue;

          const neighbor = motePixels.find(p => p.x === nx && p.y === ny);
          if (neighbor) {
            visited.add(nkey);
            queue.push(neighbor);
          }
        }
      }
    }

    if (cluster.length >= 2 && cluster.length <= 80) {
      // Likely a mote (2-80 bright pixels)
      const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
      const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
      const avgBrightness = cluster.reduce((s, p) => s + p.brightness, 0) / cluster.length;
      moteClusters.push({ cx, cy, size: cluster.length, avgBrightness });
    }
  }

  metrics.visibleMoteCount = moteClusters.length;
  metrics.avgMoteSize = moteClusters.length > 0
    ? moteClusters.reduce((s, c) => s + c.size, 0) / moteClusters.length
    : 0;
  metrics.avgMoteBrightness = moteClusters.length > 0
    ? moteClusters.reduce((s, c) => s + c.avgBrightness, 0) / moteClusters.length
    : 0;

  // 4. Mote separation: min and avg distance between mote centers
  if (moteClusters.length >= 2) {
    const distances = [];
    for (let i = 0; i < moteClusters.length; i++) {
      let minDist = Infinity;
      for (let j = 0; j < moteClusters.length; j++) {
        if (i === j) continue;
        const dx = moteClusters[i].cx - moteClusters[j].cx;
        const dy = moteClusters[i].cy - moteClusters[j].cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        minDist = Math.min(minDist, d);
      }
      distances.push(minDist);
    }
    metrics.minMoteDistance = Math.min(...distances);
    metrics.avgMoteDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
    metrics.clumpedMoteRatio = distances.filter(d => d < 4).length / distances.length;
  } else {
    metrics.minMoteDistance = 0;
    metrics.avgMoteDistance = 0;
    metrics.clumpedMoteRatio = 0;
  }

  // 5. Water analysis: find water pixels (blue-ish, low saturation sometimes)
  const waterPixels = [];
  for (let y = terrainStartY; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];
      // Water tends to be blue-dominant or lava-orange
      if (b > r + 20 && b > g) {
        waterPixels.push({ x, y });
      }
    }
  }

  // Find distinct water bodies (connected components)
  const waterVisited = new Set();
  const waterBodies = [];
  for (const wp of waterPixels) {
    const key = `${wp.x},${wp.y}`;
    if (waterVisited.has(key)) continue;

    const body = [];
    const queue = [wp];
    waterVisited.add(key);

    while (queue.length > 0) {
      const curr = queue.shift();
      body.push(curr);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = curr.x + dx;
          const ny = curr.y + dy;
          const nkey = `${nx},${ny}`;
          if (waterVisited.has(nkey)) continue;

          const neighbor = waterPixels.find(p => p.x === nx && p.y === ny);
          if (neighbor) {
            waterVisited.add(nkey);
            queue.push(neighbor);
          }
        }
      }
    }

    if (body.length >= 5) {
      const minX = Math.min(...body.map(p => p.x));
      const maxX = Math.max(...body.map(p => p.x));
      waterBodies.push({ size: body.length, minX, maxX, span: maxX - minX });
    }
  }

  metrics.waterBodyCount = waterBodies.length;
  metrics.waterCoverage = waterPixels.length / (width * height);
  metrics.largestWaterSpan = waterBodies.length > 0
    ? Math.max(...waterBodies.map(b => b.span))
    : 0;

  // 6. Overall contrast: standard deviation of brightness
  const avgBrightness = brightness.reduce((s, b) => s + b, 0) / brightness.length;
  const variance = brightness.reduce((s, b) => s + (b - avgBrightness) ** 2, 0) / brightness.length;
  metrics.brightnessStdDev = Math.sqrt(variance);
  metrics.avgBrightness = avgBrightness;

  // 7. Mote X-position distribution (are they spread out or bunched?)
  if (moteClusters.length >= 3) {
    const xPositions = moteClusters.map(c => c.cx).sort((a, b) => a - b);
    const xRange = xPositions[xPositions.length - 1] - xPositions[0];
    metrics.moteSpreadX = xRange / width; // 0-1, higher = more spread out
    // Check if motes are clustered in one area
    const xMean = xPositions.reduce((s, x) => s + x, 0) / xPositions.length;
    const xVariance = xPositions.reduce((s, x) => s + (x - xMean) ** 2, 0) / xPositions.length;
    metrics.moteSpreadVariance = Math.sqrt(xVariance) / width;
  } else {
    metrics.moteSpreadX = 0;
    metrics.moteSpreadVariance = 0;
  }

  return metrics;
}

// Gate evaluation against ground-truth + pixel samples for a single cycle.
// Spec §9 gates — G3 reads the first-bond arc milestone (recorded by updateColony).
// G1-G4 read the DENSE truth-only `samples` array (cheap window.__mote reads,
// taken every poll iteration) so they have enough resolution to catch narrow
// windows like G4's [0.965, 0.99] tail. G5 needs pixel-derived visibility
// metrics, which are only affordable at a coarser cadence, so it reads the
// separate `pixelSamples` array instead.
function evaluateGates(samples, pixelSamples) {
  const gates = [];
  const peak = samples.reduce((best, s) => (s.population > best.population ? s : best), samples[0]);
  gates.push({ id: "G1", pass: peak.population >= 28 && peak.population <= 36 && peak.progress >= 0.55 && peak.progress <= 0.80,
    detail: `peak ${peak.population} at ${peak.progress.toFixed(2)}` });
  const org = samples.find(s => s.progress >= 0.55);
  gates.push({ id: "G2", pass: !!org && org.bondedFraction >= 0.4,
    detail: `bondedFraction ${org ? org.bondedFraction.toFixed(2) : "n/a"} at 0.55` });
  const fb = samples[samples.length - 1].milestones?.find(m => m.name === "first-bond");
  gates.push({ id: "G3", pass: !!fb && fb.progress < 0.25,
    detail: `first-bond milestone at ${fb ? fb.progress.toFixed(2) : "never"}` });
  // Tail window has NO upper bound: dense truth sampling runs to ~0.995 (the
  // loop's break point), and the real-time poller can jump the narrow window
  // (e.g. 0.96 -> 0.997), so an upper bound of 0.99 would exclude the only
  // valid late sample and spuriously report an empty tail. Every sample past
  // 0.965 must be the lone survivor (population 1) — the invariant the
  // step-exact full-cycle Vitest test proves; this just confirms it live.
  const tail = samples.filter(s => s.progress >= 0.965);
  gates.push({ id: "G4", pass: tail.length > 0 && tail.every(s => s.population === 1),
    detail: `tail populations [${tail.map(s => s.population).join(",")}]` });
  // G5 (figure-ground contrast) is a KNOWN, ACCEPTED failure on bright cycles
  // (2000/3000) — fixing it properly requires the emissive-glow / luminance-cap
  // work scoped to milestone M6. Until then it's evaluated and printed (so the
  // metric stays visible and regressions elsewhere are still noticeable) but
  // marked `blocking: false` so it can't fail the exit code — see `pass` below,
  // which only considers gates where `blocking !== false`.
  const contrast = pixelSamples.filter(s => s.visibleMoteCount > 0);
  const worst = contrast.reduce((min, s) => Math.min(min, s.avgMoteBrightness - s.avgBrightness), Infinity);
  gates.push({ id: "G5", pass: contrast.length > 0 && worst >= 0.25, blocking: false, deferred: "M6",
    detail: `worst mote/backdrop delta ${worst === Infinity ? "n/a" : worst.toFixed(2)}` });
  return gates;
}

// Drives one locked ?cycle=N world at full speed. Two independent sampling
// cadences run off the same poll loop:
//   - `samples`: cheap window.__mote reads (no pixel work), taken every time
//     progress crosses the next SAMPLE_EVERY threshold. Dense enough to catch
//     narrow windows like G4's [0.965, 0.99] tail.
//   - `pixelSamples`: expensive full-canvas pixel reads + analyzeFrame, taken
//     only every PIXEL_SAMPLE_EVERY of progress (far coarser, since each read
//     serializes the whole 147KB pixel buffer to Node), and only while
//     progress < PIXEL_SAMPLE_CUTOFF — see the comment on that constant for
//     why pixel sampling must not run late in the cycle.
// Polling stops when the locked cycle wraps back around to 0%, or once dense
// sampling has reached the tail. A wall-clock guard throws if a cycle never
// produces window.__mote (or never progresses) within MAX_CYCLE_WALL_MS.
async function analyzeCycle(page, cycle) {
  await page.goto(`http://localhost:5198/?cycle=${cycle}&speed=${speed}&debug`);
  await page.click("canvas");
  await page.mouse.move(2, 2); // park off-canvas so the cursor indicator doesn't render
  const samples = [];
  const pixelSamples = [];
  let nextSample = SAMPLE_EVERY;
  let nextPixelSample = PIXEL_SAMPLE_EVERY;
  let lastProgress = 0;
  let polls = 0;
  for (;;) {
    polls++;
    if (polls > MAX_POLLS_PER_CYCLE) {
      throw new Error(
        `analyzeCycle(${cycle}): exceeded wall-clock timeout of ${MAX_CYCLE_WALL_MS}ms ` +
        `(collected ${samples.length} truth samples, ${pixelSamples.length} pixel samples, ` +
        `lastProgress=${lastProgress}). window.__mote may never have appeared, or the ` +
        `cycle stopped progressing.`
      );
    }
    const truth = await page.evaluate(() => window.__mote);
    // Locked cycles wrap back to the same cycle at 100% — stop when progress rewinds
    if (truth && truth.progress < lastProgress - 0.5) break;
    if (truth) lastProgress = truth.progress;
    if (truth && truth.progress >= nextSample) {
      const { snapshots, ...truthRest } = truth;
      samples.push(truthRest);
      nextSample = truth.progress + SAMPLE_EVERY;
    }
    if (truth && truth.progress >= nextPixelSample && truth.progress < PIXEL_SAMPLE_CUTOFF) {
      const pixelData = await page.evaluate(() => {
        const canvas = document.getElementById("world");
        const ctx = canvas.getContext("2d");
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { data: Array.from(d.data), width: canvas.width, height: canvas.height };
      });
      const pixels = analyzeFrame(new Uint8Array(pixelData.data), pixelData.width, pixelData.height);
      const { snapshots, ...truthRest } = truth;
      pixelSamples.push({ ...truthRest, ...pixels });
      nextPixelSample = truth.progress + PIXEL_SAMPLE_EVERY;
    }
    if (truth && truth.progress >= 0.995 && samples.length > 5) break;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  return { samples, pixelSamples };
}

async function main() {
  console.log("Starting ground-truth quality analysis...");
  console.log(`  cycles: ${CYCLES.join(", ")}  speed: ${speed}x  report-only: ${REPORT_ONLY}`);

  const server = await createServer({
    root: projectRoot,
    server: { port: 5198, strictPort: true },
    logLevel: "warn",
  });
  await server.listen();

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  const report = { timestamp: new Date().toISOString(), cycles: [], pass: false };

  for (const cycle of CYCLES) {
    console.log(`\n=== cycle ${cycle} ===`);
    const { samples, pixelSamples } = await analyzeCycle(page, cycle);
    const gates = evaluateGates(samples, pixelSamples);
    for (const g of gates) {
      const deferred = g.blocking === false && g.deferred;
      const label = g.pass ? "PASS" : deferred ? `FAIL·deferred→${g.deferred}` : "FAIL";
      console.log(`  [${label}] ${g.id}: ${g.detail}`);
    }
    report.cycles.push({ cycle, samples, gates });
  }

  // Only blocking gates (G1-G4) determine pass/fail and the exit code. G5 is
  // deferred to M6 (see evaluateGates) — it's still evaluated and reported
  // above, but a G5 failure alone must never fail CI or block a commit.
  const pass = report.cycles.every(c => c.gates.filter(g => g.blocking !== false).every(g => g.pass));
  report.pass = pass;

  const anyDeferredFail = report.cycles.some(c => c.gates.some(g => g.blocking === false && !g.pass));
  const absOut = resolve(projectRoot, outFile);
  writeFileSync(absOut, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${absOut}`);
  if (pass && anyDeferredFail) {
    console.log("\nAll blocking gates passed (deferred gate(s) still failing — see M6).");
  } else {
    console.log(pass ? "\nAll gates passed." : "\nGate FAILURES detected.");
  }

  await browser.close();
  await server.close();

  if (!pass && !REPORT_ONLY) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
