// STILL HERE in the Living tab: keep a fragment of what you made (how it moved, looked, felt, the rhythm of its cuts) and LOOK BACK at
// what is on the shelf. No technical words: a memory is shown as a small picture of itself and a human title. Everything it does goes
// through the Creative Memory Engine (renderer/creative/engine.js); this file only draws and forwards clicks.
import { store } from '../store.js';
import { el } from './dom.js';
import { creative } from '../creative/engine.js';
import { KINDS, applyMemory } from '/shared/creative/still-here.js';
import { EFFECTS } from '/shared/effects-defs.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { activeVisualClips } from '/shared/timeline.js';

const KEEP = [['moved', 'how it moved'], ['looked', 'how it looked'], ['felt', 'its colours'], ['rhythm', 'the rhythm']];
const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#93b57f';

/** A tiny picture of a memory, drawn from its data (nothing is stored for it, except a frame for looks). */
function drawPreview(canvas, m) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#070907'; g.fillRect(0, 0, W, H);
  g.strokeStyle = g.fillStyle = ink(); g.lineWidth = 2; g.lineJoin = g.lineCap = 'round';
  if (m.kind === 'moved') {
    const T = m.data.tracks, at = (keys, u) => { if (!keys) return 0; if (u <= keys[0].u) return keys[0].d; for (let i = 0; i < keys.length - 1; i++) { const a = keys[i], b = keys[i + 1]; if (u <= b.u) { const k = (u - a.u) / Math.max(1e-4, b.u - a.u), s = k * k * (3 - 2 * k); return a.d + (b.d - a.d) * s; } } return keys[keys.length - 1].d; };
    const pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40; pts.push([at(T.x, u), at(T.y, u), at(T.scale, u), at(T.rotation, u)]); }
    const path = T.x || T.y;
    const xs = path ? pts.map((p) => p[0]) : pts.map((_, i) => i), ys = path ? pts.map((p) => -p[1]) : pts.map((p) => -p[T.rotation ? 3 : 2]);
    const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a), sx = (hi(xs) - lo(xs)) || 1, sy = (hi(ys) - lo(ys)) || 1, s = Math.min((W - 24) / sx, (H - 20) / sy);
    const px = (x) => (W - sx * s) / 2 + (x - lo(xs)) * s, py = (y) => (H - sy * s) / 2 + (y - lo(ys)) * s;
    g.beginPath(); // no position keys: rotation or scale is drawn against time instead
    xs.forEach((x, i) => (i ? g.lineTo(px(x), py(ys[i])) : g.moveTo(px(x), py(ys[i])))); g.stroke();
    g.beginPath(); g.arc(px(xs[xs.length - 1]), py(ys[ys.length - 1]), 3.5, 0, 7); g.fill();
  } else if (m.kind === 'felt') {
    const n = m.data.colors.length;
    m.data.colors.forEach((c, i) => { g.fillStyle = c; g.fillRect((W * i) / n, 0, Math.ceil(W / n), H); });
  } else if (m.kind === 'rhythm') {
    const iv = m.data.intervals, mx = Math.max(...iv); let x = 6;
    const w = (W - 12 - (iv.length - 1) * 3) / iv.reduce((s, v) => s + v, 0);
    iv.forEach((v) => { const bh = 10 + (H - 24) * (v / mx); g.fillRect(x, H - 8 - bh, Math.max(2, v * w), bh); x += v * w + 3; });
  }
}

export function mountStillHere({ preview, renderer }) {
  const status = el('p', { class: 'hint', id: 'still-status' });
  const keepBtns = {};
  const keepRow = el('div', { class: 'still-keep' }, ...KEEP.map(([kind, label]) => {
    const b = el('button', { id: `still-keep-${kind}`, 'data-kind': kind, text: `Keep ${label}`, onclick: () => onKeep(kind) });
    keepBtns[kind] = b; return b;
  }));
  const auto = el('input', { type: 'checkbox', id: 'still-auto', checked: creative.autoKeep });
  auto.addEventListener('change', () => creative.setAutoKeep(auto.checked));
  const autoLine = el('p', { class: 'hint', id: 'still-auto-line' });
  const list = el('div', { class: 'still-list', id: 'still-list' });
  const root = el('section', { class: 'liv-sec', id: 'living-still' },
    el('h3', {}, 'STILL HERE', el('em', { text: 'Nothing good has to disappear.' })),
    el('p', { class: 'liv-how', text: 'Select a clip and press Keep to put how it moves, looks or feels on the shelf. Later, select other clips and press BRING BACK to use it on all of them at once.' }),
    keepRow, status,
    el('h3', { class: 'still-sub' }, 'LOOK BACK'), list,
    el('details', { class: 'liv-adv' }, el('summary', { text: 'Advanced' }),
      el('label', { class: 'mut-row chk', title: 'When you let go of a look or a movement you worked on for a while, a copy may be put on this shelf. It is strict about it, and you can always let it go.' }, auto, 'Keep good leftovers for me'), autoLine));

  function thumbFor(clip, chain) {
    try {
      if (!activeVisualClips(store.project, store.playhead).some((c) => c.id === clip.id)) return null;
      const s = store.project.settings, h = 108, w = Math.max(60, Math.min(192, Math.round(h * (s.width / s.height))));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const features = store.project.reactive?.enabled ? sampleFeatures(store.analysis, store.playhead) : null;
      renderer.paint({ project: store.project, sources: preview.sources, t: store.playhead, features, clipId: clip.id, chain, target: canvas });
      return canvas.toDataURL('image/jpeg', 0.6);
    } catch (e) { console.error(e); return null; } // a missing picture never stops a memory from being kept
  }

  function onKeep(kind) {
    const r = creative.keep(kind);
    if (!r.ok) { status.textContent = r.existing ? 'Already on the shelf.' : r.reason; return; }
    if (kind === 'looked') { const clip = store.selectedClip; const t = clip && thumbFor(clip, r.memory.data.chain); if (t) creative.thumb(r.memory.id, t); }
    status.textContent = `Kept: ${KINDS[kind].title.toLowerCase()}.`;
  }

  function onBack(m) {
    const r = creative.bringBack(m.id);
    status.textContent = r.ok ? `${r.text} Undo takes it back.` : r.reason;
  }

  function card(m) {
    const prev = el('div', { class: 'still-prev' });
    if (m.kind === 'looked') {
      if (m.thumb) prev.append(el('img', { src: m.thumb, alt: '' }));
      else prev.append(el('div', { class: 'still-chips' }, ...m.data.chain.slice(0, 6).map((c) => el('span', { text: EFFECTS[c.type]?.label || c.type }))));
    } else { const c = el('canvas', { width: 192, height: 72 }); drawPreview(c, m); prev.append(c); }
    const name = el('input', { class: 'still-name', value: m.name, 'aria-label': 'Name', maxlength: 80 });
    name.addEventListener('change', () => creative.rename(m.id, name.value));
    return el('div', { class: 'still-card', 'data-id': m.id, 'data-kind': m.kind },
      prev,
      el('div', { class: 'still-body' },
        el('b', { class: 'still-title', text: KINDS[m.kind].title }), name,
        el('em', { class: 'still-why', text: m.source === 'curated' ? `kept for you — ${m.why || 'you worked on it for a while'}` : 'kept by you' }),
        el('div', { class: 'liv-acts' },
          el('button', { class: 'still-preview', text: 'PREVIEW', title: 'See it on the selected clips first (press Space to play it)', onclick: () => {
            const ids = [...store.multi], probe = applyMemory(structuredClone(store.project), m, { clipIds: ids });
            if (!probe.ok) { status.textContent = probe.reason; return; }
            store.showGhost({ label: KINDS[m.kind].title.toLowerCase(), apply: (p) => applyMemory(p, m, { clipIds: ids }).ok, done: `${probe.text || 'Brought back.'} Undo takes it back.` });
            status.textContent = 'Previewing: press Space to play it. Apply keeps it, Cancel forgets it.';
          } }),
          el('button', { class: 'still-back', text: 'BRING BACK', title: `Bring back the ${KINDS[m.kind].verb} onto the selected ${m.kind === 'rhythm' ? 'clips' : 'clip'}. One Undo takes it back.`, onclick: () => onBack(m) }),
          el('button', { class: 'still-go', text: 'LET GO', title: 'Remove it from the shelf', onclick: () => { creative.letGo(m.id); } }))));
  }

  function renderList() {
    const shelf = [...creative.shelf].reverse();
    list.replaceChildren(...(shelf.length ? shelf.map(card) : [el('p', { class: 'hint', text: 'Nothing here yet. Keep something you like. If you let go of a look or a movement you worked on for a while, a copy may be kept for you.' })]));
    const n = shelf.filter((m) => m.source === 'curated').length;
    autoLine.textContent = creative.autoKeep ? `${n ? `${n} kept for you on this shelf. ` : ''}It only keeps what you spent time on, and never the same thing twice.` : 'Nothing is kept unless you press a Keep button.';
  }
  function renderKeep() {
    const a = creative.availability();
    for (const [kind] of KEEP) { keepBtns[kind].disabled = !a[kind].ok; keepBtns[kind].title = a[kind].ok ? `Put ${KEEP.find((k) => k[0] === kind)[1]} of the selection on the shelf.` : a[kind].reason; }
  }

  store.on('stillhere', () => { renderList(); renderKeep(); });
  store.on('reset', () => { renderList(); renderKeep(); status.textContent = ''; });
  store.on('selection', renderKeep);
  store.on('project', () => { renderKeep(); if (list.children.length !== Math.max(1, creative.shelf.length)) renderList(); });
  renderList(); renderKeep();
  return { el: root };
}
