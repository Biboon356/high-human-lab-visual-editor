# HIGH HUMAN LAB — visual identity

An independent fashion house, a film-and-music studio and a design laboratory, as software. The interface is a cultural object
first and a dashboard never. The references are *attitudes*, not assets: the luxury-streetwear editorial eye (A$AP Rocky's circle),
industrial minimalism and architectural restraint (Kanye West's design world), playful, unexpected colour (Tyler, The Creator's art
direction). No logos, artwork or layouts from any of them are used. Everything here is original.

## The split that keeps it usable

| Surface | Job | Treatment |
|---|---|---|
| **Brand surfaces** — top bar, library headers, empty states, dialogs, tooltips | Say who we are | Italic serif headlines, root-line motif, paper grain, slow background |
| **Editing surfaces** — monitor, timeline, inspector, transport | Edit video, fast | Neutral, dense, hairlines, mono numerals, no decoration, nothing animates while playing |

Rules of the house: square corners (no rounded cards), hairlines instead of boxes, numbers in mono, headlines in italic serif,
one signal colour per job, no glass, no gradients except the monitor vignette.

## Colour

Dark is the default; light is a warm-paper inversion of the same system (`[data-theme="light"]`).

| Token | Dark | Role |
|---|---|---|
| `--bg` / `--panel` / `--panel2` | `#080a08` / `#0e100d` / `#131610` | soot-black ground with a green undertone |
| `--text` | `#ece7d6` | bone, not white |
| `--dim` / `--faint` | `#8f9382` / `#5d6254` | secondary text, meta |
| `--forest` `--accent` | `#1f4a33` `#2f6a46` | fills, selected states, clips |
| `--accent2` / `--lichen` | `#93b57f` / `#c4d6b0` | lines, hover, text on dark — moss and lichen, never neon |
| `--signal` | `#d8d36a` sulphur | **time** only: playhead, keyframes, unsaved dot, loading |
| `--orchid` | `#b9a8e8` | **audio-reactive** only: bindings, level meters, audio clips |
| `--danger` | `#d9624c` | errors, missing media |

Clip colours (`--clip-video/audio/text/gen/image`) are earthy: forest, aubergine, charcoal-bone, moss, bark.

## Type

Self-hosted in `src/renderer/fonts/` (SIL OFL 1.1, see `LICENSES.txt`); Thai and Japanese fall through to the system fonts.

- **Instrument Serif** (italic): headlines, project name, empty states. The editorial voice.
- **Inter Tight** 400/500/600: interface text. Wordmark is 600 with .3em tracking.
- **DM Mono** 400/500: timecode, numbers, tabs, labels — tabular figures everywhere a number can change.

## Signature: the root-line

Two forms, used on purpose and rarely:

1. **The H mark** (`#hh-mark` in `index.html`, `--mark` in `brand.css`): two pillars joined by a crossbar that drops a rooted stem —
   human systems carrying something organic. Top bar, dialog titles, empty states.
2. **The root-line**: a hairline that ends in a forking root (`--fork`). Under each library headline, in the monitor's empty state
   (drawn on slowly), and as the end of every progress bar (a diamond node). The loading state is the same line growing.

It never appears on the monitor, the timeline or the inspector rows.

## Motion

All in `brand.css` / `styles.css`; all disabled by `prefers-reduced-motion: reduce` (the roots canvas is not even started).

- Background roots drift a few pixels against the pointer (one rAF-throttled style write) and pause while playing or exporting.
- Panel switches rise in over 360 ms; panels slide shut by animating the grid tracks.
- Hover has a character per component: buttons sweep a moss fill in from the left, library rows grow a rail and step right, tabs draw
  their underline.
- The mark draws itself on launch; the empty monitor draws its root; the dirty dot breathes.
- Paper grain is static (a tiled SVG) and lives on the chrome only, never over the monitor, so colour judgement is unaffected.

## Accessibility

Visible `:focus-visible` rings on every control (1 px lichen), custom checkboxes/radios/ranges stay native inputs underneath, icon-only
buttons get an `aria-label` from their tooltip text, tooltips also show on keyboard focus, text contrast is checked against both themes.

## Where things live

| File | What |
|---|---|
| `src/renderer/styles.css` | tokens, base controls, every component |
| `src/renderer/brand.css` | motif, grain, background, library headers, empty states, motion, tooltips |
| `src/renderer/fonts/` | fonts + `fonts.css` + licences |
| `src/renderer/ui/tooltip.js` | label + shortcut-chip tooltips (platform-aware ⌘ / Ctrl) |
| `src/renderer/index.html` | icon sprite (`#i-*`), the mark (`#hh-mark`), layout |

To add an icon: add a `<symbol id="i-name" viewBox="0 0 16 16">` (1.25 px stroke, `currentColor`, square caps) to the sprite and use
`<svg class="ic"><use href="#i-name"/></svg>`.
