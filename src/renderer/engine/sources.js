// Media element pool. One <video> per video clip (so the same file can sit on two tracks),
// one <img> per image media, one <audio> per audio clip (preview only).
import { clipEnd } from '/shared/timeline.js';
import { findMedia } from '/shared/project.js';

const SEEK_TIMEOUT_MS = 15000;

export class Sources {
  /** @param {{mediaUrl:(p:string)=>string, audible:boolean}} opts */
  constructor({ mediaUrl, audible, decoder = 'element', maxDim = 4096 }) {
    this.decoder = decoder; // 'element' = <video> seeking (preview), 'ffmpeg' = sequential ffmpeg frames (export)
    this.maxDim = maxDim;
    this.dec = new Map(); // clipId -> {next, frame, pending, w, h}
    this.mediaUrl = mediaUrl;
    this.audible = audible;
    this.videos = new Map(); // clipId -> HTMLVideoElement
    this.audios = new Map(); // clipId -> HTMLAudioElement
    this.images = new Map(); // mediaId -> HTMLImageElement
    this.onFrameReady = () => {};
    this.errors = new Map(); // mediaId -> message
  }

  urlFor(media) { return this.mediaUrl(media.playPath || media.path); }

  _video(clip, media) {
    let v = this.videos.get(clip.id);
    if (!v) {
      v = document.createElement('video');
      v.preload = 'auto';
      v.playsInline = true;
      v.muted = !this.audible;
      v.src = this.urlFor(media);
      // A new element can't be seeked until metadata arrives, so redraw (and re-sync) at each load stage.
      for (const ev of ['seeked', 'loadedmetadata', 'loadeddata']) v.addEventListener(ev, () => this.onFrameReady());
      v.addEventListener('error', () => {
        this.errors.set(media.id, `Cannot decode "${media.name}" (${v.error?.message || 'unsupported codec'}).`);
        this.onFrameReady();
      });
      this.videos.set(clip.id, v);
    }
    return v;
  }

  _image(media) {
    let img = this.images.get(media.id);
    if (!img) {
      img = new Image();
      img.src = this.urlFor(media);
      img.decode().then(() => this.onFrameReady()).catch(() => this.errors.set(media.id, `Cannot decode image "${media.name}".`));
      this.images.set(media.id, img);
    }
    return img;
  }

  /** Returns {el, w, h} for a media clip if a frame is available, else null. */
  frameFor(project, clip) {
    const media = findMedia(project, clip.mediaId);
    if (!media || media.missing) return null;
    if (media.kind === 'image') {
      const img = this._image(media);
      return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
    }
    if (media.kind === 'video' && this.decoder === 'ffmpeg') return this.dec.get(clip.id)?.frame || null;
    if (media.kind === 'video') {
      const v = this._video(clip, media);
      return v.readyState >= 2 && v.videoWidth ? { el: v, w: v.videoWidth, h: v.videoHeight } : null;
    }
    return null;
  }

  /** Preview: align playing/paused state and currentTime of every element with the timeline. */
  sync(project, t, playing) {
    const live = new Set(project.clips.map((c) => c.id));
    for (const [id, el] of [...this.videos, ...this.audios]) {
      if (!live.has(id)) { el.pause(); el.removeAttribute('src'); el.load(); this.videos.delete(id); this.audios.delete(id); }
    }
    const trackMuted = new Map(project.tracks.map((tr) => [tr.id, tr.muted]));
    for (const clip of project.clips) {
      if (clip.type !== 'media') continue;
      const media = findMedia(project, clip.mediaId);
      if (!media || media.missing) continue;
      const active = t >= clip.start && t < clipEnd(clip);
      const near = t >= clip.start - 1.5 && t < clipEnd(clip);
      if (media.kind === 'image') { if (near) this._image(media); continue; }
      let el;
      if (media.kind === 'video') { if (!near && !this.videos.has(clip.id)) continue; el = this._video(clip, media); }
      else {
        if (!near && !this.audios.has(clip.id)) continue;
        el = this.audios.get(clip.id);
        if (!el) { el = new Audio(); el.preload = 'auto'; el.src = this.urlFor(media); this.audios.set(clip.id, el); }
      }
      const want = clip.in + (t - clip.start);
      el.volume = trackMuted.get(clip.trackId) || !this.audible ? 0 : Math.min(1, Math.max(0, clip.volume ?? 1));
      if (active) {
        if (Math.abs(el.currentTime - want) > (playing ? 0.3 : 0.001) && el.readyState > 0) el.currentTime = want;
        if (playing && el.paused) el.play().catch(() => {});
        if (!playing && !el.paused) el.pause();
      } else {
        if (!el.paused) el.pause();
        if (near && el.readyState > 0 && Math.abs(el.currentTime - clip.in) > 0.05) el.currentTime = clip.in;
      }
    }
  }

  pauseAll() { for (const el of [...this.videos.values(), ...this.audios.values()]) el.pause(); }

  /** Export: position every active video at project time t and wait until its frame is decoded. */
  async seekAll(project, t, fps) {
    if (this.decoder === 'ffmpeg') return this._decodeAll(project, t, fps);
    const jobs = [];
    for (const clip of project.clips) {
      if (clip.type !== 'media' || t < clip.start - 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
      const media = findMedia(project, clip.mediaId);
      if (!media || media.kind === 'audio') continue;
      if (media.missing) throw new Error(`Source file missing: ${media.name}`);
      if (media.kind === 'image') {
        const img = this._image(media);
        jobs.push(img.decode().catch(() => { throw new Error(`Cannot decode image "${media.name}".`); }));
        continue;
      }
      const v = this._video(clip, media);
      const target = Math.min(Math.max(0, clip.in + (t - clip.start)), Math.max(0, media.duration - 0.001));
      jobs.push(this._seek(v, target, media.name));
    }
    await Promise.all(jobs);
  }

  async _decodeAll(project, t, fps) {
    const jobs = [];
    for (const clip of project.clips) {
      if (clip.type !== 'media' || t < clip.start - 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
      const media = findMedia(project, clip.mediaId);
      if (!media || media.kind !== 'video') {
        if (media?.kind === 'image') { const img = this._image(media); jobs.push(img.decode().catch(() => { throw new Error(`Cannot decode image "${media.name}".`); })); }
        continue;
      }
      if (media.missing) throw new Error(`Source file missing: ${media.name}`);
      jobs.push(this._decodeClip(clip, media, t, fps));
    }
    await Promise.all(jobs);
  }

  async _decodeClip(clip, media, t, fps) {
    let st = this.dec.get(clip.id);
    if (!st) {
      const k = Math.min(1, this.maxDim / Math.max(media.width, media.height));
      const w = Math.max(2, Math.round(media.width * k)), h = Math.max(2, Math.round(media.height * k));
      await window.hh.exportOpenDecoder({ id: clip.id, path: media.path, start: clip.in, duration: clip.duration + 0.5, fps, width: w, height: h });
      st = { next: 0, frame: null, pending: null, w, h };
      this.dec.set(clip.id, st);
    }
    const want = Math.max(0, Math.round((t - clip.start) * fps));
    while (st.next <= want) {
      const buf = await (st.pending || window.hh.exportNextFrame(clip.id));
      st.pending = null;
      st.frame = { data: new Uint8Array(buf), w: st.w, h: st.h };
      st.next++;
    }
    if ((want + 1) / fps < clip.duration) st.pending = window.hh.exportNextFrame(clip.id); // prefetch while the GPU renders
  }

  async _seek(v, target, name) {
    if (v.readyState < 1) {
      await new Promise((res, rej) => {
        v.addEventListener('loadedmetadata', res, { once: true });
        v.addEventListener('error', () => rej(new Error(`Cannot decode "${name}": ${v.error?.message || 'unsupported codec'}. Try re-importing so a proxy can be generated.`)), { once: true });
      });
    }
    if (Math.abs(v.currentTime - target) < 1e-3 && v.readyState >= 2) return;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`Timed out decoding "${name}" at ${target.toFixed(2)}s.`)), SEEK_TIMEOUT_MS);
      v.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true });
      v.currentTime = target;
    });
  }

  dispose() {
    for (const el of [...this.videos.values(), ...this.audios.values()]) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.videos.clear(); this.audios.clear(); this.images.clear();
  }
}
