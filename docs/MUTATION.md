# HHL Mutation Engine

The Mutation Engine combines, mutates and organises the effects the editor already has. It adds **no new effect and no new render
path**: it produces and edits ordinary effect chains (`clip.effects`), so what it makes previews, undoes and exports like anything
else, and the source media is never touched.

## Status

| Milestone | What | State |
|---|---|---|
| M1 | Effect meta, chain validation, shared seeded RNG | done (this folder: `src/shared/mutation/`) |
| M2 | `mutate()` / `generate()` / `variations()`, `composeChain()`, e2e render check | done |
| M3 | DNA model and library (save, duplicate, diff, import/export text, migrate user presets) — pure data layer | done (`dna.js`); no UI or file dialog yet |
| M4 | Mutate tab: variation grid on the real frame, Use (one Undo step), locks, DNA panel, `.hhdna` open/save, migration of old presets | done (`ui/mutate-ui.js`, `engine/variation-preview.js`) |
| M5 | Per-effect wet/dry `mix` in the compositor, A/B compare | planned (decided: a small compositor change is allowed) |
| M6 | Rule-based Creative Director (no external API) | planned |
| M7 | Optional LLM adapter emitting the same constraints JSON | optional |

Decisions: DNA is stored inside the project file (`project.dna[]`) and can also be exported as a `.hhdna` JSON file; no date-stamp
effect for "Digicam".

## Modules (`src/shared/mutation/`)

All pure (no DOM, no GL, no `Math.random` except `newSeed()`), unit-tested in `test/mutation.test.mjs`.

* `rng.js` — `rng(seed)` (mulberry32, the generator the ad-lib planner used), `toSeed`, `childSeed`, `newSeed`, `pickWeighted`.
* `effect-meta.js` — per-effect category, tags, stage, cost, alpha behaviour, exclusive group, addable flag, and per-parameter safe
  ranges / fixed / allowed options. `checkMeta()` compares it with `EFFECTS`; a test fails when an effect has no meta.
* `chain.js` — the chain format and its gate:
  * `validateChain(chain)` → `{chain, issues}`: drops unknown effects/parameters, clamps and snaps numbers, checks options, colours,
    toggles, keyframes and audio bindings. Never mutates its input.
  * `composeChain(items, rules)` → `{chain, dropped}`: one effect per type, mask/torn/crop/outline/HUD last, heavy-effect and length
    budgets, locked effects keep their slot.
  * `effectsToChain` / `chainToEffects`: convert to and from `clip.effects` (fresh ids on the way out).
* `mutate.js`:
  * `mutate(base, {seed, strength, pool, bias, minLength, maxLength, maxHeavy})` — same inputs, same chain.
  * `generate({seed, length, ...})` — a chain from nothing.
  * `variations(base, {seed, count, ...})` — `count` different chains from one master seed; each one reproduces alone from its own seed.

* `dna.js` — saved configurations:
  * `createDna` / `normalizeDna` — validate and repair; `dnaFromRoll` runs a roll and stores its recipe; `reproduceDna` rebuilds the
    chain from the recipe (`same: false` once the DNA was edited).
  * `diffChains` — added / removed / reordered / enabled / changed parameters between two chains or DNA.
  * Library in `project.dna[]` (`addDna`, `removeDna`, `renameDna`, `duplicateDna`, `lineage`, `libraryOf` repairs on use). It saves
    with the `.hhlab` file and is covered by undo and autosave. Capped at 500 entries.
  * `builtinDna()` — the 87 ready-made looks as read-only DNA (`builtin:<group>:<name>`), never copied into a project until saved.
  * `exportDna` / `parseDnaFile` — `.hhdna` JSON text; reading never throws, clashing ids get fresh ones, imports are never
    read-only and every value is clamped by `validateChain`.
  * `migrateUserPresets` — converts the old "Save chain" presets once (matched by name and content).

A chain item is `{type, enabled, params, keyframes, bindings, locked?, lockedParams?}`.

## Rules a roll follows

* Strength 0 changes nothing; 1 is wild. It scales the size of parameter moves and the odds of adding, removing or swapping.
* Numbers move inside the **safe range** from `effect-meta.js` (never wider than the slider); colours move around the wheel; enums
  and toggles flip with odds scaled by strength.
* Never touched: locked effects (never changed, removed or swapped; their order relative to other locked effects is kept),
  `lockedParams`, parameters marked `fixed` (for example `color.invert`, the crop sides, the mask geometry), parameters that already
  have keyframes. An effect with a locked parameter or a keyframe is not removed.
* Never inserted by a roll: `crop`, `mask`, `outline` (they need a deliberate setup).
* Stacking limits for what a roll adds: one effect per type, at most one `binarize` effect (dither, halftone, xerox, threshold) and
  one `scene` effect (3D object, grid floor), at most `maxHeavy` heavy effects. A chain the user built is never cut down to these
  limits; they only restrict what the roll adds.
* Every result passes `validateChain`.

## Cost and compatibility are estimates

`cost` and `stage` come from reading the shaders and parameters (texture taps, loops, size), **not from GPU measurements**. The
render check in `scripts/e2e.mjs` (100 seeded rolls through the real compositor: no GL error, no shader failure, no NaN, no blank
frame, the same seed gives the same pixels) is what keeps the metadata honest. A future step can replace the static cost classes
with timings.

## What is deliberately not here yet

Per-effect wet/dry and an A/B split view (M5); description-to-chain
translation (M6). Effects that keep state between frames, feedback loops and custom GLSL remain roadmap items in `ROADMAP.md`.

## The Mutate tab (M4)

Left panel, tab 05. Select a clip, put the playhead on it, press **Roll**.

* The grid shows **Current** plus 4, 6 or 9 variations, each drawn on the real frame at the playhead with every layer of the
  project, by a second small compositor that borrows the preview's decoded frames (`variation-preview.js`). The project and the
  media are not touched until you press **Use**; that applies the chain with one `store.mutate`, so one Undo takes it back.
* **Strength**, **style** (a category bias) and **allow one heavy effect** steer the roll. **Start from a look…** rolls from any
  built-in look. **More** rolls again from a variation; **⟳** re-rolls only that one; **★** saves it as DNA with its seed.
* **Seed:** every roll shows its seed. Type a seed and press Roll to reproduce a whole grid exactly; each variation also shows its
  own seed.
* **Keep:** lock a whole effect or single values. Locks are stored on the clip's own effects (`fx.locked`, `fx.lockedParams`), so
  they survive Use, saving and the next roll. Locks apply when rolling from the clip, not from a look or DNA.
* **Saved DNA:** save, apply, roll from, copy, rename, delete, tick two to see what differs, export/import `.hhdna` files, and
  bring in the old "Save chain" presets once. The library is `project.dna[]`, so it saves with the project and Undo covers it.

Not done: the grid only draws while paused and while the playhead is on the clip; there is no A/B split yet (M5); thumbnails use
the preview's decoded frames, so a clip that has not loaded a frame yet shows nothing until it does.
