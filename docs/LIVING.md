# The Living Lab

> Don't perfect your edit. Leave your trace on it. — Your edit remembers your hands.

Five connected systems that sit **on top of** the editor's existing machinery. None of them adds a second animation format, a second
renderer or a second DNA system.

| Tab section | Module | One line |
|---|---|---|
| TRACE | `living/gesture.js`, `ui/living-ui.js`, `engine/trace-renderer.js` | Leave your hand inside the edit. |
| MEMORY | `engine/memory-bleed.js` (+ the `memory` effect) | Let the image remember. |
| TAKE | `living/take.js` | Perform your visual live. |
| DNA | `living/project-dna.js` (extends `mutation/dna.js`) | Give the project a shared identity. |
| ACCIDENT | `living/accident.js` | Break the rules carefully. |

## Phase 1 — audit: what is reused, extended, or new

| Need | Where it already is | Verdict |
|---|---|---|
| GPU renderer | `engine/compositor.js` (WebGL2, ping-pong `a/b`, spare `c`, `acc`, matte `m`), same class for preview, export, Mutate thumbnails | **Extend**: per-effect *state* that survives between frames (Memory Bleed). New passes only. |
| Audio analysis | `shared/audio-analysis.js` (`rms/bass/mid/high/beat`, BPM), `music-structure.js`, bindings in `shared/params.js` | **Reuse** as is (organism growth, DNA, accident instability). |
| Keyframes / automation | `shared/keyframes.js` (`{t,v}` tracks, clip-relative seconds, smoothstep), `resolveParam`, `ui/param-row.js` | **Reuse** the format. **Extend** `paramRow` with one hook so live moves can be recorded. A take and a trace *write ordinary keyframes*. |
| Organic engine | `shared/roots.js` (seeded branching geometry), `engine/roots-renderer.js`, effects `veins/spores/cells`, generators `shared/organic-defs.js` | **Reuse**; **extend** roots geometry with "grow along a path" and add a `trace` generator style that draws it. No new organism renderer. |
| Mutate DNA | `shared/mutation/*` (seed, `mutate`, `validateChain`, `dna.js`, `project.dna[]`, `.hhdna`) | **Extend**: Project DNA is an identity object next to the library, deterministic from inputs + seed; it only *biases* Mutate. |
| Timeline / clips / masks / mattes / blend / adjust layers | `shared/timeline.js`, `shared/mask.js`, `compositor` mask/matte, adjustment layers | **Reuse**; Lab Accident edits these ordinary structures and nothing else. |
| Undo | `store.snapshot()/mutate()` (JSON snapshots) | **Reuse**: one take, one trace, one kept accident = one undo step. |
| Preview of alternatives | `engine/variation-preview.js` (second compositor on a project clone) | **Reuse** for accident candidates. |
| Footage statistics | `main/footage.js` + `shared/shot-analysis.js` (cached: hue, saturation, brightness, motion, cuts per file) | **Reuse** for Project DNA (palette, motion). |
| MIDI | none | **Design ready, not built**: a take records `(slot, t, value)`; a MIDI source would call the same `perform()`. |

New code that genuinely did not exist: gesture capture and curve simplification, the take recorder, path-following roots and the trace
renderer, the Memory Bleed shaders and bounded texture state, project-identity derivation, accident planning.

## Rules every phase follows

* Keyframes stay the only automation format; durations are clip-relative seconds.
* Seeds are explicit; the same inputs and seed give the same result.
* Nothing is applied without an undo step; accidents are previews until **Keep**.
* GPU: no readback in the render path, bounded history, pooled textures, freed when a clip or effect disappears.
* Preview and export share one code path. Where state depends on playback order (Memory Bleed), a seek resets it, exactly as an
  export starting at that frame would.

## Phase 2–3 — Trace and Take (done)

* **Take**: REC plays the timeline; every Inspector slider (via the one hook in `param-row.js`) and the XY pad report their moves to
  `shared/living/take.js`. A parameter you touch is taken over (its old keyframes set aside); at stop the performance is
  simplified and punched over the stretch you played, old keys before and after come back. One session = one undo step; Esc cancels
  and leaves nothing. A MIDI source would call `LabTake.perform(slot, value)`; none is built.
* **Simplifying** (`living/simplify.js`): keys at the turning points first, then wherever the *real* smoothstep interpolation is
  furthest off, then redundant keys are pruned. A rest between two moves stays flat (the smoothing window is in seconds, not samples).
* **Trace**: draw over the picture while it plays. Motion (clip x/y, relative to where it was) and Influence (any parameters; across,
  up/down, speed) write ordinary keyframes. Residue and Grow create a generator clip of style `trace` whose path keeps your timing
  (`engine/trace-renderer.js`, `buildRootsAlong` in `shared/roots.js`, Catmull-Rom smoothing). The clip's `growth/glow/thickness…`
  are the ordinary generator parameters.
* Not live: while you draw, only the overlay shows; the clip moves / the roots grow after you stop.

## Phase 4 — Memory Bleed (done)

The `memory` effect: Ghost (past frames fade into the present), Stain (colour from earlier frames leaks forward), Scar (movement
leaves a mark that slowly changes colour), Echo (fragments of earlier frames return on a rhythm). Controls: length, decay,
intensity, blend (behind / screen / add / difference), drift, echo rate; plus the effect's wet/dry like any effect.

* **State** (`engine/memory-bleed.js`): per effect instance, textures at a fraction of the picture size (0.5 by default). Ghost/Stain
  2 textures, Scar 4, Echo 7. At most 8 memories at once (the extra ones pass the picture through). Textures come from a pool,
  go back the moment a clip or effect is not drawn, on resize and on dispose; `liveTextures` counts them. No CPU readback.
* **Preview = export** (`shared/living/memory-plan.js`): a memory only grows from consecutive frames. A seek (backwards, or forwards by
  more than 0.35 s) starts it afresh — what an export beginning at that frame does. Drawing the same frame again (a paused preview)
  never adds to it. Fading is by time, not by frame count, so another frame rate looks the same. The e2e renders the same frames after
  a detour (identical pixels) and compares a preview frame with an exported one.
* **Adaptive quality**: the preview lowers the history size (0.5 → 0.35 → 0.25) when playback stutters while a memory is on screen and
  raises it again when calm (`MemoryAdapt`). The export always uses 0.5.
* Limits: a still thumbnail (Mutate grid) cannot show a memory, so a roll never adds one; the memory must be built up by playback; the
  history is 8-bit, so very long memories are cut off by a small straight fade (`decay` sets how crisp that tail is).

## Phase 5 — Project DNA (done)

An ordinary Mutate DNA (`shared/mutation/dna.js`) of kind `project`, with an extra `identity` field (`living/identity.js`):
traits (energy, warmth, grit, motion, density, calm), a palette, style leanings per effect category, and suggestions for Memory,
Trace and the organic layer. Its chain is a *signature look* made by the same `generate()` the Mutate tab uses, leaning the way
the identity leans, with a recipe so `reproduceDna` rebuilds it.

* **Derived from** (`living/project-inputs.js`): BPM and band energies (audio analysis), cutting density, motion and palette (the cached
  footage analysis the montage uses: hue, saturation and brightness of the frames you actually use, weighted by how long each file is
  on the timeline), the Mutate style choice and existing Mutate seeds.
* **Deterministic**: inputs are rounded first, then hashed with the seed. Same project + same seed → the same DNA (tested, including
  through a JSON round trip and through the e2e twice on the same project).
* **It never edits the project.** Reading it changes nothing in the edit (e2e checks the clips are byte-identical). Every use is a
  button: Use for Memory, Use for Trace, Add signature look (appends effects, one Undo step), Save to library, Grow a living layer; and
  an opt-in “lean toward the project's identity” in Mutate. Stored in `project.living.dna`; Undo covers it.

## Phase 6 — the organism (done)

No new organism renderer. `living/organism.js` sets up effects that already exist, from the identity and the music:

* **Living layer** (an adjustment layer): `veins` (colour, thickness, density from the identity; glow bound to the bass, flow to the beat;
  **growth keyframed from the energy of each bar**, so loud bars grow it faster than quiet ones), optional `spores` (speed bound to the
  highs, when the identity asks), then a `memory` Stain so the veins leave a fading colour behind.
* **Human Trace → Grow** takes the identity's thickness / density / glow and its glow listens to the bass.
* Without analysed music the layer still grows (over the identity's own time) and the bindings simply stay still.
