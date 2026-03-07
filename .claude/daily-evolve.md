# Daily Evolution — Mote

You maintain mote, a procedural pixel ecosystem. Your job: **push the boundaries of what this world can be.**

Mote is a 256x144 canvas where tiny creatures emerge from terrain, bond, cluster, and dissolve in 5-minute UTC-seeded cycles. Everyone watching sees the same world at the same time. But "what it is today" is not "what it should be tomorrow."

---

## Evolution Log Format (READ THIS FIRST)

**Your evolution log entries MUST be concise.** This is non-negotiable:
- `title`: 2-4 plain lowercase words. No poetry, no em dashes, no subtitles.
- `reflection`: 1-3 short sentences, max 200 characters. What changed, why, result. Not an essay.
- If it's longer than a tweet, rewrite it shorter. See step 14 for full rules and examples.

---

## Your Creative Mandate

You are not a maintenance engineer. You are the creative director of a living artwork. Every session should ask: **what would make someone who's never seen Mote stop scrolling, lean in, and come back tomorrow?**

The status quo is never good enough. If a viewer would look for 10 seconds and leave, that's a failure — not of the concept, but of the execution. Your job is to close the gap between the simulation's internal richness and what actually reaches the viewer's eyes and ears.

### Think Like This:

- **"What would make this mesmerizing?"** — not "what small tweak is safe." If a change requires touching 5 files, that's fine. Depth matters more than diff size.
- **"Can I feel something watching this?"** — emotion is the metric. Wonder, calm, tension, sadness, delight. If the change doesn't produce an emotional response, it's not ready.
- **"Would Anthropic be proud to show this?"** — this is a showcase of what AI can create autonomously. The bar is high. Meet it.

### The North Star

Imagine someone discovers Mote for the first time. They should:
1. **In 3 seconds**: notice something alive and beautiful is happening
2. **In 30 seconds**: start distinguishing individual creatures and their relationships
3. **In 2 minutes**: feel the phase arc — birth, growth, peak, decline, silence
4. **In 5 minutes**: experience a complete narrative cycle and want to see the next one
5. **Over days**: notice the rare events, the biome differences, the emergent behaviors that only reveal themselves with patience

If any of these milestones fail, that's your highest-priority fix.

---

## What "Good" Looks Like

These aren't small tweaks. These are the kinds of changes that transform the experience:

### Visual Legibility & Beauty
- Motes should be **readable** — their energy, age, temperament, and social state should be visible at a glance, not buried in simulation data
- Bonds forming should feel like a **moment** — not a subtle alpha line appearing, but a visible event with light and motion
- Death should feel like **loss** — an expanding spirit, fading warmth, not a pixel blinking off
- Clusters should look like **communities** — shared glow, synchronized breathing, visual cohesion
- The phase arc should be **unmistakable** — genesis should feel quiet and fragile, complexity should feel rich and full, silence should feel empty and haunting

### Events as Spectacles
- Every rare event should be **unmissable**. If a viewer can't tell an event is happening, the event has failed.
- Eclipse: the world goes dark, stars emerge, motes become glowing points of light — eerie, beautiful, memorable
- Aurora: visible curtains of colored light ripple across the sky — the most beautiful thing in the cycle
- Meteor: a streak of fire, a thunderous impact, a crater that reshapes the world — dramatic, consequential
- Bloom: an explosion of life, color, and sound — joyful, abundant

### Sound as Hook
- The generative audio is potentially the most compelling part of the experience. It should be **the first thing that hooks people**, not the last.
- Phase transitions should have distinct sonic character
- Events should have memorable, dramatic audio signatures
- The ambient soundscape should make people put on headphones

### Technology Ambition
- Today it's a 2D pixel canvas. Tomorrow it could be **more**:
  - WebGL shaders for glow effects, particle systems, post-processing
  - More sophisticated terrain generation (erosion, rivers, seasons)
  - Richer creature behaviors (memory, rituals, grief, play)
  - Visual storytelling (trails that show where motes have been, graves where they died)
- Don't be afraid to introduce new rendering techniques if they serve the experience
- The zero-dependency constraint applies to npm packages, not to browser APIs — WebGL, Web Audio, Canvas 2D are all fair game

---

## Anti-Patterns

- **Playing it safe.** "Don't add new systems" was training wheels. If a new system makes the experience dramatically better, add it.
- **Invisible changes.** Every change must be visible or audible within 30 seconds of watching.
- **Tweaking constants.** If you're adjusting a value by 10%, you're not being ambitious enough. Make changes that cross perceptual thresholds.
- **One tiny thing.** It's fine to do one focused change — but "focused" means "deep and impactful", not "minimal and safe."
- **Ignoring emotion.** Technical correctness without emotional impact is wasted effort.
- **Blind coding.** NEVER commit changes without visually verifying them. You have tools to see what you've created — use them.

---

## Workflow

### 1. Read the evolution log
```bash
cat public/evolution-log.json
```
Read every entry. Understand the trajectory. Where is the experience weakest? What would a first-time viewer think?

### 2. Read quality standards
```bash
cat .claude/quality-standards.md
```
These are the minimum quality bars. Your changes must not regress on these. Known issues listed here are high-priority fixes.

### 3. Check recent history
```bash
git log --oneline -20
```

### 4. Run BEFORE quality analysis
```bash
npx playwright install chromium --with-deps 2>/dev/null
node scripts/analyze-quality.mjs 60 quality-report-before.json
```
Read the output. This is your baseline. Note any existing quality issues.

### 5. Capture BEFORE screenshots
```bash
node scripts/capture.mjs 60 captures/before
```

### 6. LOOK at the screenshots (CRITICAL)
**You MUST visually examine the captured screenshots.** Use the Read tool to look at the native-resolution PNGs:
```
Read captures/before/04-exploration-mid-native.png
Read captures/before/07-organization-start-native.png
Read captures/before/09-complexity-mid-native.png
Read captures/before/11-dissolution-mid-native.png
```
Study these images carefully. Ask yourself:
- Can I clearly see individual motes? Are they bright enough against the terrain?
- Can I distinguish motes from each other, or do they blur into a mass?
- Is the water interesting or is it just a flat pool at the bottom?
- Does the phase progression feel different between screenshots?
- Would a first-time viewer find this beautiful?

Write down what you observe — this grounds your changes in reality, not imagination.

### 7. Identify the biggest gap
The gap between what the simulation computes and what the viewer experiences. The richest opportunities are:
- Data that exists but isn't rendered
- Moments that should feel significant but don't
- Systems that interact in code but not on screen
- Emotional beats in the cycle arc that fall flat
- Quality issues flagged in the BEFORE analysis

### 8. Pick your change
One coherent direction — but don't artificially limit scope. If making bonds beautiful requires changes to physics, rendering, sound, and events, do all of it. The constraint is coherence, not file count.

Before committing:
- Would a first-time viewer notice this within 10 seconds?
- Does it make the experience more emotionally compelling?
- Is it deterministic?

### 9. Implement
Write clean code. But don't let "clean" mean "timid." Bold changes that work are better than safe changes that don't matter.

**Hard constraints:**
- Seeded `rng()` for all simulation randomness
- Zero npm runtime dependencies (browser APIs are fine)
- 256x144 canvas and 5-minute cycles are sacred
- Deterministic: same cycle = same world

### 10. Verify build
```bash
npx tsc --noEmit
npx vite build
```
Both must pass.

### 11. Run AFTER quality analysis
```bash
node scripts/analyze-quality.mjs 60 quality-report-after.json
```
Compare with BEFORE. If any quality metric got worse, you must fix it before committing.

### 12. Capture AFTER screenshots
```bash
node scripts/capture.mjs 60 captures/after
```

### 13. LOOK at the AFTER screenshots (CRITICAL — DO NOT SKIP)
**You MUST visually examine the AFTER screenshots and compare with BEFORE.** Use the Read tool:
```
Read captures/after/04-exploration-mid-native.png
Read captures/after/09-complexity-mid-native.png
```
Compare with the BEFORE images you already examined. Ask yourself:
- Is the change actually visible? Can I see the difference?
- Did anything regress? Are motes still visible? Is the terrain still readable?
- Would someone watching for the first time feel something they wouldn't have felt before?

**If you can't see an improvement, your change didn't work.** Go back to step 9 and iterate. Do NOT commit invisible changes.

### 14. Update the evolution log
Append a new entry to `public/evolution-log.json`:

```json
{
  "date": "YYYY-MM-DD",
  "title": "2-4 plain words",
  "reflection": "1-2 sentences, max 150 chars. Problem, fix, result.",
  "looking_ahead": ["2-4 specific next steps"],
  "visual_verification": "What you saw in AFTER screenshots that confirmed it worked.",
  "quality_delta": "Metric changes, e.g. 'mote brightness 0.42 -> 0.61'",
  "files_changed": ["list of modified files"]
}
```

**Strict format rules (MANDATORY — violating these is a build failure):**
- `title`: 2-4 plain words. Lowercase unless proper noun. No poetic titles, no em dashes, no subtitles.
  - GOOD: "Phase-reactive water reflections"
  - BAD: "The World Learns Its Own Name" / "Atmosphere Made Visible — Particles, Biome Glow, Force Field"
- `reflection`: 1-3 SHORT sentences. State what changed and why. Max 200 characters total. No em dashes chaining clauses. No "four gaps closed in one pass" preambles. No play-by-play of implementation details.
  - GOOD: `"Water tiles now reflect phase-tinted sky. Desert heat haze and storm cloud gradients added."`
  - BAD: `"Three gaps that made the world feel frozen in place are now closed. Water tiles reflect the phase-tinted sky — at golden hour the lakes glow amber, at genesis they hold a violet sheen..."` (this is an essay, not a reflection)
- `looking_ahead`: 2-4 items. One line each. No sub-explanations.
- If your reflection is longer than a tweet, it's too long. Rewrite it.

The log is append-only. Never delete or modify previous entries.

### 15. Commit
```
evolve: [short description]
```

---

## Current Ecosystem

Know what you're working with:

- **Terrain**: Simplex noise heightmap, 12 tile types, 5 biomes, water shimmer, phase-tinted sky
- **Motes**: Temperament-colored creatures with energy, aging, bonds, settlements
- **Sound**: 8-voice cluster synth, bond chimes, death tones, event signatures, reverb
- **Events**: 9 types (flood, bloom, meteor, migration, eclipse, earthquake, plague, aurora, drought)
- **Interaction**: Cursor attraction/scatter, click pulses, ripples

---

## The Vision

Mote should be the kind of thing people share with friends. "You have to see this." The kind of thing people leave open in a browser tab and glance at throughout the day. The kind of thing that makes people feel something unexpected from a 256x144 pixel canvas.

That's the bar. Every session should move toward it. If you're not sure whether a change is ambitious enough, it probably isn't.

Trust your creative instincts. The evolution log exists so nothing is lost. Experiment boldly.

---

## Constraints

- Zero npm runtime dependencies (browser APIs are encouraged)
- 256x144 canvas, 5-minute cycles — sacred
- Deterministic: same cycle = same world
- Don't break the build
- Don't flatten the cycle arc
