# The Creative Memory Engine

> The software should be intelligent enough to remember, creative enough to inspire, and humble enough to stay quiet.

One shared foundation under the creative tools. Tools read from it; they do not grow their own watchers, their own context or their own
memory. It is an *extra*: if any part of it fails, the editor carries on (three failures in a row switch it off for the session).

```
USER CREATES → OBSERVE → UNDERSTAND → DECIDE (or stay silent) → USER CHOOSES
                  │           │            │
              observe.js  context.js   suggest.js + gate.js
                  └────── still-here.js (what is worth keeping)
                          relate.js (what two clips can become)
```

## Status

| Stage | What | State |
|---|---|---|
| Phase 0 | Audit of the existing code (what is reused, extended, new) | done — see below |
| Phase 1 | **Observe** (`shared/creative/observe.js`) | done (v0.9.0), no UI |
| Phase 2 | **Context** (`shared/creative/context.js`) | done (v0.9.0), no UI |
| Phase 3 | **Still Here** (`shared/creative/still-here.js`, `renderer/ui/still-here-ui.js`) | done (v0.9.0) |
| Phase 4 | **Living Timeline** (`shared/creative/relate.js`, `renderer/ui/relate-ui.js`) | done (v0.9.0) |
| Phase 5 | **Decision Gate** (`shared/creative/{suggest,gate}.js`, `renderer/ui/suggestion-chip.js`) | done (v0.9.0) |
| Phase 6–7 | Living Lab and Organic Engine on the shared foundation | done (v0.9.0), see the end of this page |

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

## Living Timeline (manual)

Select two clips and press one of four verbs (Living tab, TIMELINE). The earlier clip is the source, the later one the target.

| Verb | What it does, with ordinary structures only |
|---|---|
| FOLLOW | the target borrows the source's movement (x / y / scale / rotation, scaled to its length; never over keys it already has); with no movement to borrow it follows the same music (the source's audio bindings) |
| GROW FROM | veins creep up at the end of the source, carry across the cut and recede (the Lab Accident builder; colours and thickness from the Project DNA when there is one; the glow breathes with the bass once the music is analysed) |
| REMEMBER | an adjustment layer around the cut with a Memory Bleed whose intensity appears at the cut and lets go |
| BECOME | over the first 0.4–1.5 s of the target: effect settings glide from the source's to its own, an effect only the source had lingers and lets go (wet/dry), an effect only the target has fades in, and position, size and turn start where the source ended |

Pressing a verb only **plans**: a picture drawn from a copy of the project and one sentence; **APPLY** is one Undo step, **CANCEL** leaves
everything alone. A button is disabled (with the reason in its tooltip) when it does not fit the two clips. Nothing here deletes or
replaces a clip, an effect, or a keyframe or binding the artist made. FOLLOW, GROW FROM and REMEMBER are the same builders Lab Accident
uses (now exported from `living/accident.js`); only BECOME is new, and it writes ordinary keyframes.

## Decision Gate

Suggestions are rare on purpose. `suggest.js` only lists what *could* be said for the present context (always with one sentence of
reason); `gate.js` decides, and every condition must hold or nothing appears:

1. **Relevance**: it belongs to what the artist is doing now, on the clips they have selected.
2. **Confidence**: ≥ 0.65 to begin with; the bar rises with the dismissal rate (from 5 suggestions shown), up to 0.95.
3. **Novelty**: not on screen, not dismissed in the last 10 minutes (5 if it faded unanswered), never again once applied.
4. **Low interruption**: nothing playing, no take/trace/recording, nothing being typed, the last edit at least 2.5 s ago, at least 45 s since
   the previous suggestion.
5. **Explainability**: one sentence of at most 90 characters.

Dismissing five of the first six suggestions mutes them for a day. At most **one** is on screen (a small note at the bottom of the window:
`LET IT FLOW — The first shot moves and this one stays still. [APPLY] [DISMISS]`); playing, typing or moving on removes it without
counting against it, and it fades by itself after 25 s. Candidates today: FOLLOW (the first shot moves, the second does not), GROW FROM
(growth on the first stops at the cut), REMEMBER (a memory that ends at the cut), BECOME (two very different looks side by side), and
LOOK BACK (up to three similar-but-different looks or movements from Still Here, at most three, never claimed to be better). The
*Quiet suggestions* switch turns it all off; the manual tools stay. The counters are kept per user in `localStorage` (`hhlab.gate.stats`).

## Living Lab and the Organic Engine on this foundation

* **Project DNA** colours GROW FROM (palette, thickness, density) and gently ranks LOOK BACK (colours near the project palette first). It
  never edits the project and never creates a suggestion on its own.
* **Take and Trace**: after a session a *Keep how it moved / looked* button puts the result on the Still Here shelf (the same Keep as
  anywhere else). A running take or trace keeps every suggestion silent (`creative.busyProbe`).
* **Lab Accident** and the Living Timeline share their builders; **Memory Bleed** is what REMEMBER and the cut-remembers accident place.
* **Organic Engine**: GROW FROM places the existing `veins` effect; there is no second organism renderer.

## Honest limits

* Only looks and movements are kept automatically; colours and rhythm are kept only when asked.
* The gate's thresholds are a first, strict guess, tuned by tests and not by real use; whether it feels quiet enough is for the artist to say.
* Suggestions look only at the clips' own effects and keyframes (not at the pictures or the music), so "these shots move in the same direction" is not detected: the footage analysis has no direction of motion.
* BECOME, REMEMBER and FOLLOW-on-music are best judged while the timeline plays; the preview is a single frame.
* A look's picture is the frame at the playhead when it was kept, and only if the clip was on screen then; fragments kept by the
  curator have no picture (their effects are listed).
* Rhythm is a proportion of cuts, not tied to the music.
* The curator is a set of rules, not an understanding of taste. The thresholds are guesses tuned on Linux, not on real use.
* Developer switch: `localStorage['hhlab.creative'] = 'off'` turns the engine off.
