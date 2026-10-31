// WebGL2 compositor shared by the live preview and the exporter, so the render matches the preview.
// Per frame: for each visual clip (bottom track first) -> draw source into layer buffer A
// -> run the effect chain ping-ponging A<->B -> blend onto the accumulation buffer -> blit to canvas.
import { VERT_QUAD, VERT_LAYER, FRAG_LAYER, FRAG_BLIT, FRAG_WET, EFFECT_FRAG, GEN_FRAG } from './shaders.js';
import { activeVisualClips } from '/shared/timeline.js';
import { findMedia } from '/shared/project.js';
import { EFFECTS } from '/shared/effects-defs.js';
import { GEN_PARAMS } from '/shared/organic-defs.js';
import { resolveParam, resolveClipProps, fadeFactor, transitionAt } from '/shared/params.js';
import { drawTextClip } from './text-renderer.js';
import { drawShapeClip } from './shape-renderer.js';
import { rasterizeMask } from './mask-renderer.js';
import { normalizeMask, normalizeMatte, canBeMatte, matteSourceIds, maskKey } from '/shared/mask.js';
import { drawRoots } from './roots-renderer.js';

const STYLE_INDEX = { roots: 0, fluid: 1, cells: 2, dust: 3 };
const hexToRgb = (h) => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export class Compositor {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available on this system, so the compositor cannot start.');
    this.gl = gl;
    this.programs = new Map();
    this.fbos = {};
    this.textCanvas = document.createElement('canvas');
    this.textCtx = this.textCanvas.getContext('2d');
    this.srcTex = this._texture();
    this.maskCanvas = document.createElement('canvas');
    this.maskScratch = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.maskTex = new Map(); // clip id -> {key, tex}: a mask is redrawn only when something about it changed
    this.imageTex = new WeakMap();
    this.pixels = null;
    this._initQuad();
    this.resize(width, height);
  }

  _initQuad() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  _program(key, vs, fs) {
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader "${key}" failed to compile: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Shader "${key}" failed to link: ${gl.getProgramInfoLog(prog)}`);
    p = { prog, uniforms: new Map() };
    this.programs.set(key, p);
    return p;
  }

  _use(p) {
    this.gl.useProgram(p.prog);
    this.cur = p;
  }
  _u(name) {
    let loc = this.cur.uniforms.get(name);
    if (loc === undefined) { loc = this.gl.getUniformLocation(this.cur.prog, name); this.cur.uniforms.set(name, loc); }
    return loc;
  }
  _set1(name, v) { const l = this._u(name); if (l) this.gl.uniform1f(l, v); }
  _set1i(name, v) { const l = this._u(name); if (l) this.gl.uniform1i(l, v); }
  _set2(name, a, b) { const l = this._u(name); if (l) this.gl.uniform2f(l, a, b); }

  _texture() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _fbo(w, h) {
    const gl = this.gl, tex = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete at this resolution.');
    return { tex, fbo };
  }

  resize(w, h) {
    const gl = this.gl;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.textCanvas.width = w; this.textCanvas.height = h;
    for (const f of Object.values(this.fbos)) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); }
    this.fbos = { a: this._fbo(w, h), b: this._fbo(w, h), acc: this._fbo(w, h), m: this._fbo(w, h), c: this._fbo(w, h) }; // c: spare for wet/dry mixes (m is busy holding a matte while a chain runs)
    this.maskCanvas.width = this.maskScratch.width = w; this.maskCanvas.height = this.maskScratch.height = h;
    for (const e of this.maskTex.values()) gl.deleteTexture(e.tex);
    this.maskTex.clear();
    this.pixels = null;
  }

  _target(f) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fbo : null);
    gl.viewport(0, 0, this.w, this.h);
  }
  _draw() {
    const gl = this.gl;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  _bindTex(tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); }

  _upload(source) {
    const gl = this.gl;
    this._bindTex(this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return this.srcTex;
  }

  _uploadRaw(data, w, h) {
    const gl = this.gl;
    this._bindTex(this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // decoded video is opaque
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return this.srcTex;
  }

  /** t3: optional {flipX, flipY, rotX, rotY, depth} from the clip's props (degrees; depth 0..1 = how strong the perspective is). */
  _drawLayer(tex, halfW, halfH, offX, offY, rot, opacity, t3 = null, ex = null) {
    const p = this._program('layer', VERT_LAYER, FRAG_LAYER);
    this._use(p);
    this._set2('u_flip', t3?.flipX ? -1 : 1, t3?.flipY ? -1 : 1);
    this._set1('u_rx', t3 ? (t3.rotX * Math.PI) / 180 : 0);
    this._set1('u_ry', t3 ? (t3.rotY * Math.PI) / 180 : 0);
    this._set1('u_persp', this.h * (6 - 5.1 * (t3 ? Math.min(1, Math.max(0, t3.depth)) : 0.5)));
    this._bindTex(tex);
    this._set1i('u_tex', 0);
    this._set2('u_res', this.w, this.h);
    this._set2('u_half', halfW, halfH);
    this._set2('u_offset', offX, offY);
    this._set1('u_rot', rot);
    this._set1('u_opacity', opacity);
    // Sampler uniforms persist per program: an unused mask/matte sampler must point at unit 0, and a matte texture must never stay
    // bound while it is the render target (that is a feedback loop and the draw is silently dropped).
    this._set1('u_hasMask', ex?.mask ? 1 : 0);
    this._set1('u_matteMode', ex?.matte ? ex.matteMode : 0);
    this._set1i('u_mask', ex?.mask ? 1 : 0);
    this._set1i('u_matte', ex?.matte ? 2 : 0);
    if (ex?.mask) { this._set1('u_maskInv', ex.maskInv ? 1 : 0); this._bindUnit(1, ex.mask); }
    if (ex?.matte) { this._set1('u_matteInv', ex.matteInv ? 1 : 0); this._bindUnit(2, ex.matte); }
    this._draw();
    if (ex) { this._bindUnit(1, null); this._bindUnit(2, null); this._bindTex(tex); } // leave unit 0 active for the next caller
  }
  _bindUnit(n, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + n); gl.bindTexture(gl.TEXTURE_2D, tex); gl.activeTexture(gl.TEXTURE0); }

  /** Texture of the clip's rasterised mask, or null when it has none. */
  _maskFor(clip, props) {
    const mask = normalizeMask(clip.mask);
    if (!mask) return null;
    const key = maskKey(mask, props, this.w, this.h);
    let e = this.maskTex.get(clip.id);
    if (!e) { e = { key: '', tex: this._texture() }; this.maskTex.set(clip.id, e); }
    if (e.key !== key) {
      rasterizeMask(this.maskCtx, this.maskScratch, mask, props, this.w, this.h);
      const gl = this.gl;
      this._bindTex(e.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.maskCanvas);
      e.key = key;
    }
    return { tex: e.tex, inv: mask.invert };
  }

  _blend(mode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else if (mode === 'exclusion') gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR); // |a-b|-like inversion where text crosses bright areas
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _clear(f, r, g, b, a) {
    const gl = this.gl;
    this._target(f);
    gl.disable(gl.BLEND);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  _runEffect(fx, src, dst, clip, tLocal, feats, time) {
    const def = EFFECTS[fx.type];
    const p = this._program(`fx:${fx.type}`, VERT_QUAD, EFFECT_FRAG[fx.type]);
    this._target(dst);
    this.gl.disable(this.gl.BLEND);
    this._use(p);
    this._bindTex(src.tex);
    this._set1i('u_tex', 0);
    this._set2('u_res', this.w, this.h);
    this._set1('u_time', time);
    for (const d of def.params) {
      if (d.kind === 'color') { const l = this._u(`u_${d.key}`); if (l) this.gl.uniform3f(l, ...hexToRgb(fx.params[d.key] ?? d.def)); }
      else if (d.options) this._set1(`u_${d.key}`, Number(fx.params[d.key] ?? d.def));
      else this._set1(`u_${d.key}`, resolveParam(fx, d.key, fx.params[d.key] ?? d.def, tLocal, feats, [d.min, d.max]));
    }
    this._draw();
  }

  /** dst = mix(a, b, w). All three must be different buffers; unit 1 is released afterwards (a texture left bound there would be a feedback loop the next time it is a target). */
  _wetMix(a, b, dst, w) {
    const p = this._program('wet', VERT_QUAD, FRAG_WET);
    this._target(dst);
    this.gl.disable(this.gl.BLEND);
    this._use(p);
    this._bindTex(a.tex);
    this._bindUnit(1, b.tex);
    this._set1i('u_a', 0); this._set1i('u_b', 1);
    this._set1('u_w', w);
    this._draw();
    this._bindUnit(1, null);
  }

  _runGenerator(clip, tLocal, feats, time) {
    const p = this._program('gen', VERT_QUAD, GEN_FRAG);
    this._target(this.fbos.a);
    this.gl.disable(this.gl.BLEND);
    this._use(p);
    this._set2('u_res', this.w, this.h);
    this._set1('u_time', time);
    this._set1i('u_style', STYLE_INDEX[clip.gen.style] ?? 0);
    this._set1('u_transparent', clip.gen.transparent ? 1 : 0);
    for (const d of GEN_PARAMS) {
      if (d.options) continue; // enum params (e.g. root origin) only matter to the drawn styles
      this._set1(`u_${d.key}`, resolveParam(clip.gen, d.key, clip.gen.params[d.key] ?? d.def, tLocal, feats, [d.min, d.max]));
    }
    this._draw();
  }

  /**
   * Draws one clip (source -> effect chain) into the A/B buffers and returns where the result ended up, or null when
   * the clip has nothing to show this frame. The layer is not yet laid onto the frame.
   */
  _renderLayer(project, clip, t, sources, features, missing, resolved) {
    const gl = this.gl;
    const tl = t - clip.start;
    const props = resolved || resolveClipProps(clip, tl, features);
    props.opacity *= fadeFactor(clip, tl);
    const trans = transitionAt(clip, tl);
    if (trans) props.scale *= trans.scaleMul;
    let ready = false;
    const t3 = { flipX: clip.props.flipX, flipY: clip.props.flipY, rotX: props.rotX, rotY: props.rotY, depth: props.depth };
    const flat = clip.type === 'media' || clip.type === 'adjust'; // pictures tilt about their own centre when drawn; the rest tilt as a full-frame card at the end

    if (clip.type === 'media') {
      const fr = sources.frameFor(project, clip);
      if (!fr) { const m = findMedia(project, clip.mediaId); if (m) missing.push(m.name); return null; }
      const tex = fr.data ? this._uploadRaw(fr.data, fr.w, fr.h) : this._upload(fr.el);
      this._clear(this.fbos.a, 0, 0, 0, 0);
      const fit = Math.min(this.w / fr.w, this.h / fr.h) * props.scale;
      this._drawLayer(tex, (fr.w * fit) / 2, (fr.h * fit) / 2, props.x * this.w, props.y * this.h, (-props.rotation * Math.PI) / 180, 1, t3);
      ready = true;
    } else if (clip.type === 'text') {
      drawTextClip(this.textCtx, this.w, this.h, clip, tl, props);
      const tex = this._upload(this.textCanvas);
      this._clear(this.fbos.a, 0, 0, 0, 0);
      this._drawLayer(tex, this.w / 2, this.h / 2, 0, 0, 0, 1);
      ready = true;
    } else if (clip.type === 'shape') {
      drawShapeClip(this.textCtx, this.w, this.h, clip, tl, props);
      const tex = this._upload(this.textCanvas);
      this._clear(this.fbos.a, 0, 0, 0, 0);
      this._drawLayer(tex, this.w / 2, this.h / 2, 0, 0, 0, 1);
      ready = true;
    } else if (clip.type === 'generator' && clip.gen.style === 'tree') {
      const gp = {};
      for (const d of GEN_PARAMS) gp[d.key] = d.options ? Number(clip.gen.params[d.key] ?? d.def) : resolveParam(clip.gen, d.key, clip.gen.params[d.key] ?? d.def, tl, features, [d.min, d.max]);
      drawRoots(this.textCtx, this.w, this.h, !!clip.gen.transparent, gp, t);
      const tex = this._upload(this.textCanvas);
      this._clear(this.fbos.a, 0, 0, 0, 0);
      this._drawLayer(tex, this.w / 2, this.h / 2, 0, 0, 0, 1);
      ready = true;
    } else if (clip.type === 'adjust') {
      // adjustment layer: everything composited so far becomes this clip's input; its effects grade the whole stack below
      this._target(this.fbos.a);
      gl.disable(gl.BLEND);
      this._drawLayer(this.fbos.acc.tex, this.w / 2, this.h / 2, 0, 0, 0, 1);
      ready = true;
    } else if (clip.type === 'generator') {
      this._runGenerator(clip, tl, features, t);
      // generator fills the frame; scale/position don't apply, opacity does
      ready = true;
    }
    if (!ready) return null;

    let cur = this.fbos.a, other = this.fbos.b, spare = this.fbos.c;
    const chain = trans ? [...clip.effects, ...trans.effects] : clip.effects;
    for (const fx of chain) {
      if (!fx.enabled || !EFFECTS[fx.type]) continue;
      const wet = fx.wet === undefined && !fx.keyframes?.wet && !fx.bindings?.wet ? 1 : resolveParam(fx, 'wet', fx.wet ?? 1, tl, features, [0, 1]);
      if (wet <= 0.002) continue; // fully dry: the effect contributes nothing, so do not pay for it
      this._runEffect(fx, cur, other, clip, tl, features, t);
      if (wet < 0.998) { this._wetMix(cur, other, spare, wet); [cur, other, spare] = [spare, cur, other]; } // the mix is the new picture; the two older buffers are free
      else [cur, other] = [other, cur];
    }
    return { cur, props, t3, flat };
  }

  /**
   * @param {object} ctx {project, t, sources, features}
   * @returns {{missing:string[]}} names of media that had no frame available this tick
   */
  render({ project, t, sources, features }) {
    const gl = this.gl;
    const missing = [];
    this._clear(this.fbos.acc, 0, 0, 0, 1);
    const active = activeVisualClips(project, t);
    const matteIds = matteSourceIds(project); // clips that only serve as someone's matte are not drawn themselves

    for (const clip of active) {
      if (matteIds.has(clip.id)) continue;
      const tl = t - clip.start;
      const props = resolveClipProps(clip, tl, features);

      // A matte is another clip's finished picture. It is drawn first (it needs the same scratch buffers), parked in buffer m,
      // and then multiplied into this clip when it is laid onto the frame.
      const mt = normalizeMatte(clip.matte);
      let matteTex = null;
      if (mt && canBeMatte(project, clip, mt.source)) {
        const src = active.find((c) => c.id === mt.source);
        this._clear(this.fbos.m, 0, 0, 0, 0);
        if (src) {
          const L = this._renderLayer(project, src, t, sources, features, missing, null);
          if (L) { this._target(this.fbos.m); gl.disable(gl.BLEND); this._drawLayer(L.cur.tex, this.w / 2, this.h / 2, 0, 0, 0, L.props.opacity, L.flat ? null : L.t3); }
        }
        matteTex = this.fbos.m.tex;
      }

      const L = this._renderLayer(project, clip, t, sources, features, missing, props);
      if (!L) continue;
      const mask = this._maskFor(clip, props);
      const ex = mask || matteTex ? {
        mask: mask?.tex || null, maskInv: !!mask?.inv,
        matte: matteTex, matteMode: mt?.use === 'luma' ? 2 : 1, matteInv: !!mt?.invert,
      } : null;

      this._target(this.fbos.acc);
      this._blend(L.props.blend);
      this._drawLayer(L.cur.tex, this.w / 2, this.h / 2, 0, 0, 0, L.props.opacity, L.flat ? null : L.t3, ex);
      gl.disable(gl.BLEND);
    }

    // Blit to the visible canvas.
    this._target(null);
    gl.disable(gl.BLEND);
    this._use(this._program('blit', VERT_LAYER, FRAG_BLIT));
    this._bindTex(this.fbos.acc.tex);
    this._set1i('u_tex', 0);
    this._set2('u_res', this.w, this.h);
    this._set2('u_half', this.w / 2, this.h / 2);
    this._set2('u_offset', 0, 0);
    this._set1('u_rot', 0);
    this._set2('u_flip', 1, 1);
    this._set1('u_opacity', 1);
    this._draw();
    return { missing };
  }

  /** Reads the last rendered frame (RGBA, bottom-up rows). The returned buffer is reused. */
  readPixels() {
    const gl = this.gl;
    if (!this.pixels) this.pixels = new Uint8Array(this.w * this.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.acc.fbo);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    return this.pixels;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
