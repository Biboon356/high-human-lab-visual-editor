// The decisions behind Memory Bleed that do not need a GPU, so they can be tested exactly.
//
// Memory Bleed is the one effect whose result depends on earlier frames. To keep preview and export agreeing, a memory only ever grows
// from consecutive frames: a seek (backwards, or forwards by more than MEMORY_MAX_GAP) starts it afresh — which is precisely what an
// export that begins at that frame would do. Drawing the same frame again (a paused preview repainting) must never add to the memory.

export const MEMORY_MAX_GAP = 0.35; // seconds; larger forward jumps are seeks, not playback

/**
 * @param st   the effect's state so far, or null: {lastT, mode, hw, hh}
 * @param t    the timeline time being drawn
 * @param now  {mode, hw, hh}: what this frame needs (a change in any of them also starts afresh)
 * @returns {{action:'reset'|'advance'|'redraw', step?:number}}
 *   reset    forget everything, draw this as the first frame
 *   advance  a new frame after the previous one: the memory moves on by `step` seconds
 *   redraw   the same frame again: reuse the memory as it was before this frame
 */
export function planMemoryFrame(st, t, now) {
  if (!st || st.lastT === null || st.mode !== now.mode || st.hw !== now.hw || st.hh !== now.hh) return { action: 'reset' };
  const dt = t - st.lastT;
  if (dt < -1e-4 || dt > MEMORY_MAX_GAP) return { action: 'reset' };
  if (dt > 1e-4) return { action: 'advance', step: dt };
  return { action: 'redraw' };
}

/**
 * The snapshots Echo may bring back right now: the newest `count`, strictly older than this frame (so redrawing a frame never shows
 * its own snapshot), not yet faded away. @param ring [{t, slot}] @returns [{slot, age}] newest first
 */
export function pickEchoes(ring, t, length, count = 4) {
  return ring
    .map((r) => ({ slot: r.slot, age: t - r.t }))
    .filter((e) => e.age > 1e-4 && e.age <= length * 1.6)
    .sort((a, b) => a.age - b.age)
    .slice(0, count);
}

// ---- adaptive quality: the memory is kept at a fraction of the picture size; the preview lowers it when playback stutters ----
export const MEMORY_SCALES = [0.5, 0.35, 0.25];

export class MemoryAdapt {
  constructor() { this.i = 0; this.ema = 16; this.hot = 0; this.calm = 0; }

  get scale() { return MEMORY_SCALES[this.i]; }

  /** Feed the time between two played frames; returns the scale to use. Only reacts while a memory effect is on screen. */
  update(frameMs, active) {
    if (!active) { this.hot = 0; this.calm = 0; return this.scale; }
    this.ema = this.ema * 0.9 + frameMs * 0.1;
    if (this.ema > 45) { this.calm = 0; if (++this.hot >= 20 && this.i < MEMORY_SCALES.length - 1) { this.i++; this.hot = 0; } }
    else if (this.ema < 22) { this.hot = 0; if (++this.calm >= 240 && this.i > 0) { this.i--; this.calm = 0; } }
    else { this.hot = 0; this.calm = 0; }
    return this.scale;
  }
}
