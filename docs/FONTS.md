# Fonts: making new ones (a spike, not a feature yet)

Question: can the editor make a NEW font from a bundled one, so an artist gets a typeface that is theirs, including for Thai?
Answer so far: yes for TrueType-outline fonts, by changing only the outlines and leaving the shaping rules alone. This is a tested building block
(`src/shared/fonts/sfnt.js`, `test/fonts.test.mjs`, the e2e step "Font spike"), with no UI.

## What the spike does
* Reads a WOFF 1.0 or plain TTF font, changes every glyph outline with a function (`skew(k)` slants, `roughen(amount, seed)` wobbles), writes a plain TTF.
* `cmap`, `GSUB`, `GPOS`, `GDEF`, `OS/2`, `gasp` are copied byte for byte (a test checks it), so the rules that place Thai vowels and tone marks are untouched.
  `glyf`, `loca`, `head`'s box, `hhea`'s extents and `hmtx`'s left side bearings follow the new outlines; advance widths are unchanged.
* The font is renamed (OFL: a changed font gets its own name); copyright and licence text are kept.
* In the real Chromium of the app (software GL), the written fonts load (its sanitiser checks the tables), an unchanged outline draws like the original, and Thai tone marks,
  upper and lower vowels still sit above and below their consonants in every variant. A skewed font carries composite glyphs along.

## What it does NOT do (and what is unknown)
* **No Thai font is bundled.** The 74 bundled families are Latin and Devanagari subsets in WOFF2; Thai text uses the computer's own fonts, which we may not change
  and redistribute. A Thai mutation needs an OFL Thai font to be bundled first (for example Noto Sans Thai: OFL, small as a subset). That is a decision for the owner.
* **WOFF2 input is not read** (its glyph table is stored in a transformed form). The bundled fonts would need to be shipped as WOFF/TTF as well, or a WOFF2 decoder
  added. Only the few fonts offered for mutation would need it, not all of them.
* TrueType outlines only: `.otf` with CFF outlines is refused with a plain message. Hinting instructions are dropped (the outlines changed, the old instructions no longer fit).
* **Only two moves exist**, and `roughen` at a gentle amount is nearly invisible at normal sizes. A real feature needs more characterful moves (stencil cuts, ink traps,
  melting, hand-cut corners, weight) and a way to judge them by eye. Quality of the result as a typeface is the author's eye, not measured.
* Never tried on a real Mac or Windows machine; only the rendering of one Thai and one Latin subset was checked here. Fonts with unusual composite or variable tables are untested.
* Licences: the bundled fonts are OFL 1.1, but each family's "Reserved Font Name" has not been checked. Before any release the licence text of every font offered for mutation must be read.

## If it becomes a feature
Keep the artist in control like everything else: a "Font lab" where a recipe (base font, move, strength, seed, name) is previewed on the artist's own title, applied as one Undo step,
and saved in the project as the recipe (small, reproducible) rather than as a font file; the font is rebuilt when the project opens. Text clips would refer to the font by name.
Export uses the same renderer, so it matches what is seen.
