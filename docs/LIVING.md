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
