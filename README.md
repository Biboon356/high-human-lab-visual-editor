# HIGH HUMAN LAB — VISUAL EDITOR

An experimental video-editing workstation for musicians, independent artists, music-video directors and
visual designers: basic multitrack editing, a stackable effects lab, motion typography, a procedural
"organic" visual engine, and audio-reactive parameters — rendered to real video files.

> Status: **v0.1 MVP**. The core edit → preview → save → export loop is real and tested end-to-end.
> See [Feature status](#feature-status) for exactly what is solid, what is a prototype and what is not built.

## Quick start

Requirements: **Node.js ≥ 20** (22 recommended) and npm. macOS 12+ or Windows 10+ (Linux works for development).
No system ffmpeg is needed — `ffmpeg-static` / `ffprobe-static` are installed with the project.

```bash
npm install        # installs Electron, ffmpeg-static, ffprobe-static (~250 MB, downloads binaries)
npm start          # launches the app
```

| Command | What it does |
|---|---|
| `npm start` | Run the app in development |
| `npm test` | Unit tests for the pure modules (timeline, keyframes, analysis, export planning, project validation) |
| `npm run test:e2e` | Launches the **real Electron app**, imports real media, edits, saves/reopens, exports and checks the output with ffprobe. Needs a display (Playwright-core is a dev dependency); on headless Linux: `xvfb-run -a npm run test:e2e` |
| `npm run dist:mac` / `npm run dist:win` | Package an installer with electron-builder (`dist/`). **Must be run on the target OS** (macOS builds need macOS). Not exercised in CI yet — see below |

Environment overrides: `HHLAB_FFMPEG` / `HHLAB_FFPROBE` point at your own binaries (e.g. a build with extra codecs).

## Architecture

```
src/
  main/        Electron main process (Node): window, menu, hhlab:// protocol, IPC, ffmpeg/ffprobe, project IO
    main.js      app lifecycle + IPC handlers
    ffmpeg.js    probe, proxy transcode, audio decode, ExportSession (streams raw frames into ffmpeg)
    preload.cjs  the only bridge to the renderer (contextIsolation + sandbox, narrow `window.hh` API)
  shared/      Pure ES modules, no DOM/Node: usable from main, renderer and unit tests
    project.js timeline.js keyframes.js params.js        data model + edit operations
    effects-defs.js text-defs.js organic-defs.js         parameter registries + presets
    audio-analysis.js                                    FFT bands, spectral-flux beat detection
    export-plan.js                                       builds ffmpeg argument lists
  renderer/    UI + engine (Chromium)
    engine/      compositor.js (WebGL2), shaders.js, text-renderer.js, sources.js, exporter.js
    ui/          timeline, inspector, media bin, preview/transport, audio-reactive panel, export dialog
    store.js     single state object + pub/sub + snapshot undo/redo
```

**Why this stack.** Electron gives one codebase for macOS and Windows, hardware-accelerated `<video>`
decoding and WebGL2 — the pieces needed for a responsive preview — plus a full Node environment for ffmpeg.
The trade-off is footprint (~150 MB installed) and that preview decoding is limited to what Chromium can play.
Alternatives considered: Tauri (smaller, but a Rust+WebView split and inconsistent WebGL/codec support across
platforms), Qt/C++ with libav (best performance, far slower to build), pure ffmpeg filter-graphs (no live preview,
and effects would exist twice).

**One renderer for preview and export.** Effects, text, generators and compositing are GLSL passes in
`compositor.js`. The exporter drives the *same* compositor offline at the chosen resolution, one frame at a time,
reads the pixels back and pipes them as raw RGBA into ffmpeg's stdin. What you see is what you render.
ffmpeg also mixes the audio (per-clip `atrim`/`adelay`/`volume` → `amix`) in the same invocation, then the result is
probed again (duration, streams) before the UI reports success.

**Keeping the UI responsive.** Decoding is done by Chromium's media pipeline off the main thread; ffmpeg
(probe, proxy, audio decode, encode) runs in child processes; frames stream to the encoder with back-pressure and
at most one frame in flight. Audio analysis (~1 s per few minutes of audio) currently runs on the renderer thread.

**Modularity.** Each concern is a replaceable unit with a small interface: add an effect by adding an entry in
`effects-defs.js` and a GLSL body in `shaders.js` (UI, keyframes, audio binding and presets come for free);
replace `audio-analysis.js` with a better analyzer as long as it returns the same feature arrays; swap the encoder by
editing `export-plan.js`.

**Security.** The renderer is sandboxed with no Node access. Local media is served through a custom `hhlab://`
protocol that only serves files the user imported or opened (an allow-list in the main process).

## ✨ TikTok Auto-Edit (Thai speech → finished vertical clip)

Select a clip with someone speaking, press **✨ TikTok Auto-Edit** (or `Ctrl/Cmd+Shift+A`), pick options, press **Run**. In one undoable step it:

1. reads the clip's audio and finds where speech actually is,
2. **transcribes Thai** locally with Whisper (whisper.cpp, no cloud, nothing is uploaded) — or reads an `.srt`/`.vtt` file you provide,
3. **jump-cuts silences** and hesitation words (เอ่อ / อืม / อ่า …), with alternating punch-in zoom to hide the cuts,
4. builds **Thai word-by-word captions** (real Thai word segmentation, never breaking inside a word, 2 lines max, kept clear of TikTok's UI), in 4 styles,
5. reframes **16:9 → 9:16** (fill or blurred-background), applies a light look, and normalises loudness to −14 LUFS,
6. leaves everything editable on the timeline; **Export for TikTok…** is one click away, and captions can be saved as `.srt`.

**Getting the words right.** Whisper is the weak link for Thai, so the app works around it instead of trusting it blindly:
- each voiced region is transcribed on its own (less drift, fewer invented words in pauses), with the end of the previous sentence as context;
- the recogniser hears a denoised, level-steadied copy of the audio (your cuts and export still use the original);
- a **vocabulary** of corrections ("what it wrote → what it should write") is applied to every transcript and sent to Whisper as a spelling hint;
- **Captions…** (top bar, or *Edit captions…* after a run) lists every caption: fix any word, the karaoke timing of the other words is kept, one Undo reverts, and your fix is remembered for next time;
- an extra **Maximum (Whisper large-v3, ~1 GB)** model for the most accurate Thai.
None of this has been measured against real Thai recordings yet (see status below); the editor and vocabulary are what make a wrong word a ten-second fix instead of a re-edit.

*Speech models* (Whisper small / medium / large-v3-turbo / large-v3, 190 MB–1 GB) are downloaded on first use into the app-data folder from Hugging Face; Balanced (medium) is the default.

**Honest status:** the silence cutting, Thai word segmentation, captions, reframing, loudness and export are tested end-to-end (including on real synthetic Thai speech, measured from the exported file). The **Whisper transcription itself has not been run against a real model in the development sandbox** (the model host is blocked there): the native binding loads and its error handling is tested, but Thai *accuracy* on real recordings is unverified — try *Balanced* or *Best* for noisy or fast speech, and use the `.srt` import as a fallback.

## Smart auto-montage (footage- and music-aware)

**Auto-montage** in the timeline toolbar analyses your clips and your music on your computer, then cuts a montage:

- **The music decides where to cut:** bars are classed calm / medium / full from the audio (bass, level, highs); calm parts get long shots, full bars cut every beat or two, a detected drop gets a boundary exactly on it and a *hero shot*. Every cut is on a detected beat.
- **The footage decides what to show:** each clip is scanned (4 samples/s) for sharpness, exposure, contrast, colour, hand shake, motion and scene changes; the planner picks the best window that has **no scene cut inside**, motion that fits the music's energy, no footage reused, no back-to-back repeats, and a colour flow between shots.
- **A style decides how it looks** (Hype / Street / Cinematic / **Y2K** / **Organic** / Clean): one coherent grade, accent looks and glitch/flash/punch transitions only on the energetic cuts, alternating punch-in, slow push-ins on stills. *Y2K* lays a Digicam-2002 adjustment layer over the whole cut; *Organic* lets veins grow over it.
- **It edits like an editor:** the first cut is the **hook** (the strongest picture it has), the last is a calm shot that fades out, the hero shot at the drop plays in **slow motion** when something is moving, and shots are nudged toward the median exposure/saturation so the cut doesn't flicker between bright and dark clips (a small colour correction, never a full grade).
- **You steer it:** ★ a clip in the Library to give it more screen time, ⊘ to keep it out. Optional **title card** (any lockup) at the start, and the footage's own sound is muted under the song (both are checkboxes).
- **Wide footage on a tall canvas** is cropped to follow the action, not the centre.
- The dialog shows what it decided and why (sections, drops, hero shot, unused clips) with an energy/cut strip; **Re-roll** gives different choices from the same analysis, **Undo** removes it in one step. Footage analysis is cached per file, so re-rolls are instant.

**No music?** The dialog does not dead-end: *Add a music file…* brings in a song and builds straight away, or *Cut to a steady tempo* cuts to a metronome at a BPM and length you choose (flat energy, no drops).

**Honest limits:** hook / calm-close / slow-mo / colour-match are rules on top of the same measurements, not taste. This is classical signal analysis plus a scoring planner — not a generative or "understanding" AI. It does not recognise faces, people, objects, emotions or what is being said in the footage, so it cannot know which shot is the "story"; it chooses by image quality, motion and music fit. The scoring weights are hand-tuned (unit-tested on synthetic footage and checked end-to-end, not tuned on a large set of real edits). *Classic random montage…* in the dialog keeps the old behaviour.

## Editorial title cards and cross-dissolves

- **Title lockup** (Type tab): a small serif kicker over a hot-pink formal-script title, in the bundled *Pinyon Script* (OFL). Both are ordinary text clips: edit the words, colour, animation, or swap the font for any installed one.
- **Dissolve** (timeline toolbar): select a clip that starts where another picture clip ends, press **Dissolve** with a length (0.25–1.5 s). The incoming clip moves onto its own track directly above the outgoing one and overlaps it, so the pictures really mix (and the sound crossfades); it uses the incoming clip's spare head footage so the dissolve finishes on the cut, or the outgoing clip's tail if there is none. One Undo reverts. The *Cinematic* montage style uses it on calm cuts.

## Niche / Y2K toolkit (v0.2.1–0.2.2)

- **Type:** ten more presets and four **lockups** built from bundled open-licence fonts (Michroma, Orbitron, Press Start 2P, UnifrakturCook, Pirata One, DotGothic16, Dela Gothic One, Zen Antique — see `src/renderer/fonts/LICENSES.txt`): *Cyber Katakana*, vertical *Tokyo* mincho, *Y2K Chrome Bubble* (multi-stop chrome gradient + double outline), *Techno Spec Sheet*, *Pixel Dialog*, *Gothic Drop*, *Digicam Date Stamp*, *REC Overlay*… Text now supports **vertical writing** (top-to-bottom columns, right-to-left) and multi-stop gradients. Japanese fonts are subset to kana + JIS level-1 kanji, so rare kanji fall back to a system font.
- **Looks tab → adjustment layers:** an *adjustment layer* is a clip with no picture whose effects grade everything beneath it (opacity blends it, drag its edges to cover a section). Presets: Digicam 2002, Chrome Haze, Frutiger Aero, Cyber CRT, Flash Camera, Glints, Mall Tape. New **Glints** effect draws star-shaped sparkle rays on highlights.
- **v0.2.2 effects:** *Dither* (Bayer ordered dither: 1-bit, handheld green, amber terminal, ink-on-paper), *Holo Foil* (liquid iridescent foil that lives on the picture), *Kaleidoscope*, *Spores* (floating light that is lit by the scene), *Cells* (glass membrane cells that refract the footage), *Viewfinder HUD* (REC badge, counting timecode, focus frame / rotating target lock, thirds grid). New adjustment-layer looks: Anamorphic Night, Holo Foil, Handheld 1-bit, Amber Terminal, Camcorder, Thermal Lock, Kaleido Trip.
- **Organic, rebuilt around the footage:** new **Veins** effect (Glow / Refract / Invert / Cutout) grows in from the top, bottom, side, centre or all edges, takes its light from the picture and bends it, and can be bound to the beat. *Veins* can now **cling to the picture's own edges**. The Organic tab now leads with one-click adjustment layers (Veins ×7, *Spores · Bioluminescent*, *Cells · Glass*, *Lichen Bloom* = veins + cells + spores); the old stand-alone generators are below.

## v0.3.0 — editing basics, 3D, and a big preset library

- **Preset library** *(removed again in v0.4.0 — the Looks tab, the effect presets menu in the Inspector and the typography presets cover it)*: 142 ready-made looks grouped Y2K / Street / Cinematic / Glitch / Retro / Dream / Organic / 3D / Beat / Clean / Effects, searchable ("vhs", "chrome", "beat"…). Most are chains of 3–5 effects (a grade + bloom + grain + a signature effect). Click a preset to append its whole chain to the selected clip (one Undo removes it), or press **Layer** to apply it as an adjustment layer over everything below. The *Beat* group is audio-reactive (needs music analysed in the Audio-Reactive tab).
- **Reverse** (timeline toolbar): plays the selected clip backwards, picture and sound. It renders a reversed copy of just the part of the file the clip uses (in short chunks so long clips don't exhaust memory), adds it to the Library as "… (reversed)" and points the clip at it; Undo restores the original. Needs a little time and disk for long clips.
- **Freeze** (timeline toolbar, 1/2/3/5 s): cuts the clip at the playhead, slides the rest of that track later, and holds the exact source frame (full resolution, no effects baked in) as a still clip that keeps the clip's look.
- **Flip** horizontal/vertical, and **Crop** (an effect: per-side insets, rounded corners, feather) for letterboxing or reveals.
- **3D, two ways.** (1) *Any* clip gets **3D tilt / 3D turn / 3D perspective** in the inspector (keyframable): the picture becomes a plane in perspective, e.g. a card flip. (2) The **3D Object** effect raymarches a real shape — cube, sphere, torus, rounded cube, capsule, octahedron — lit and shaded, with the picture wrapped on it (*Footage*), or *Chrome*, *Glass* (bends what is behind it), *Wireframe*, or *Holo*; spin it, move it, keep or dim or remove the background. **Retro Grid Floor** draws the synthwave horizon, sun and rushing grid. Presets: *3D · Footage Cube, Chrome Sphere, Glass Torus, Wire Cube, Holo Pill, Synthwave Grid*, and more under the **3D** tab of Presets. The 3D object is a shader (no mesh import yet): shapes are the built-in set, and it shows one object per effect (stack two effects for two).
- Honest limits: the 3D Object has no cast shadows or real depth-of-field, glass is a screen-space approximation, and reversed/frozen media are cached in the app data folder (they are ordinary Library items and are saved with the project's path).

## v0.3.1 — direct manipulation, a real timeline, render range

- **Preview editing:** click a title or picture in the monitor to select it (titles are matched by the box around their letters, so the gaps between words count; the topmost one wins), **drag** to move it — every selected title/picture moves together, a position that is animated keeps its path, it snaps to the frame's centre lines (hold **Alt** to disable) — drag the **corner handle** to scale, **double-click** a title to edit its words, click empty space to deselect. A drag is one undo step. Generators and adjustment layers are not clickable in the monitor (they cover the whole frame); select them on the timeline.
- **Timeline like an editor:** Ctrl/⌘/Shift-click adds to a selection; **drag a rubber band** on empty lane space to select (Shift adds); **⌘/Ctrl+A** selects every clip, **Esc** clears. Dragging a selection moves all of it **together, across tracks** (the clip you grab decides the row offset; only compatible rows are allowed), snaps to clips, the playhead, beats and the render range with a guide line, scrolls the timeline when you reach an edge, and refuses a drop that would overlap another clip instead of freezing. While you drag, nothing is rebuilt — only the clips move — and one Undo reverts the whole move.
- **Render range:** press **I** / **O** (or *[ In* / *Out ]* in the timeline toolbar) to mark where rendering starts and ends; the stretch is shaded on the ruler and the flags can be dragged. In the Export dialog *Render only the marked range* is ticked automatically; the video starts at the In point and the sound is cut to the same window (effects, text animation and audio-reactive values are evaluated at their true timeline time, not restarted). **Alt+X** clears the range. The range is saved with the project.

## v0.3.2 — readable titles, fades, calmer kaleido

- **Halo (readability)** in the text inspector: a soft dark glow behind the letters (not a hard outline) that keeps a title legible over busy footage such as full-frame Organic veins. Presets *Brand Title (halo)* and *Brand Sub (halo)*.
- **Fade looks** (Looks tab): *Fade out to black*, *Fade in from black*, *Fade out to white* place themselves — out covers the last 1.5 s, in covers the first 1.2 s — as an adjustment layer you can drag or trim.
- *Lucid Kaleido* and *Kaleido Trip* bloom thresholds raised so the opener no longer clips to white.

## v0.4.0 — masks, speed ramps, Hindi type, an underground toolkit

- **Masks** (Inspector → *Mask*): add a rectangle, an ellipse or **draw your own polygon** by clicking points on the picture (Enter or a click on the first point closes it; Backspace removes the last point, Esc cancels). Drag a shape to move it, drag its handles to resize, drag polygon points, double-click an edge to add a point and a point to remove it. *Cut* turns a shape into a hole. **Feather**, **Grow/shrink**, **Invert**, and the mask's **X / Y / scale / rotation** are keyframable, so one mask can follow a subject across the clip. Works on any clip — and on an *adjustment layer* it limits where a look applies. Limits: individual polygon points are not animated (move/scale/turn the mask instead), and the mask is in frame space, not tied to the clip's own position.
- **Track matte** (Inspector → *Matte*): let another clip decide what shows — its **shape (alpha)** or its **brightness (luma)**, optionally inverted. A title as a window onto footage, a picture as a luma wipe. The matte clip is not drawn itself.
- **Speed ramp** (Inspector → *Speed ramp*, video clips): a graph of playback speed over the clip. Pick a shape (*slow-mo dip, hit and slide, whip up, freeze-ish end, ease in*), **Pulse on beats**, or click/drag your own points (double-click removes). The retime is exact in preview and export; splitting and trimming a ramped clip keep the picture continuous (a cut inside an easing is re-drawn through sampled points, a hair of error). **The ramped clip's own sound is left out** — continuous time-stretching of audio is not built; let the music carry the edit. Slow parts repeat source frames (like any retime); there is no frame blending.
- **Hindi (Devanagari) type:** ten bundled OFL faces — *Rozha One, Yatra One, Modak, Tiro Devanagari Hindi, Eczar, Teko, Khand, Kalam, Amita, Martel* — each with a Latin face so mixed Hinglish lines stay in one family; 12 text presets. Text is split into **conjunct-aware clusters** (क्ष, त्रि stay whole) for per-letter animations, and **no letter-spacing is ever added to Devanagari** (it would break the headline bar). The sample words in presets are common Hindi words; have a native speaker check anything you publish. Fonts without Devanagari fall back to the system's Devanagari font.
- **Underground / street toolkit:** fonts *Anton, Permanent Marker, Special Elite, Rubik Spray Paint, Black Ops One, Rubik Glitch, Archivo Black, Rock Salt, Bungee, Bebas Neue*; effects **Xerox** (toner streaks, halftone, ink/paper colours), **Fisheye** and **Torn paper edge**; looks *Xerox Flyer, Xerox Red, Newsprint, Fisheye Cam, Basement Flash, Night CCTV, Basement Tape, Torn Frame, Bass Drop (beat), Beat Zoom*; the **Underground** montage style. **Ad-libs on the beat** (Type tab): type your words, pick every 1/2/4/8 beats and press *Place on beats* — short pop-ups land exactly on the analysed beats (inside the render range if you set one). **Stutter** (timeline): loops the ¼ s (⅛ / ½) after the playhead ×3–×8, picture and sound, and slides the rest of the cut later.
- **Lockups:** twelve multi-font title cards (Type tab), including **3-font** ones — *Filmi poster, Mixtape cover, Spray crew, Blackletter street* — and 2-font ones (*Desi street, Modak × credit, Flyer night, Static broadcast* …). Each part is its own text clip, so every word, font, colour and position stays editable.
- **Removed:** the *05 Presets* tab (the 142-look library). Fade in/out moved to the Looks tab; effect presets in the Inspector menu are unchanged.
- **Not verified on real Mac/Windows installs** (tested end-to-end with Electron on Linux). Known limits: the mask editor edits shapes on screen only while the clip is selected and paused; ad-libs need the music analysed first.

## v0.5.0 — desi patterns and four more genres

- **Pattern effect** (Inspector → Add effect → *Pattern*): five procedural designs drawn by the shader, no pictures involved — **Mandala** (petals, rings, beads, a rose at the centre; *Detail* sets the number of petals), **Jali lattice** (the pointed arches of a carved stone window), **Rangoli dots** (dots wrapped in loops), **Paisley field**, **Truck-art frame** (a painted border of scallops and flowers). Line colour/width, fill colour, glow, rotation and a slow drift/spin are all adjustable and keyframable; *Mix* fades it over the picture. Looks: *Mandala Bloom, Jali Window, Rangoli Floor, Paisley Night, Truck-art Frame, Marigold Haze*. The designs are generic ornament; no religious symbols are used.
- **Zine / punk:** **Ransom note** text (Typography → *Ransom note* tick): every letter on its own scrap of paper in its own typeface, slightly crooked, still while it is on screen. Fonts *Rubik Distressed, Londrina Solid, Reenie Beanie, Covered By Your Grace, Courier Prime*. Looks *Zine Cut-up, Riso Pink, Riso Blue*.
- **Vaporwave / city pop:** fonts *Monoton, Shrikhand, Righteous, Audiowide* (the Japanese kicker uses the bundled pixel face); looks *Vapor Sunset, Vapor Tape, City Pop Dusk*.
- **Brutalist / Swiss:** *Space Grotesk, Space Mono, Syne, Unbounded, Big Shoulders Display*; looks *Concrete, Swiss Red*.
- **Dark / metal:** *Metal Mania, New Rocker, Cinzel Decorative, Grenze Gotisch, IM Fell English SC*; looks *Black Metal, Blood Moon, Candlelit Crypt*.
- **Lockups: 20 in all** (Type tab), eight of them with **three typefaces** — each part is its own text clip, so wording, font, colour and position stay editable. New: *Ransom zine, Cut-up, Vapor sign, Neon line, Swiss grid, Brutal wide, Black metal logo, Crypt poster*.
- **Limits:** the pattern designs are tuned by eye on Linux; at very large *Size / repeat* values the paisley and lattice cells get coarse. Not verified on real Mac/Windows installs.

## v0.6.0 — designed lockups, shapes, spiritual Hindi type

- **Lockups rebuilt as designed compositions** (Type tab). The first versions were words in a row; each lockup is now a *stack of clips* — words, ornaments (frames, rules, arches, flames, suns, tape, paper plates, hazard stripes) and, where it helps, a faint pattern layer — with grain and finish on the type. 22 lockups, most with three typefaces: *Dhyaan · gold leaf, Jyoti · flame, Moksha · arch, Satya · stone, Future sutra, Filmi poster, Truck-art desi, Mixtape cover, Xerox flyer, Ransom zine, Spray crew, Blackletter street, Vapor sign, Neon line, Swiss grid, Brutal wide, Black metal logo, Crypt poster* and the four Y2K/script originals. Every part is its own clip (own track, bottom to top), so you can delete an ornament, retype a line, swap a font, or keep only the layout. The montage title card uses a lockup's ornaments too (its sample sub-line is left out).
- **Shape clips** (Type tab → Shapes): plate/rule, ornament rule, double frame, pointed arch, disc/ring, diamond, star/sparkle, sun with rays, retro slatted sun, flame, lotus, rosette, dot row, hazard stripes, tape. They are ordinary clips — move/scale/turn/fade/keyframe them, stack effects, drag them in the preview — with an Inspector card for size, colours, outline, glow, shadow and a slow spin.
- **Hindi, spiritual and niche:** new faces *Inknut Antiqua* (carved), *Tillana* (brush), *Dekko* (hand-drawn), *Jaini* (cut stone), *Sarpanch* (angular, techno), *Gotu* (soft), *Kurale* (calligraphic); presets with a gold-leaf, stone or flame finish for **ध्यान, शांति, ज्योति, सत्य, मोक्ष, साधना, मौन, भविष्य**. The stiffest earlier presets were removed. These are ordinary words (meditation, peace, flame, truth, liberation, practice, silence, future); no deity images and no sacred symbols are drawn. Have a native speaker check anything you publish.
- **Pattern v2:** five more designs — *Lotus mandala, Henna vines, Diya row, Zari border, Torana garland* — and **Gold-leaf shading** (a *Foil* control that makes the line catch light unevenly). New looks *Foil Mandala, Lotus Bloom, Henna Vines, Diya Garden, Zari Border, Torana Garland* and **Mandala Pulse (beat)** (glow and size follow the music).
- **Limits:** lockups are composed for 16:9; on a vertical frame the text fits by width and ornaments keep their frame proportions, so check and adjust. Not verified on real Mac/Windows installs.

## v0.7.0 — Mutate (a variation engine for looks)

A **Mutate** tab: select a clip, press Roll, get 4, 6 or 9 variations of its effect chain drawn on the real frame, with an A/B wipe.
Seeds make every roll reproducible; effects or single values can be locked; DNA (saved looks with their seed and lineage) lives in the
project and exports as `.hhdna`. Every effect now has a wet/dry mix. Details: [docs/MUTATION.md](docs/MUTATION.md).

## v0.8.0 — The Living Lab, and HDR footage

A **Living** tab: *Trace* (draw over the picture while it plays: motion, effect control, a fading line, or roots that grow along your
gesture), *Take* (perform sliders or an XY pad live; the performance becomes ordinary keyframes in one undo step), *Memory* (the new
Memory Bleed effect: Ghost, Stain, Scar, Echo, with bounded GPU history that renders the same in preview and export), *DNA* (a
deterministic identity for the whole project from its music and footage, plus a living layer whose veins grow faster in loud bars) and
*Accident* (controlled relationships between clips, previewed from copies and applied only on Keep). Details: [docs/LIVING.md](docs/LIVING.md).
Also: iPhone HDR clips are tone-mapped instead of looking washed out (below).

## HDR phone footage (iPhone HLG / PQ)

A clip shot in HDR is 10-bit BT.2020 with an HLG curve. Decoded as ordinary video it looks washed out. The app now recognises such
clips on import and tone-maps them to ordinary SDR everywhere it turns them into pictures: the preview plays an SDR proxy (always made
for HDR clips, so every platform shows the same thing), and the export, timeline thumbnails, stills, Reverse and the footage analysis
(palette, motion) tone-map as they decode. The tone map uses ffmpeg's `zscale` + `tonemap=mobius` (it keeps the exposure you shot at);
a build without those filters gets a rougher approximation. Clips imported *before* this change keep their old flat proxy: remove and
import them again.

## Updating without reinstalling

From version 0.2.0 the app updates itself **in place**: on start (and every few hours) it asks GitHub for the latest release, downloads a small checksummed bundle of the app's own code (`src/**`, a few hundred KB), and shows **Update x.y.z · Restart** in the top bar. Nothing is applied until you press it; the next start then runs the new code from the app's data folder. *Project → Updates* shows the version and has a manual *Check for updates* (also *Tools → Check for Updates…*).

- **Safe by construction** (all unit/e2e tested): the bundle must match the SHA-256 in the release, must be built for the *same shell* (same Electron version and native dependencies, otherwise the top bar says **New installer** and opens the download page), may only contain files under `src/`, and an update that did not finish starting is blacklisted — the app restarts on the code from the installer.
- **What it cannot update:** anything native (Electron itself, ffmpeg, the Whisper binding). Those need a new installer, which is rare. You need to install 0.2.0 once; earlier builds have no updater.
- **How a release is made:** push a tag `vX.Y.Z`. CI builds the installers (version taken from the tag) and `scripts/make-update.mjs` builds `update.json` + `hhlab-update-X.Y.Z.json.gz`; all of it is attached to the GitHub Release, and installed apps pick it up.
- **Trust:** the checksum protects against corrupt downloads, not against a compromised repository — the update is exactly as trusted as the release it comes from. No code signing is involved (there is no Developer ID), so macOS does not treat the swapped-in code as a new app.
- **Not yet verified on real installs:** the mechanism is tested end-to-end with Electron on Linux (staged update runs, broken update rolls back, tampered download rejected, GitHub check against a local fake). It has not been run from a macOS/Windows installer. Set `HHLAB_NO_UPDATES=1` to turn it off.

## Visual identity

The interface follows a written art direction — soot-black and bone with forest/moss greens, italic-serif headlines, a root-line motif,
restrained motion that stops during playback and respects reduced-motion — and keeps the editing surfaces neutral and dense.
See [`docs/DESIGN.md`](docs/DESIGN.md) for the tokens, type, motif, motion rules and where each piece lives. Fonts are bundled
(SIL OFL, `src/renderer/fonts/LICENSES.txt`).

## Using it

1. **Import** media (button, ⌘/Ctrl+I, or drop files on the left panel). The first video into an empty project
   becomes V1 and sets the project size and frame rate. Files Chromium can't decode (e.g. ProRes) get an automatic H.264 proxy.
2. **Edit** on the timeline: drag clips (also between tracks), drag clip edges to trim, **drag a track's ⠿ grip (or use ▲▼) to reorder tracks** — audio can sit above video, and the video rows' order decides what draws on top; double-click a track name to rename it, × removes an empty extra track, `S` splits at the playhead,
   `Delete` removes, `+`/`−` zoom, `Space` plays. Drag media from the bin onto a track, or double-click to append at the playhead. ⌘/Ctrl+Z undoes.
3. **Effects**: select a clip → Inspector → *Effects chain*. Add, reorder (↑↓), disable, remove; start from a preset or save your own chain.
4. **Typography**: left panel → *02 Type*: presets or a blank text clip; edit font, size, spacing, alignment, colour, outline, plate, animation.
5. **Organic**: left panel → *03 Organic*: one-click *Veins* layers that grow on your footage, plus stand-alone root network / fluid bands / cell membrane generators. *04 Looks*: Y2K adjustment layers.
6. **Keyframes**: next to every numeric parameter, `◇` sets a key at the playhead (editing a keyed parameter auto-keys; Shift-click clears).
7. **Audio-reactive**: *Audio-Reactive* tab → *Analyze project audio*, then press `∿` beside any parameter and choose a signal
   (`rms`, `bass`, `mid`, `high`, `beat`) and amount.
8. **Export**: Export ▸ → resolution, frame rate, quality, format (H.264/AAC `.mp4` or VP9/Opus `.webm`) → Render.

## Feature status

Legend: ✅ works and is covered by the automated tests · 🧪 prototype (works, rough edges) · ⛔ not implemented

| Area | Status | Notes |
|---|---|---|
| Import video / audio / image | ✅ | ffprobe metadata, drag & drop, auto H.264 proxy when Chromium can't decode |
| Preview + transport | ✅ | play/pause/seek/frame-step/loop; playback is clock-driven with audio-element sync |
| Multitrack timeline | ✅ | tracks add/mute/hide, place/move/trim/split/delete/duplicate, copy & paste, shift-click multi-select with group move, ripple delete, video thumbnails + audio waveforms, beat markers, snap to clips/playhead/beats, **Cut on beats**, zoom, undo/redo (100 steps) |
| Project save / open | ✅ | `.hhlab` JSON, atomic write, validation, missing-media detection, relink, **autosave + crash recovery** (offered on next start) |
| Effects (34, incl. Glints, Veins, Dither, Holo Foil, Kaleidoscope, Spores, Cells, Viewfinder HUD, Crop, 3D Object, Retro Grid Floor): glitch, grain, cloud noise, wave distortion, fluid warp, blur, colour, CRT, lens chromatic, bloom, film 35mm, VHS, mosh/smear, halftone, pixelate, camera shake/punch, colour flash, **gradient map (duotone), xerox threshold, solarize/channel swap, slice bars, shape mask (circle/rect/diamond/blob), die-cut sticker outline** | ✅ | stack/reorder/enable/remove; 19 built-in presets (Xerox Photocopy, Comic Flash, Die-Cut Sticker, Circle Window, …) (some audio-bound, e.g. *Beat Punch*) + user presets (stored in browser storage) |
| Typography | ✅ / 🧪 | text clips with font/size/tracking/align/position/rotation/outline/plate, chrome gradient fill, RGB split, shadow, glow, hollow outline text, fit-to-width and 14 animations (slam, stutter, strobe, per-letter rise, wave, decode/scramble) ✅; **save current frame as PNG** ✅; fonts come from the installed-font list (typed or picked) — no live font preview 🧪 |
| Keyframes | 🧪 | per-parameter keys with smooth interpolation, shown on timeline clips; no curve editor, no per-key easing choice, no dragging keys on the timeline |
| Organic engine | 🧪 | **drawn root systems** (branching, tapering, growing from top/bottom/left/centre) plus contour, topographic-fluid, cell-membrane and dust generators; keyframable *Growth*, hand-drawn boil, overlay blend; look is still being tuned |
| Audio-reactive | ✅ / 🧪 | amplitude, 3 bands, beat detection and tempo estimate ✅; analysis is whole-mix only (no per-clip source choice), fixed 60 Hz, beats are simple spectral flux 🧪 |
| Clip speed, fades, cut-in transitions (flash/punch/glitch/whip) | ✅ | constant speed with pitch kept; picture + sound fades |
| Smart auto-montage (footage analysis + music structure + styles) | ✅ | see *Smart auto-montage*; heuristic, not generative AI; classic random montage still available |
| Caption editor + vocabulary, chunked/cleaned Whisper input | ✅ (accuracy gain unmeasured) | editor, learning and chunking are tested; the Whisper accuracy improvement itself is unverified on real recordings |
| TikTok Auto-Edit (Thai captions, jump cuts, 9:16, loudness) | ✅ / 🧪 | everything except live Whisper transcription is tested end-to-end; transcription accuracy on real Thai speech needs your feedback 🧪 |
| Export | ✅ | H.264/AAC and VP9/Opus, 6 resolutions (+project), 24–60 fps, 3 quality levels, progress/ETA, cancel, errors surfaced, output re-probed before "success" |
| Preview audio | 🧪 | each clip plays through its own media element; no master mixer, meters or waveforms |
| Packaging for macOS/Windows | 🧪 | Built by GitHub Actions for macOS arm64/x64 and Windows. macOS app is **ad-hoc signed** (no Developer ID/notarization), so the first launch needs right-click → Open. If macOS says it is "damaged": `xattr -cr "/Applications/HIGH HUMAN LAB - VISUAL EDITOR.app"`. Not yet confirmed running on a real Mac |
| Reverse playback, speed ramps (variable speed), crossfade transitions between overlapping clips | ⛔ | constant speed (0.1–4×) and fade in/out are done |
| Hardware-accelerated decode/encode for export | ⛔ | software decode + x264 only (see roadmap) |
| AI features | ⛔ | intentionally deferred |

### Known limitations

* Export decodes sources with ffmpeg (sequential frames, original file) and renders through WebGL; speed is then bounded by GPU readback + IPC. On the software-GL test sandbox 640×360 renders at roughly 10–20 frames/s; real GPUs are faster.
* If media moves, use **Relink…** on the missing item in the media bin.
* Timeline thumbnails use keyframes only (fast), so sparse-keyframe files show repeated thumbnails.
* Proxies are used for *preview* of files Chromium can't decode; exports always read the original file.
* Audio is mixed at 48 kHz stereo on export; mono/surround sources are up/down-mixed.

## Testing

`npm test` runs 143 unit tests. `scripts/e2e.mjs` (66 checks) is a real end-to-end run of the Electron app (see table above): it
generates test media with ffmpeg, drives the app, reads pixels out of the compositor, and probes exported files.
Native file dialogs are stubbed at the Electron main-process level; every other path is the production code.

## Recipes

Step-by-step looks (xerox/halftone, die-cut stickers, hollow glitch type, beat-cut montage, 9:16 export) in Thai: [docs/RECIPES.th.md](docs/RECIPES.th.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).
