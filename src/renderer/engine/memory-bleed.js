// Memory Bleed on the GPU: per-effect state that survives between frames, kept small and bounded.
//
//  * the memory lives in textures at a fraction of the picture size (scale 0.5 by default; the preview lowers it when it stutters),
//    so a memory costs about a quarter of one frame buffer per texture — and nothing is ever read back to the CPU;
//  * a memory needs 2 textures (Ghost, Stain), 4 (Scar: plus the previous picture), 7 (Echo: plus five snapshots); at most MAX_STATES
//    memories exist at once, further ones simply pass the picture through;
//  * textures come from a small pool and go back to it the moment a clip or effect stops being drawn (endFrame prunes), on a seek that
//    changes their size, on resize and on dispose; liveTextures counts every texture created and not yet deleted.
// The shader (EFFECT_FRAG.memory) and the frame rules (shared/living/memory-plan.js) are what make preview and export agree.
import { planMemoryFrame, pickEchoes } from '/shared/living/memory-plan.js';
import { VERT_QUAD, FRAG_COPY } from './shaders.js';

export const MAX_STATES = 8;
export const RING = 5; // Echo snapshots kept; the shader shows the newest four that are older than the frame being drawn
const POOL_CAP = 6;

export class MemoryBleed {
  constructor(comp) {
    this.comp = comp;
    this.states = new Map();
    this.pool = new Map();
    this.scale = 0.5;
    this.frame = 0;
    this.active = false; // a memory effect was drawn in the last frame
    this.overflow = false; // more memories than MAX_STATES were asked for in the last frame
    this.liveTextures = 0;
    this.nullTex = null;
  }

  // ---- textures ----
  _null() {
    if (this.nullTex) return this.nullTex;
    const gl = this.comp.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return (this.nullTex = t);
  }

  _clear(f) {
    const gl = this.comp.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); gl.viewport(0, 0, f.w, f.h);
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  _acquire(w, h) {
    const list = this.pool.get(`${w}x${h}`);
    let f = list?.pop();
    if (!f) { f = this.comp._fbo(w, h); f.w = w; f.h = h; this.liveTextures++; }
    this._clear(f);
    return f;
  }

  _release(f) {
    const key = `${f.w}x${f.h}`, list = this.pool.get(key) || [];
    if (list.length < POOL_CAP) { list.push(f); this.pool.set(key, list); } else this._destroy(f);
  }

  _destroy(f) { const gl = this.comp.gl; gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); this.liveTextures--; }

  _free(st) {
    for (const f of [st.a, st.b, st.sa, st.sb, ...(st.ring || []).map((r) => r.f)]) if (f) this._release(f);
  }

  _create(mode, hw, hh) {
    const st = { mode, hw, hh, lastT: null, step: 1 / 30, first: true, used: 0, a: this._acquire(hw, hh), b: this._acquire(hw, hh), sa: null, sb: null, ring: null, ringMeta: [], ringN: 0, lastSnap: null };
    if (mode === 2) { st.sa = this._acquire(hw, hh); st.sb = this._acquire(hw, hh); }
    if (mode === 3) st.ring = Array.from({ length: RING }, () => ({ f: this._acquire(hw, hh), t: -1 }));
    return st;
  }

  // ---- per frame bookkeeping (called by the compositor around render()) ----
  beginFrame() { this.frame++; this.active = false; this.overflow = false; }

  /** Memories of clips or effects that were not drawn this frame are forgotten and their textures returned. */
  endFrame() {
    for (const [key, st] of this.states) if (st.used !== this.frame) { this._free(st); this.states.delete(key); }
  }

  /** Forget everything (a resize makes every texture the wrong size). */
  clear() { for (const st of this.states.values()) this._free(st); this.states.clear(); }

  dispose() {
    this.clear();
    for (const list of this.pool.values()) for (const f of list) this._destroy(f);
    this.pool.clear();
    if (this.nullTex) { this.comp.gl.deleteTexture(this.nullTex); this.nullTex = null; }
  }

  // ---- drawing ----
  _copy(srcTex, dstFbo, w, h) {
    const comp = this.comp;
    const p = comp._program('memcopy', VERT_QUAD, FRAG_COPY);
    comp._targetSized(dstFbo, w, h);
    comp.gl.disable(comp.gl.BLEND);
    comp._use(p);
    comp._bindTex(srcTex);
    comp._set1i('u_tex', 0);
    comp._draw();
  }

  /** @param o {fx, src, dst (full-size buffers), clip, tl (clip time), feats, time (timeline time)} — leaves the result in dst. */
  run({ fx, src, dst, clip, tl, feats, time }) {
    const comp = this.comp, gl = comp.gl;
    this.active = true;
    const key = `${clip.id}:${fx.id}`;
    const mode = Math.min(3, Math.max(0, Math.round(Number(fx.params.mode ?? 0))));
    const hw = Math.max(32, Math.round(comp.w * this.scale)), hh = Math.max(18, Math.round(comp.h * this.scale));
    let st = this.states.get(key);
    const plan = planMemoryFrame(st, time, { mode, hw, hh });
    if (plan.action === 'reset') {
      if (st) { this._free(st); this.states.delete(key); }
      if (this.states.size >= MAX_STATES) { this.overflow = true; this._copy(src.tex, dst, comp.w, comp.h); return; } // over budget: the picture passes through
      st = this._create(mode, hw, hh);
      st.lastT = time; st.first = true; st.step = 1 / 30;
      this.states.set(key, st);
    } else if (plan.action === 'advance') {
      [st.a, st.b] = [st.b, st.a];
      if (st.sa) [st.sa, st.sb] = [st.sb, st.sa];
      st.first = false; st.step = plan.step; st.lastT = time;
    }
    st.used = this.frame;
    const advanced = plan.action !== 'redraw';
    const nul = this._null();
    const units = (prev, nw, aux, echoes) => {
      const bind = [prev, nw, aux, ...[0, 1, 2, 3].map((i) => (echoes[i] ? st.ring[echoes[i].slot].f.tex : nul))];
      bind.forEach((tex, i) => comp._bindUnit(i + 1, tex || nul));
      ['u_prev', 'u_new', 'u_aux', 'u_r0', 'u_r1', 'u_r2', 'u_r3'].forEach((name, i) => comp._set1i(name, i + 1));
    };
    const release = () => { for (let i = 1; i <= 7; i++) comp._bindUnit(i, null); }; // a texture left bound could be a render target later
    const common = (pass) => { comp._set1('u_pass', pass); comp._set1('u_first', st.first ? 1 : 0); comp._set1('u_dt', st.step); };
    const length = Number(fx.params.length ?? 1.2);

    // pass 0: update the memory at the small size (Echo keeps snapshots instead of a running memory)
    if (mode !== 3) {
      comp._runEffect(fx, src, dst, clip, tl, feats, time, {
        target: () => comp._targetSized(st.b, hw, hh),
        bind: () => { common(0); units(st.a.tex, nul, st.sa ? st.sa.tex : nul, []); },
      });
      release();
    }
    // pass 1: lay the memory over the present picture at full size
    const echoes = mode === 3 ? pickEchoes(st.ringMeta, time, length, 4) : [];
    comp._runEffect(fx, src, dst, clip, tl, feats, time, {
      bind: () => {
        common(1); units(st.a.tex, st.b.tex, st.sa ? st.sa.tex : nul, echoes);
        gl.uniform4f(comp._u('u_ages'), echoes[0]?.age ?? -1, echoes[1]?.age ?? -1, echoes[2]?.age ?? -1, echoes[3]?.age ?? -1);
      },
    });
    release();
    // afterwards: keep this picture for the next frame (Scar) or take a snapshot when its beat comes round (Echo)
    if (mode === 2) this._copy(src.tex, st.sb, hw, hh);
    if (mode === 3 && advanced) {
      const idx = Math.floor(time * Number(fx.params.rate ?? 2));
      if (idx !== st.lastSnap) {
        st.lastSnap = idx;
        const slot = st.ringN % RING; st.ringN++;
        this._copy(src.tex, st.ring[slot].f, hw, hh);
        st.ringMeta = st.ringMeta.filter((r) => r.slot !== slot);
        st.ringMeta.push({ t: time, slot });
      }
    }
  }
}
