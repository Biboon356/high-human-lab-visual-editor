import { el, toast, fmtTime } from './dom.js';
import { store } from '../store.js';
import { addMediaClip, trackEnd, addTrack, overlaps } from '/shared/timeline.js';
import { createTextClip, createTitleLockup, lockupFonts, LOCKUPS, TEXT_PRESETS } from '/shared/text-defs.js';
import { placeAdlibs, adlibWordsDefault } from '../engine/rhythm-tools.js';
import { createGeneratorClip, GEN_PRESETS } from '/shared/organic-defs.js';
import { createAdjustClip, ADJUST_LOOKS, ORGANIC_LOOKS } from '/shared/adjust-defs.js';
import { addClipRaw, projectDuration } from '/shared/timeline.js';
import { uid } from '/shared/project.js';

/** Probes decodability in Chromium; returns null if fine, else an error string. */
function canDecode(media) {
  return new Promise((resolve) => {
    if (media.kind === 'image') { const i = new Image(); i.onload = () => resolve(null); i.onerror = () => resolve('image decode failed'); i.src = window.hh.mediaUrl(media.playPath || media.path); return; }
    const v = media.kind === 'video' ? document.createElement('video') : new Audio();
    v.preload = 'auto'; v.muted = true;
    const done = (r) => { clearTimeout(to); v.removeAttribute('src'); v.load(); resolve(r); };
    const to = setTimeout(() => done('timed out loading'), 12000);
    v.onloadeddata = () => done(media.kind === 'video' && !v.videoWidth ? 'no decodable video track' : null);
    v.onerror = () => done(v.error?.message || 'unsupported codec');
    v.src = window.hh.mediaUrl(media.playPath || media.path);
  });
}

/** Checks Chromium can play the media; if not, builds an H.264 proxy. Returns an error string or null. */
async function finalizeMedia(media) {
  let problem = await canDecode(media);
  if (problem && media.kind !== 'image') {
    toast(`"${media.name}" isn't directly playable (${problem}). Generating an H.264 proxy…`);
    try {
      media.playPath = await window.hh.makeProxy(media.path);
      problem = await canDecode(media);
    } catch (e) { problem = e.message; }
  }
  return problem;
}

export async function importResults(results) {
  const added = [];
  for (const r of results) {
    if (!r.ok) { toast(`Import failed: ${r.error}`, 'error'); continue; }
    const info = r.info;
    if (store.project.media.find((m) => m.path === info.path)) { toast(`"${info.name}" is already in the project.`); continue; }
    const media = { id: uid('med'), ...info };
    const problem = await finalizeMedia(media);
    if (problem) { toast(`Can't use "${info.name}": ${problem}`, 'error'); continue; }
    store.snapshot();
    store.project.media.push(media);
    added.push(media);
  }
  if (!added.length) return [];
  // First video into an empty project: adopt its size/fps and place it on V1.
  const first = added.find((m) => m.kind === 'video');
  if (first && store.project.clips.length === 0 && first.width) {
    const s = store.project.settings;
    s.width = first.width - (first.width % 2); s.height = first.height - (first.height % 2);
    if (first.fps >= 10 && first.fps <= 120) s.fps = Math.round(first.fps);
    const v1 = store.project.tracks.filter((t) => t.kind === 'video').slice(-1)[0];
    const clip = addMediaClip(store.project, first.id, v1.id, 0);
    if (clip) store.select(clip.id);
    toast(`Project set to ${s.width}×${s.height} @ ${s.fps}fps from "${first.name}".`);
  }
  store.touch('project');
  return added;
}

/** Point an existing (missing) media item at a new file; clips keep their edits. */
export async function relinkMedia(mediaId, results) {
  const media = store.project.media.find((m) => m.id === mediaId);
  const r = results?.find((x) => x.ok);
  if (!media || !r) { if (results?.length) toast(`Relink failed: ${results[0].error || 'no usable file chosen'}`, 'error'); return false; }
  if (r.info.kind !== media.kind) { toast(`That file is ${r.info.kind}, but "${media.name}" is ${media.kind}.`, 'error'); return false; }
  const next = { ...media, ...r.info, id: media.id, name: media.name };
  delete next.missing; delete next.playPath;
  const problem = await finalizeMedia(next);
  if (problem) { toast(`Can't use the chosen file: ${problem}`, 'error'); return false; }
  const short = media.kind !== 'image' && next.duration + 0.05 < Math.max(0, ...store.project.clips.filter((c) => c.mediaId === media.id).map((c) => c.in + c.duration));
  store.snapshot();
  Object.assign(media, next); delete media.missing; if (!next.playPath) delete media.playPath;
  store.relinkedMedia = media.id;
  store.touch('project'); store.emit('relink');
  toast(short ? `Relinked "${media.name}" — the new file is shorter than some clips use.` : `Relinked "${media.name}".`, short ? 'error' : 'info');
  return true;
}

export function appendToTimeline(mediaId) {
  const m = store.project.media.find((x) => x.id === mediaId);
  if (!m) return;
  const tracks = store.project.tracks.filter((t) => (m.kind === 'audio' ? t.kind === 'audio' : t.kind === 'video'));
  const track = m.kind === 'audio' ? tracks[0] : tracks[tracks.length - 1];
  const clip = store.mutate((p) => addMediaClip(p, mediaId, track.id, store.playhead));
  if (clip) store.select(clip.id);
}

// an adjustment layer needs a track to itself above the footage it grades, so it never shares a lane with another clip
export function addAdjustLayer(look) {
  const total = projectDuration(store.project);
  // fade presets place themselves: "out" covers the last 1.5 s and ramps in to full strength, "in" covers the first 1.2 s and ramps out
  const fadeLen = look.fade ? Math.min(look.fade === 'out' ? 1.5 : 1.2, Math.max(0.3, total)) : 0;
  const start = look.fade === 'out' ? Math.max(0, total - fadeLen) : look.fade === 'in' ? 0 : Math.max(0, store.playhead);
  const rest = total - start;
  const len = look.fade ? fadeLen : rest >= 1 ? rest : 8; // cover what is left of the cut; an empty timeline gets a default length
  const clip = store.mutate((p) => {
    const c = createAdjustClip(look, start, len);
    if (look.fade === 'out') c.fadeIn = len; else if (look.fade === 'in') c.fadeOut = len;
    const top = p.tracks.find((t) => t.kind === 'video');
    const t = top && !overlaps(p, top.id, start, len) ? top : addTrack(p, 'video');
    c.trackId = t.id;
    return addClipRaw(p, c);
  });
  store.select(clip.id);
  return clip;
}

// ★ favourite / ⊘ leave out: read by Auto-montage (favourites get more screen time, skipped clips never appear)
function pickBtn(m, kind) {
  const on = m.pick === kind;
  return el('button', { class: `pick ${kind}${on ? ' on' : ''}`, 'data-pick': kind, 'aria-pressed': String(on), text: kind === 'star' ? (on ? '★' : '☆') : '⊘',
    title: kind === 'star' ? 'Favourite — Auto-montage will use it more' : 'Leave out of Auto-montage',
    onclick: () => store.mutate((p) => { const x = p.media.find((q) => q.id === m.id); if (x) { if (x.pick === kind) delete x.pick; else x.pick = kind; } }) });
}

function addOverlayClip(make) {
  const track = store.project.tracks.find((t) => t.kind === 'video'); // top video track
  const clip = store.mutate((p) => {
    const c = make(Math.max(0, store.playhead));
    c.trackId = track.id;
    return addClipRaw(p, c);
  });
  store.select(clip.id);
  return clip;
}

export function mountMediaBin({ onImport }) {
  const list = document.getElementById('media-list');
  const render = () => {
    list.replaceChildren();
    if (!store.project.media.length) list.append(el('div', { class: 'empty', text: 'No media yet. Import video, audio or images — or drop files here.' }));
    for (const m of store.project.media) {
      const item = el('div', { class: `media-item ${m.missing ? 'missing' : ''}`, draggable: 'true', title: m.path },
        el('div', { class: `k ${m.kind}`, text: m.kind === 'video' ? 'VID' : m.kind === 'audio' ? 'AUD' : 'IMG' }),
        el('div', {}, el('div', { class: 'n', text: m.name }),
          el('div', { class: 'm', text: m.missing ? 'FILE MISSING — relink by re-importing' : [m.kind !== 'image' ? fmtTime(m.duration).replace(/^00:/, '') : '', m.width ? `${m.width}×${m.height}` : '', m.fps ? `${m.fps}fps` : ''].filter(Boolean).join(' · ') })),
        el('div', { class: 'media-acts' },
          m.missing ? el('button', { text: 'Relink…', title: 'Choose the file again', onclick: async () => relinkMedia(m.id, await window.hh.pickMedia()) })
            : [...(m.kind === 'audio' ? [] : [pickBtn(m, 'star'), pickBtn(m, 'skip')]), el('button', { text: '＋', title: 'Add to timeline at playhead', onclick: () => appendToTimeline(m.id) })]));
      item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-hh-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
      item.addEventListener('dblclick', () => appendToTimeline(m.id));
      list.append(item);
    }
  };
  store.on('project', render);
  render();

  // OS file drop onto the left panel
  const panel = document.getElementById('panel-left');
  panel.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); panel.classList.add('drop-over'); } });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop-over'));
  panel.addEventListener('drop', async (e) => {
    e.preventDefault(); panel.classList.remove('drop-over');
    const paths = [...e.dataTransfer.files].map((f) => window.hh.pathForFile(f)).filter(Boolean);
    if (paths.length) onImport(await window.hh.probePaths(paths));
  });

  // Typography & organic preset lists
  const tp = document.getElementById('text-presets');
  for (const p of TEXT_PRESETS) tp.append(el('button', { onclick: () => addOverlayClip((s) => createTextClip(p, s, 4)) }, p.name, el('small', { text: `${p.text.font} · ${p.text.anim?.type || 'static'}` })));
  document.getElementById('add-text').onclick = () => addOverlayClip((s) => createTextClip(null, s, 4));
  const aw = document.getElementById('adlib-words'); aw.value = adlibWordsDefault();
  document.getElementById('adlib-place').onclick = () => placeAdlibs({ words: aw.value, every: Number(document.getElementById('adlib-every').value) });
  const addLockup = (name) => {
    const start = Math.max(0, store.playhead), len = 4;
    const [kicker, title, sub] = createTitleLockup(start, len, { lockup: name });
    const t = store.mutate((p) => {
      // clips that share the same time need their own tracks: reuse free video tracks from the top, add one if needed
      const used = new Set();
      const free = () => { const x = p.tracks.filter((tr) => tr.kind === 'video').find((tr) => !used.has(tr.id) && !overlaps(p, tr.id, start, len)) || addTrack(p, 'video'); used.add(x.id); return x; };
      for (const c of [title, kicker, sub].filter(Boolean)) { c.trackId = free().id; addClipRaw(p, c); }
      return title;
    });
    store.select(t.id);
  };
  document.getElementById('add-lockup').onclick = () => addLockup(LOCKUPS[0].name);
  const ll = document.getElementById('lockup-list');
  for (const L of LOCKUPS.slice(1)) ll.append(el('button', { 'data-lockup': L.name, title: `Adds ${L.sub ? 'three' : 'two'} text clips: ${[L.kicker, L.title, L.sub].filter(Boolean).map((s) => s.preset).join(' + ')}`, onclick: () => addLockup(L.name) }, L.name, el('small', { text: lockupFonts(L).join(' + ') })));
  const lk = document.getElementById('look-list');
  for (const L of ADJUST_LOOKS) lk.append(el('button', { 'data-look': L.name, title: L.note, onclick: () => addAdjustLayer(L) }, L.name, el('small', { text: L.note })));
  const ol = document.getElementById('organic-looks');
  for (const L of ORGANIC_LOOKS) ol.append(el('button', { 'data-look': L.name, title: L.note, onclick: () => addAdjustLayer(L) }, L.name, el('small', { text: L.note })));
  const gp = document.getElementById('gen-presets');
  for (const p of GEN_PRESETS) gp.append(el('button', { onclick: () => addOverlayClip((s) => createGeneratorClip(p, s, 6)) }, p.name, el('small', { text: `style: ${p.style}` })));
}
