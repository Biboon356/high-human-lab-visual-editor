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

## Using it

1. **Import** media (button, ⌘/Ctrl+I, or drop files on the left panel). The first video into an empty project
   becomes V1 and sets the project size and frame rate. Files Chromium can't decode (e.g. ProRes) get an automatic H.264 proxy.
2. **Edit** on the timeline: drag clips (also between tracks), drag clip edges to trim, `S` splits at the playhead,
   `Delete` removes, `+`/`−` zoom, `Space` plays. Drag media from the bin onto a track, or double-click to append at the playhead. ⌘/Ctrl+Z undoes.
3. **Effects**: select a clip → Inspector → *Effects chain*. Add, reorder (↑↓), disable, remove; start from a preset or save your own chain.
4. **Typography**: left panel → *02 Type*: presets or a blank text clip; edit font, size, spacing, alignment, colour, outline, plate, animation.
5. **Organic**: left panel → *03 Organic*: root network / fluid bands / cell membrane generators with density, movement, distortion, thickness, glow and green-mix controls.
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
| Multitrack timeline | ✅ | tracks add/mute/hide, place/move/trim/split/delete/duplicate, copy & paste, video thumbnails + audio waveforms, beat markers, snap to clips/playhead/beats, **Cut on beats**, zoom, undo/redo (100 steps) |
| Project save / open | ✅ | `.hhlab` JSON, atomic write, validation, missing-media detection, relink |
| Effects (23): glitch, grain, cloud noise, wave distortion, fluid warp, blur, colour, CRT, lens chromatic, bloom, film 35mm, VHS, mosh/smear, halftone, pixelate, camera shake/punch, colour flash, **gradient map (duotone), xerox threshold, solarize/channel swap, slice bars, shape mask (circle/rect/diamond/blob), die-cut sticker outline** | ✅ | stack/reorder/enable/remove; 19 built-in presets (Xerox Photocopy, Comic Flash, Die-Cut Sticker, Circle Window, …) (some audio-bound, e.g. *Beat Punch*) + user presets (stored in browser storage) |
| Typography | ✅ / 🧪 | text clips with font/size/tracking/align/position/rotation/outline/plate, chrome gradient fill, RGB split, shadow, glow, hollow outline text, fit-to-width and 11 animations (incl. slam, stutter, strobe) ✅; fonts come from the installed-font list (typed or picked) — no live font preview 🧪 |
| Keyframes | 🧪 | per-parameter keys with smooth interpolation, shown on timeline clips; no curve editor, no per-key easing choice, no dragging keys on the timeline |
| Organic engine | 🧪 | three procedural generators (roots, topographic fluid, cell membrane) drawn as crisp constant-width lines with a keyframable *Growth* front, glow, overlay blend on footage; look is still being tuned |
| Audio-reactive | ✅ / 🧪 | amplitude, 3 bands, beat detection and tempo estimate ✅; analysis is whole-mix only (no per-clip source choice), fixed 60 Hz, beats are simple spectral flux 🧪 |
| Export | ✅ | H.264/AAC and VP9/Opus, 6 resolutions (+project), 24–60 fps, 3 quality levels, progress/ETA, cancel, errors surfaced, output re-probed before "success" |
| Preview audio | 🧪 | each clip plays through its own media element; no master mixer, meters or waveforms |
| Packaging for macOS/Windows | 🧪 | electron-builder config present; **not built or signed here** (needs each OS; no code-signing/notarization set up) |
| Transitions, speed/reverse, audio fades, multi-select, ripple edit | ⛔ | |
| Hardware-accelerated decode/encode for export | ⛔ | software decode + x264 only (see roadmap) |
| AI features | ⛔ | intentionally deferred |

### Known limitations

* Export decodes sources with ffmpeg (sequential frames, original file) and renders through WebGL; speed is then bounded by GPU readback + IPC. On the software-GL test sandbox 640×360 renders at roughly 10–20 frames/s; real GPUs are faster.
* If media moves, use **Relink…** on the missing item in the media bin.
* Timeline thumbnails use keyframes only (fast), so sparse-keyframe files show repeated thumbnails.
* Proxies are used for *preview* of files Chromium can't decode; exports always read the original file.
* Audio is mixed at 48 kHz stereo on export; mono/surround sources are up/down-mixed.

## Testing

`npm test` runs 12 unit tests. `scripts/e2e.mjs` (30 checks) is a real end-to-end run of the Electron app (see table above): it
generates test media with ffmpeg, drives the app, reads pixels out of the compositor, and probes exported files.
Native file dialogs are stubbed at the Electron main-process level; every other path is the production code.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).
