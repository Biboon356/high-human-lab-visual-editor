// Renders a chain onto one clip of a throwaway copy of the project, small, for the Mutate grid. It uses its own compositor (the same
// pipeline as preview and export) and the preview's decoded frames, so a thumbnail shows exactly what Apply would give — including
// every layer under and over the clip — and the real project and the media are never touched.
import { Compositor } from './compositor.js';
import { chainToEffects } from '/shared/mutation/chain.js';

export class VariationRenderer {
  constructor() { this.canvas = null; this.comp = null; }

  _ensure(w, h) {
    if (!this.comp) { this.canvas = document.createElement('canvas'); this.comp = new Compositor(this.canvas, w, h); }
    else if (this.comp.w !== w || this.comp.h !== h) this.comp.resize(w, h);
  }

  /**
   * @param o {project, sources (the preview's), t, features, clipId, chain, target (a 2D <canvas> of the thumbnail size)}
   * @returns {{missing: string[]}} names of media with no frame available right now
   */
  paint({ project, sources, t, features, clipId, chain, target }) {
    const w = target.width, h = target.height;
    this._ensure(w, h);
    const clips = project.clips.map((c) => (c.id === clipId ? { ...c, effects: chainToEffects(chain) } : c));
    const r = this.comp.render({ project: { ...project, clips }, t, sources, features });
    target.getContext('2d').drawImage(this.comp.canvas, 0, 0, w, h); // same task as the render, so the drawing buffer is still valid
    return r;
  }

  dispose() { this.comp?.dispose(); this.comp = null; this.canvas = null; }
}
