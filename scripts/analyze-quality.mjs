// analyze-quality.mjs — Ground-truth quality analysis via Playwright.
// Reads window.__mote (exact simulation state) at locked ?cycle=N worlds,
// combines it with pixel-level visibility metrics, and enforces hard gates.
// Exits non-zero when any gate fails (unless --report-only) — an empty or
// degenerate world can no longer be reported as fine.
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
const SAMPLE_EVERY = 0.02; // 50 samples per cycle

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
function evaluateGates(samples) {
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
  const tail = samples.filter(s => s.progress >= 0.965 && s.progress <= 0.99);
  gates.push({ id: "G4", pass: tail.length > 0 && tail.every(s => s.population === 1),
    detail: `tail populations [${tail.map(s => s.population).join(",")}]` });
  const contrast = samples.filter(s => s.visibleMoteCount > 0);
  const worst = contrast.reduce((min, s) => Math.min(min, s.avgMoteBrightness - s.avgBrightness), Infinity);
  gates.push({ id: "G5", pass: contrast.length > 0 && worst >= 0.25,
    detail: `worst mote/backdrop delta ${worst === Infinity ? "n/a" : worst.toFixed(2)}` });
  return gates;
}

// Drives one locked ?cycle=N world at full speed, sampling ground truth
// (window.__mote) plus pixel-derived visibility metrics every SAMPLE_EVERY
// of cycle progress, until the locked cycle wraps back around to 0%.
async function analyzeCycle(page, cycle) {
  await page.goto(`http://localhost:5198/?cycle=${cycle}&speed=${speed}&debug`);
  await page.click("canvas");
  await page.mouse.move(2, 2); // park off-canvas so the cursor indicator doesn't render
  const samples = [];
  let nextSample = 0.01;
  let lastProgress = 0;
  for (;;) {
    const truth = await page.evaluate(() => window.__mote);
    // Locked cycles wrap back to the same cycle at 100% — stop when progress rewinds
    if (truth && truth.progress < lastProgress - 0.5) break;
    if (truth) lastProgress = truth.progress;
    if (truth && truth.progress >= nextSample) {
      const pixelData = await page.evaluate(() => {
        const canvas = document.getElementById("world");
        const ctx = canvas.getContext("2d");
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { data: Array.from(d.data), width: canvas.width, height: canvas.height };
      });
      const pixels = analyzeFrame(new Uint8Array(pixelData.data), pixelData.width, pixelData.height);
      const { snapshots, ...truthRest } = truth;
      samples.push({ ...truthRest, ...pixels });
      nextSample = truth.progress + SAMPLE_EVERY;
    }
    if (truth && truth.progress >= 0.995 && samples.length > 5) break;
    await page.waitForTimeout(20);
  }
  return samples;
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
    const samples = await analyzeCycle(page, cycle);
    const gates = evaluateGates(samples);
    for (const g of gates) {
      console.log(`  [${g.pass ? "PASS" : "FAIL"}] ${g.id}: ${g.detail}`);
    }
    report.cycles.push({ cycle, samples, gates });
  }

  const pass = report.cycles.every(c => c.gates.every(g => g.pass));
  report.pass = pass;

  const absOut = resolve(projectRoot, outFile);
  writeFileSync(absOut, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${absOut}`);
  console.log(pass ? "\nAll gates passed." : "\nGate FAILURES detected.");

  await browser.close();
  await server.close();

  if (!pass && !REPORT_ONLY) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
