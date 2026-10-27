// "Auto-montage" dialog: pick a style, let the app analyse footage and music, see what it decided and why, re-roll or undo.
import { el, toast, fmtTime } from './dom.js';
import { store } from '../store.js';
import { runSmartMontage, buildPlan, applyPlan, MONTAGE_STYLES, MONTAGE_DEFAULTS } from '../engine/montage.js';
import { runAnalysis } from './reactive-ui.js';
import { autoMontage } from './timeline-ui.js';

const KEY = 'hhlab.montage.opts';
const loadOpts = () => { try { return { ...MONTAGE_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}'), seed: Date.now() % 1e6 }; } catch { return { ...MONTAGE_DEFAULTS, seed: Date.now() % 1e6 }; } };
const saveOpts = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ style: o.style, intensity: o.intensity, reframe: o.reframe })); } catch { /* storage unavailable */ } };
const SOURCE_COLORS = ['#93b57f', '#b9a8e8', '#d8d36a', '#d9a36a', '#7fb5b0', '#c97f9a'];

let open = false;

/** Energy curve + cut ticks, so the result explains itself at a glance. */
function drawStrip(canvas, result) {
  const { plan, prep } = result, total = prep.analysis.duration;
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, w, h);
  const x = (t) => (t / total) * w;
  ctx.fillStyle = css.getPropertyValue('--line2').trim() || '#2d3328';
  for (const b of prep.structure.bars) { const bh = 8 + b.energy * (h - 22); ctx.fillRect(x(b.start) + 0.5, h - 12 - bh, Math.max(1, x(b.end) - x(b.start) - 1), bh); }
  const ids = [...new Set(plan.segments.map((s) => s.mediaId))];
  for (const s of plan.segments) {
    ctx.fillStyle = SOURCE_COLORS[ids.indexOf(s.mediaId) % SOURCE_COLORS.length];
    ctx.fillRect(x(s.start), h - 10, Math.max(1, x(s.start + s.duration) - x(s.start) - 1), 6);
    if (s.role === 'hero') { ctx.fillStyle = css.getPropertyValue('--signal').trim() || '#d8d36a'; ctx.fillRect(x(s.start) - 0.5, 0, 1.5, h - 10); }
  }
  ctx.fillStyle = css.getPropertyValue('--dim').trim() || '#8f9382'; ctx.font = '9px DM Mono, monospace';
  for (const sec of prep.structure.sections) if (sec.end - sec.start > total * 0.06) ctx.fillText(sec.label.toUpperCase(), x(sec.start) + 3, 10);
}

export function openMontageDialog() {
  if (open) return;
  const root = document.getElementById('modal-root');
  const opts = loadOpts();
  let busy = false, signal = null, last = null;
  const close = () => { if (busy) return; open = false; root.replaceChildren(); };

  const styleBtns = el('div', { class: 'ae-styles' }, Object.entries(MONTAGE_STYLES).map(([k, v]) => {
    const b = el('button', { class: opts.style === k ? 'on' : '', text: v.label, 'data-style': k });
    b.addEventListener('click', () => { opts.style = k; saveOpts(opts); styleBtns.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
    return b;
  }));
  const intensity = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: opts.intensity, 'aria-label': 'Cut rate' });
  intensity.addEventListener('input', () => { opts.intensity = Number(intensity.value); saveOpts(opts); });
  const reframe = el('input', { type: 'checkbox', checked: !!opts.reframe });
  reframe.addEventListener('change', () => { opts.reframe = reframe.checked; saveOpts(opts); });

  const steps = el('div', { class: 'ae-steps' }), result = el('div');
  const STEP = { audio: 'Analyse the music', footage: 'Look at the footage', music: 'Read the music structure', plan: 'Choose shots', apply: 'Build the timeline' };
  const setStep = (k, t) => {
    let n = steps.querySelector(`[data-k="${k}"]`);
    if (!n) { n = el('div', { 'data-k': k, class: 'ae-step' }); steps.append(n); }
    steps.querySelectorAll('.ae-step:not(.done)').forEach((x) => { if (x !== n) { x.classList.add('done'); x.textContent = `✔ ${STEP[x.dataset.k] || x.dataset.k}`; } });
    n.textContent = `… ${t || STEP[k]}`;
  };
  window.hh.onMontageProgress?.((p) => { if (open && busy && p.total) setStep('footage', `Looking at the footage ${Math.min(p.done + 1, p.total)}/${p.total}${p.name ? ` · ${p.name}` : ''}`); });

  const run = el('button', { class: 'primary', id: 'mt-run', text: 'Build montage' });
  const reroll = el('button', { id: 'mt-reroll', text: 'Re-roll', hidden: true, title: 'Same analysis, different choices' });
  const undo = el('button', { id: 'mt-undo', text: 'Undo', hidden: true });
  const cancel = el('button', { text: 'Cancel', hidden: true });
  const closeBtn = el('button', { text: 'Close', onclick: close });
  const classic = el('button', { text: 'Classic random montage…', title: 'The simple version: every Nth beat, random clips and looks', onclick: async () => {
    const n = Number(document.getElementById('tl-beat-n').value);
    open = false; root.replaceChildren(); await autoMontage({ every: n, looks: document.getElementById('tl-montage-looks').checked });
  } });

  const show = (r) => {
    const { plan, prep } = r, sm = plan.summary;
    const names = (ids) => prep.sources.filter((s) => ids.includes(s.id)).map((s) => s.name);
    const hero = plan.segments.find((s) => s.role === 'hero');
    const secs = sm.sections.map((s) => `${s.label} ${s.start.toFixed(0)}–${s.end.toFixed(0)}s`).join(' → ');
    const lines = [
      `Music: ${secs}${sm.drops.length ? ` · drop${sm.drops.length > 1 ? 's' : ''} at ${sm.drops.map((d) => `${d.toFixed(1)}s`).join(', ')}` : ''}`,
      `${sm.cuts} cuts, ${sm.avgCut.toFixed(1)} s on average — ${new Set(sm.sections.map((x) => x.label)).size > 1 ? 'slow while the music is calm, rapid on full bars' : 'the music keeps a steady energy, so the cut rate stays even'}, every cut on a beat`,
      `Used ${sm.sourcesUsed} of ${sm.sourcesTotal} clips; best moments picked (sharp, steady, well exposed, no scene change inside a shot)`,
      hero ? `Hero shot at ${fmtTime(hero.start).slice(3, 8)}: ${hero.why}` : null,
      sm.unused.length ? `Not used: ${names(sm.unused).join(', ')}` : null,
      prep.failed.length ? `Could not analyse: ${prep.failed.map((f) => f.name).join(', ')} (placed without scoring)` : null,
    ].filter(Boolean);
    const canvas = el('canvas', { class: 'mt-strip', width: 560, height: 64, role: 'img', 'aria-label': 'Music energy and cut points' });
    result.replaceChildren(el('div', { class: 'okbox mt-result' }, el('div', { class: 'mt-lines' }, lines.map((l) => el('div', { text: l }))), canvas));
    drawStrip(canvas, r);
  };

  run.onclick = async () => {
    busy = true; signal = { aborted: false };
    run.disabled = true; closeBtn.disabled = true; cancel.hidden = false; reroll.hidden = true; undo.hidden = true; steps.replaceChildren(); result.replaceChildren();
    try {
      opts.seed = (opts.seed + 1) % 1e6;
      last = await runSmartMontage({ opts, signal, ensureAnalysis: () => runAnalysis({ quiet: true }), onStep: setStep });
      steps.querySelectorAll('.ae-step').forEach((x) => { x.classList.add('done'); x.textContent = `✔ ${STEP[x.dataset.k] || x.dataset.k}`; });
      show(last); reroll.hidden = false; undo.hidden = false;
      toast(`Auto-montage: ${last.plan.summary.cuts} cuts on a new video track.`);
    } catch (e) {
      steps.querySelectorAll('.ae-step:not(.done)').forEach((x) => { x.textContent = `✖ ${STEP[x.dataset.k] || x.dataset.k}`; });
      result.append(el('div', { class: 'errbox', text: e.message }));
    } finally { busy = false; run.disabled = false; closeBtn.disabled = false; cancel.hidden = true; signal = null; }
  };
  reroll.onclick = () => {
    if (!last || busy) return;
    store.undo(); // back to before the montage, then plan again from the same analysis
    opts.seed = (opts.seed + 7) % 1e6;
    const plan = buildPlan({ prep: last.prep, opts });
    store.snapshot();
    const r = applyPlan({ project: store.project, plan, opts, prep: last.prep });
    store.touch('project');
    last = { ...last, plan, ...r }; show(last);
  };
  undo.onclick = () => { if (!last) return; store.undo(); last = null; result.replaceChildren(el('div', { class: 'hint', text: 'Undone — the project is back to how it was.' })); undo.hidden = true; reroll.hidden = true; };
  cancel.onclick = async () => { if (signal) signal.aborted = true; await window.hh.montageCancel(); };

  const hasMusic = !!store.project.clips.find((c) => c.type === 'media' && store.project.media.find((m) => m.id === c.mediaId)?.kind === 'audio' || store.project.media.find((m) => m.id === c.mediaId)?.hasAudio);
  const body = el('div', { class: 'modal ae-modal', id: 'montage-modal' },
    el('h3', { text: 'AUTO-MONTAGE  ·  ตัดต่อตามจังหวะเพลง' }),
    el('div', { class: 'hint', text: hasMusic ? 'Cuts follow the music; shots are chosen from what the footage actually looks like. Everything is analysed on your computer.' : 'Add a music track to the timeline first — the montage is cut to it.' }),
    el('section', { class: 'ae-sec' }, el('h4', { text: 'Style · สไตล์' }), styleBtns,
      el('div', { class: 'ae-row' }, el('label', { text: 'Cut rate' }), el('div', { class: 'ae-ctl' }, el('span', { class: 'hint', text: 'calmer' }), intensity, el('span', { class: 'hint', text: 'frantic' }))),
      el('label', { class: 'chk ae-chk' }, reframe, 'Crop wide footage to fit the canvas, following the action')),
    steps, result,
    el('div', { class: 'actions' }, classic, el('span', { class: 'grow' }), cancel, undo, reroll, closeBtn, run));
  open = true;
  root.replaceChildren(el('div', { class: 'modal-back' }, body));
}
