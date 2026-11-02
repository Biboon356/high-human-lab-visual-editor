# HIGH HUMAN LAB — VISUAL EDITOR: notes for Claude

Electron desktop video editor (macOS and Windows; Linux is only the test harness) for musicians, music-video makers and TikTok
creators. The owner writes **Thai: reply in Thai** (keep technical identifiers in English). Be honest about limits: nothing has been run on
a real Mac or Windows machine (CI only proves the installers build), GPU timing was never measured (software GL), and thresholds for
suggestions/curation are guesses, not tuned by real use.

## How a release goes (the owner's workflow — keep to it)

1. Work on a feature branch (`feat/vX.Y.Z`), commit often and push it (a stop hook asks for commit + push).
2. When unit tests and the **full** e2e pass, fast-forward `feat/mvp-visual-editor` (PR #1, the release target) and push it. CI runs.
3. The owner types **"cl"**: check CI (`pull_request_read get_check_runs`, PR #1, owner `Biboon356`, repo `high-human-lab-visual-editor`).
   When test + the three builds (macOS arm64 on `macos-15`, macOS Intel, Windows) are green, give the link
   `https://github.com/Biboon356/high-human-lab-visual-editor/releases/new?tag=vX.Y.Z&target=feat/mvp-visual-editor&title=vX.Y.Z`
   and a Thai release description (the owner pastes it into the Description box).
4. **The owner** publishes the release. **Never create tags, releases or pull requests yourself.**
5. The owner says **"เรียบร้อย"**: check the release has 5 assets: `HIGH-HUMAN-LAB-X.Y.Z-mac-arm64.dmg`, `-mac-x64.dmg`, `-win-x64.exe`,
   `update.json`, `hhlab-update-X.Y.Z.json.gz` (the tag run takes ~4–5 minutes; `get_release_by_tag`).
* `macos-14` jobs were cancelled without a runner for hours (v0.9.0); the workflow now uses `macos-15` for arm64.
* Version is in `package.json`; README has one section per release; `docs/` has MUTATION.md, LIVING.md, CREATIVE.md.

## Tests

* Unit: `node --test test/*.test.mjs` (≈241 tests).
* End to end (real Electron, software GL, ≈80 steps, ≈12 min): `xvfb-run -a -s "-screen 0 1700x1000x24" npm run test:e2e`.
  Run it in the background (`nohup … > log &`) and poll the log; wait with `sleep 30; while ps aux | grep '[n]ode scripts/e2e.mjs' >/dev/null; do sleep 10; done`.
  **Never** `pkill -f` / `pgrep -f` with a pattern that matches your own shell command line (it kills the shell, exit 144).
* `HHLAB_ONLY='regex'` runs only matching steps; steps that depend on earlier ones can fail when filtered, so verify with the full run.
* Gotchas in the e2e: the page's CSP forbids `new Function` in `page.evaluate`; app modules are served under `hhlab://local/app/`
  (use `import('./creative/engine.js')`, shared ones under `/shared/…`); localStorage persists between runs (a failed run can leave a switch
  such as `hhlab.living.loop` in the wrong state); `resetProject()` also opens every `details.liv-adv` ("Advanced"); the Take pad must be
  scrolled into view before dragging; console-error assertions print the offending messages.

## Architecture in one screen

* `src/main` (Electron main, ffmpeg, whisper, footage analysis), `src/renderer` (UI, WebGL2 compositor shared by preview, export and
  thumbnails), `src/shared` (pure, tested logic). State: `renderer/store.js` (pub/sub, JSON-snapshot undo; `showGhost/commitGhost` preview).
* Effects: GLSL in `renderer/engine/shaders.js` + parameter definitions in `shared/effects-defs.js` (39 effects). Automation: keyframes
  `{t,v}` in clip-relative seconds, audio-reactive bindings.
* **Mutation Engine** `shared/mutation/*` (Mutate tab, DNA library, `.hhdna`). **Living Lab** `shared/living/*`, `renderer/living/*`
  (Trace, Take, Memory Bleed, Project DNA, Accident). **Creative Memory Engine** `shared/creative/*` + `renderer/creative/engine.js`
  (observe → context → decide; Still Here shelf `project.stillHere` kept outside undo; Living Timeline FOLLOW/GROW FROM/REMEMBER/BECOME;
  Decision Gate). Read docs/CREATIVE.md and docs/LIVING.md before changing them.
* Rules the owner set: don't rebuild working systems — audit, reuse, extend; the artist stays in control (nothing creative applied without
  a preview or an undo step); stay silent when not confident; if an intelligence feature fails, the editor must carry on.

## Where things stand

* Released: v0.9.1 (loop while recording, Accident at the playhead and on groups, Quick Start layout). **v0.9.2 in progress**
  (branch `feat/v0.9.2`): loop playback of the marked In/Out range (Space/Enter restart at the In point; Enter otherwise returns to where
  play started) and PREVIEW in the monitor for Memory, signature look, Make my look, Accident, TIMELINE, BRING BACK and suggestions.
* Known to tune: Ghost/Stain default `screen` blend washes out bright footage; a suggestion can pop up while a TIMELINE plan card is open;
  Take/Trace work on one clip only (no group); curator/gate thresholds untested on real use; clips imported before the HDR fix keep a flat proxy.
* Ideas not built: Root-Letters (roots out of letters), Living Score, per-section looks, palette lock from album art, Look Card, Human Groove,
  Lyric Alchemy, MIDI for Take.
