# The Creative Memory Engine

> The software should be intelligent enough to remember, creative enough to inspire, and humble enough to stay quiet.

One shared foundation under the creative tools. Tools read from it; they do not grow their own watchers, their own context or their own
memory. It is an *extra*: if any part of it fails, the editor carries on (three failures in a row switch it off for the session).

```
USER CREATES → OBSERVE → UNDERSTAND → (DECIDE) → USER CHOOSES
                  │           │            │
              observe.js  context.js   decision gate (v0.10)
                  └────── still-here.js (what is worth keeping)
```

## Status

| Stage | What | State |
|---|---|---|
| Phase 0 | Audit of the existing code (what is reused, extended, new) | done — see below |
| Phase 1 | **Observe** (`shared/creative/observe.js`) | done (v0.9.0), no UI |
| Phase 2 | **Context** (`shared/creative/context.js`) | done (v0.9.0), no UI |
| Phase 3 | **Still Here** (`shared/creative/still-here.js`, `renderer/ui/still-here-ui.js`) | done (v0.9.0) |
| Phase 4 | Living Timeline: FOLLOW / GROW FROM / REMEMBER / BECOME | next (v0.10.0) |
| Phase 5 | Decision Gate (one suggestion at a time) | next (v0.10.0) |
| Phase 6–7 | Living Lab and Organic Engine on the shared foundation | next (v0.10.0) |

## What is reused, extended, new

* **Reused unchanged:** `shared/timeline.js`, keyframes and `resolveParam`, audio bindings, `relations()` (cuts/overlaps, from
  `living/accident.js`), effect chains (`mutation/chain.js`), the compositor, Memory Bleed, the Organic Engine, Project DNA, the
  footage and audio analysis caches, `VariationRenderer` (the memory picture of a look).
* **Extended (small):** `store.js` — `changeKind` ('edit' | 'undo' | 'redo' | 'load'), snapshots leave the shelf out, a restore keeps
  the live shelf; `project.js` — `stillHere: []`; the Living tab gets one section.
* **New:** the observer, the context rules, the memory model and curator, the Still Here UI.

## Observe

Event driven: the engine listens to the store's `project` notifications and looks once after 600 ms of quiet (never per frame; the
work is proportional to the number of clips). For each clip it follows two *lineages*: its **look** (effect chain) and its **movement**
(x / y / scale / rotation keyframes) — when it started, how many times it was changed. A lineage **ends** when the clip is deleted, the
effects or keys are cleared, or the look is swapped for something far away from it (`chainDistance` ≥ 0.6; moving one slider is far
below that). **Undo, redo and opening a project are silent**: they resync the observer and end nothing, because an undone change was not
abandoned work.

Observation never creates anything on screen. It feeds Context (recent activity) and the Curator (ended lineages).

## Context

`inferContext` answers *what is the artist doing right now?* from the selection, the clips around it and the last twenty seconds:
`connecting-scenes`, `text-over-scene`, `changing-rhythm`, `experimenting-motion`, `searching-look`, or `idle`, always with one short
sentence saying why. It is temporary and never saved; it is not the Project DNA (the long-term character of the project).

## Still Here

A shelf of **fragments**, not states. A memory is small data — a simplified movement curve, an effect recipe, up to six colours, a cut
pattern — never media and never a copy of the project. Shown in the Living tab as:

| Fragment | Brings back |
|---|---|
| THE WAY IT MOVED | the clip's x / y / scale / rotation keys, relative to where the target sits, stretched to its length, clamped |
| THE WAY IT LOOKED | the effect chain (appended; refused beyond 12 effects) |
| THE WAY IT FELT | its colours, onto the colour settings of the target's effects |
| THE RHYTHM YOU LEFT BEHIND | the proportions of a run of cuts, onto a selected run of clips on one track (same span, no gaps or overlaps, never longer than the footage) |

* **Keep** buttons act on the selection and say why one is unavailable. The same content is never kept twice.
* **BRING BACK** is one Undo step; when it cannot be applied nothing changes and no empty Undo step is left.
* **Outside undo, inside the file.** `project.stillHere` saves with the project and autosave. The undo of the edit that produced a memory
  does not remove the memory (`store.js` leaves the shelf out of snapshots and keeps it on restore). A damaged shelf is repaired on use.
* **Small.** At most 60 fragments; at most 12 kept by the curator. What the user kept is never dropped to make room.
* **The Curator** (`curate()`) keeps something by itself only when a lineage ended after at least 25 s of work and 3 separate changes,
  with a score ≥ 0.5 (time and care), the look not still at its defaults, not already on a clip or among the built-in looks, not already
  on the shelf, and (for movement) at least three keys and a visible amplitude. Anything doubtful is not kept. It says why in one
  sentence ("You worked on this look for a while before letting it go."). The switch *Keep good leftovers for me* turns it off.

## Honest limits

* Only looks and movements are kept automatically; colours and rhythm are kept only when asked.
* A look's picture is the frame at the playhead when it was kept, and only if the clip was on screen then; fragments kept by the
  curator have no picture (their effects are listed).
* Rhythm is a proportion of cuts, not tied to the music.
* The curator is a set of rules, not an understanding of taste. The thresholds are guesses tuned on Linux, not on real use.
* Developer switch: `localStorage['hhlab.creative'] = 'off'` turns the engine off.
