// TIMELINE in the Living tab: let two selected clips talk to each other. FOLLOW, GROW FROM, REMEMBER, BECOME. Pressing one only PLANS: it
// shows a picture drawn from a copy of the project and one sentence; APPLY makes it real as one Undo step, CANCEL leaves everything alone.
import { store } from '../store.js';
import { el, toast } from './dom.js';
import { creative } from '../creative/engine.js';
import { RELATIONS } from '/shared/creative/relate.js';
import { sampleFeatures } from '/shared/audio-analysis.js';

export function mountRelate({ preview, renderer }) {
  const status = el('p', { class: 'hint', id: 'rel-status' });
  const btns = {};
  const row = el('div', { class: 'rel-row' }, ...RELATIONS.map((r) => {
    const b = el('button', { id: `rel-${r.key}`, 'data-rel': r.key, text: r.title, onclick: () => plan(r.key) });
    btns[r.key] = b; return b;
  }));
  const canvas = el('canvas', { width: 192, height: 108, class: 'rel-prev' });
  const title = el('b', { class: 'rel-title' }), summary = el('p', { class: 'rel-sum' }), note = el('p', { class: 'hint rel-note' });
  const card = el('div', { class: 'rel-card', id: 'rel-card', hidden: true }, canvas,
    el('div', { class: 'rel-body' }, title, summary, note,
      el('div', { class: 'liv-acts' }, el('button', { id: 'rel-apply', class: 'primary', text: 'APPLY', onclick: apply }), el('button', { id: 'rel-cancel', text: 'CANCEL', onclick: () => clear() }))));
  const quiet = el('input', { type: 'checkbox', id: 'creative-suggest', checked: creative.suggestOn });
  quiet.addEventListener('change', () => creative.setSuggestions(quiet.checked));
  const root = el('section', { class: 'liv-sec', id: 'living-timeline' },
    el('h3', {}, 'TIMELINE', el('em', { text: 'Let the clips talk to each other.' })),
    row, status, card,
    el('label', { class: 'mut-row chk', title: 'Now and then, at a quiet moment, a small note may offer one of these for the clips you are working on, or a memory from Still Here. Never during playback or typing, never more than one at a time, and it goes quiet if you dismiss it.' }, quiet, 'Quiet suggestions'));

  let current = null;
  function clear(text = '') { current = null; card.hidden = true; if (text !== null) status.textContent = text; }

  function plan(kind) {
    const p = creative.planRelation(kind);
    if (p.reason) { clear(p.reason); return; }
    current = p;
    title.textContent = `${p.title} — ${p.line}`;
    summary.textContent = p.summary;
    note.textContent = p.preview === 'playback' ? 'This one shows while the timeline plays.' : '';
    status.textContent = 'Nothing changes until you press Apply.';
    card.hidden = false;
    paint();
  }

  function paint() {
    if (!current || card.hidden) return;
    try {
      const copy = structuredClone(store.project);
      if (!current.apply(copy)) return;
      const s = store.project.settings, h = 108, w = Math.max(60, Math.min(192, Math.round(h * (s.width / s.height))));
      canvas.width = w; canvas.height = h;
      const t = Math.min(Math.max(0, current.at + 0.4), Math.max(0, copy.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) - 0.05));
      const features = store.project.reactive?.enabled ? sampleFeatures(store.analysis, t) : null;
      renderer.paintProject({ project: copy, sources: preview.sources, t, features, target: canvas });
    } catch (e) { console.error(e); }
  }

  function apply() {
    if (!current) return;
    const p = current;
    if (creative.applyPlan(p)) { clear(`${p.title}: ${p.summary} Undo takes it back.`); toast(`${p.title} applied.`); }
    else clear('That no longer applies to these clips.');
  }

  function refresh() {
    const ids = [...store.multi];
    for (const r of RELATIONS) {
      if (ids.length !== 2) { btns[r.key].disabled = true; btns[r.key].title = 'Select two clips: the story of the first continues into the second.'; continue; }
      const p = creative.planRelation(r.key, ids, 1);
      btns[r.key].disabled = !!p.reason;
      btns[r.key].title = p.reason || `${r.line} ${p.summary}`;
    }
    if (current && (ids.length !== 2 || !ids.every((id) => [current.from, current.to].includes(id)))) clear('');
    if (!current && !status.textContent) status.textContent = ids.length === 2 ? 'Pick how the first clip should relate to the second.' : 'Select two clips on the timeline.';
    if (ids.length !== 2 && !current) status.textContent = 'Select two clips on the timeline.';
  }
  store.on('selection', refresh);
  store.on('project', () => { if (current) clear('The project changed, so that plan is out of date. Plan it again.'); refresh(); });
  store.on('stillhere', () => { quiet.checked = creative.suggestOn; });
  store.on('playhead', () => paint());
  refresh();
  return { el: root };
}
