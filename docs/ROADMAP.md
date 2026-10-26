# Roadmap

## Milestone 2 — "Fast and trustworthy renders" (recommended next)

The MVP exports correctly but export speed and large-footage handling are its weakest point.

1. **ffmpeg decode pipeline for export.** Decode each video clip with ffmpeg (`-ss` once, then sequential rawvideo
   frames over a pipe) instead of seeking `<video>` per frame. Removes the per-frame seek cost on long-GOP/4K footage,
   fixes VFR drift, and removes the need for proxies in export (proxies stay for preview only).
2. **Worker-side readback + pipelining.** `readPixels` through a PBO and a 2–3 frame in-flight queue to overlap GPU, IPC and x264.
3. **Hardware encoders** where available (VideoToolbox on macOS, NVENC/QSV/AMF on Windows) behind a "fast" quality option.
4. **Real preview audio mixer** (Web Audio graph): sample-accurate sync, per-track meters, fades, waveform thumbnails.
5. **Packaging CI**: GitHub Actions matrix building macOS and Windows installers, running `npm test` and the e2e suite on each OS; code signing + notarization.

## Milestone 3 — Editing depth

Multi-select, copy/paste, ripple/roll edits, transitions (cross-dissolve + glitch cuts), speed ramps and reverse,
audio fades, timeline thumbnails and waveforms, relink-missing-media dialog, markers (including beat markers from the analysis,
with "snap to beat"), keyframe lane editor with per-key easing, nested effect presets.

## Milestone 4 — Lab depth

* Typography: system font browser, per-character/word animators, text on a path (roots!), variable fonts, mask reveals.
* Organic engine: reaction–diffusion and L-system root growth (stateful, GPU ping-pong), mesh warps, feedback loops, custom GLSL effect slot with hot reload.
* Audio: per-source reactive routing (stems), onset types (kick/snare via band-split flux), sidechain-style smoothing, MIDI/OSC input, offline BPM grid editing.
* Presets: shareable preset packs (`.hhpack`), project templates.

## Deliberately deferred

AI features (auto-captions, stem separation, generative video) — they only make sense once the editing and render core is dependable.
