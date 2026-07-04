// analyze-quality.mjs — Visual quality analysis via Playwright.
// Extracts the 256x144 canvas pixel data and computes quality metrics.
// Usage: node scripts/analyze-quality.mjs [speed] [output-file]
//   speed: time multiplier (default 60)
//   output-file: where to write the JSON report (default quality-report.json)

import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const speed = parseInt(process.argv[2] || "60", 10);
const outFile = process.argv[3] || "quality-report.json";

const CYCLE_DURATION = 300;
const effectiveCycleDuration = CYCLE_DURATION / speed;

// Sample points through the cycle (fraction of cycle progress)
const SAMPLE_POINTS = [
  { name: "genesis", progress: 0.05 },
  { name: "exploration-early", progress: 0.15 },
  { name: "exploration-late", progress: 0.25 },
  { name: "organization", progress: 0.40 },
  { name: "complexity-peak", progress: 0.65 },
  { name: "dissolution", progress: 0.85 },
  { name: "silence", progress: 0.95 },
];

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

async function main() {
  console.log("Starting quality analysis...");

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

  const url = `http://localhost:5198/?speed=${speed}&debug`;
  await page.goto(url);
  await page.click("canvas");
  await page.mouse.move(2, 2); // park off-canvas so the cursor indicator doesn't render
  await page.waitForTimeout(500);

  const startReal = Date.now();
  const report = { timestamp: new Date().toISOString(), samples: [], summary: {} };

  for (const sample of SAMPLE_POINTS) {
    const targetRealMs = sample.progress * effectiveCycleDuration * 1000;

    // Wait until the right time
    while (Date.now() - startReal < targetRealMs) {
      await page.waitForTimeout(30);
    }

    // Extract raw canvas pixel data at native resolution
    const pixelData = await page.evaluate(() => {
      const canvas = document.getElementById("world");
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        data: Array.from(imageData.data),
        width: canvas.width,
        height: canvas.height,
      };
    });

    if (!pixelData) {
      console.log(`  ${sample.name}: could not read canvas`);
      continue;
    }

    const metrics = analyzeFrame(
      new Uint8Array(pixelData.data),
      pixelData.width,
      pixelData.height,
    );

    console.log(`  ${sample.name}: ${metrics.visibleMoteCount} visible motes, ` +
      `avg brightness ${metrics.avgMoteBrightness.toFixed(2)}, ` +
      `clumped ratio ${metrics.clumpedMoteRatio.toFixed(2)}, ` +
      `water bodies ${metrics.waterBodyCount}`);

    report.samples.push({ phase: sample.name, progress: sample.progress, ...metrics });
  }

  // Compute summary across all samples
  const allSamples = report.samples;
  if (allSamples.length > 0) {
    const avg = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / arr.length;
    const max = (arr, key) => Math.max(...arr.map(x => x[key]));
    const min = (arr, key) => Math.min(...arr.map(x => x[key]));

    report.summary = {
      avgVisibleMotes: avg(allSamples, "visibleMoteCount"),
      peakVisibleMotes: max(allSamples, "visibleMoteCount"),
      avgMoteBrightness: avg(allSamples, "avgMoteBrightness"),
      avgClumpedRatio: avg(allSamples, "clumpedMoteRatio"),
      worstClumpedRatio: max(allSamples, "clumpedMoteRatio"),
      avgMoteSpread: avg(allSamples, "moteSpreadX"),
      waterBodyCount: max(allSamples, "waterBodyCount"),
      avgWaterCoverage: avg(allSamples, "waterCoverage"),

      // Quality flags
      issues: [],
    };

    const s = report.summary;
    if (s.avgMoteBrightness < 0.5)
      s.issues.push("MOTE_TOO_DIM: Average mote brightness below 0.5 — motes are hard to see against terrain");
    if (s.worstClumpedRatio > 0.4)
      s.issues.push("MOTE_CLUMPING: >40% of motes have nearest neighbor <4px apart — they merge visually");
    if (s.avgMoteSpread < 0.3)
      s.issues.push("MOTE_BUNCHED: Motes clustered in narrow X range — poor use of landscape");
    if (s.waterBodyCount <= 1)
      s.issues.push("WATER_MONOTONE: Only 0-1 water bodies detected — liquid placement lacks variety");
    if (s.peakVisibleMotes < 5)
      s.issues.push("LOW_POPULATION: Peak visible motes below 5 — world feels empty");
    if (s.avgVisibleMotes < 3)
      s.issues.push("INVISIBLE_MOTES: Average visible motes below 3 — motes may be too transparent");

    console.log(`\n=== QUALITY SUMMARY ===`);
    console.log(`  Avg visible motes: ${s.avgVisibleMotes.toFixed(1)} (peak: ${s.peakVisibleMotes})`);
    console.log(`  Avg mote brightness: ${s.avgMoteBrightness.toFixed(2)}`);
    console.log(`  Clumping ratio: ${s.avgClumpedRatio.toFixed(2)} (worst: ${s.worstClumpedRatio.toFixed(2)})`);
    console.log(`  Water bodies: ${s.waterBodyCount}, coverage: ${(s.avgWaterCoverage * 100).toFixed(1)}%`);

    if (s.issues.length > 0) {
      console.log(`\n  ISSUES DETECTED:`);
      for (const issue of s.issues) {
        console.log(`    - ${issue}`);
      }
    } else {
      console.log(`\n  No quality issues detected.`);
    }
  }

  const absOut = resolve(projectRoot, outFile);
  writeFileSync(absOut, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${absOut}`);

  await browser.close();
  await server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
