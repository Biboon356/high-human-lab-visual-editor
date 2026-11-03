// "Describe the look" (Looks tab): say the picture in your head in your own words; get three readings (gentle, balanced, bold), PREVIEW each in
// the monitor, refine with a short sentence ("more grain", "remove blur"), then Apply (one Undo step) or Cancel. Nothing is applied by looking.
// Offline it uses a small dictionary of moods; with the optional online AI (your own key, off by default) it can read freer wording.
// If the AI fails or is off, the dictionary still works: the editor carries on.
import { store } from '../store.js';
import { el } from './dom.js';
import { interpretVision, refinePlan, moreIdeas, MAX_IDEAS } from '/shared/vision/vibes.js';
import { applyPlan, describePlan } from '/shared/vision/plan.js';
import { buildPayload } from '/shared/vision/payload.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { MAX_DESCRIBE_SECONDS, MAX_SECONDS } from '/shared/command/dictation.js';
import { attachDictation } from './dictation-button.js';

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function mountVision(root, { preview, renderer } = {}) {
  // the seam: window.hh is frozen by the preload bridge, so the e2e swaps this instead
  const bridge = { status: () => window.hh.aiStatus(), interpret: (o) => window.hh.aiInterpret(o), setKey: (k) => window.hh.aiSetKey(k), clearKey: () => window.hh.aiClearKey(), dictate: (o) => window.hh.asrDictate(o) };
  let plans = [], current = null, aiInfo = { hasKey: false, storage: 'memory', models: {}, defaultModel: '' };

  const input = el('textarea', { id: 'vis-input', class: 'vis-input', rows: 3, placeholder: 'The picture in your head, in your own words…  e.g. ฉากเหมือนฝันตอนบ่าย สีส้มซีด · dreamy warm afternoon, a bit like old film', spellcheck: 'false' });
  const go = el('button', { id: 'vis-go', class: 'primary', text: 'Interpret', onclick: () => interpret() });
  const mic = el('button', { id: 'vis-mic', class: 'cmd-mic', text: '🎙 Hold to speak', title: 'Hold, describe the picture out loud (up to 30 seconds), let go. The words appear in the box for you to fix; nothing runs until you press Interpret. Recognised on this computer: no sound leaves it.' });
  const lang = el('select', { id: 'vis-lang', title: 'The language you speak in' }, el('option', { value: 'th', text: 'ไทย' }), el('option', { value: 'en', text: 'English' }));
  const pauseChk = el('input', { type: 'checkbox', id: 'vis-pause', checked: true });
  const more = el('button', { id: 'vis-more', text: 'Show different ideas', hidden: true, title: 'Three more readings that differ in character (up to 9 in all). With the online AI this is another request on your account.', onclick: () => moreReadings() });
  const refineMic = el('button', { id: 'vis-refine-mic', class: 'cmd-mic', text: '🎙 Hold to speak', title: 'Hold and say what to change, let go, then press Refine.' });
  const status = el('p', { class: 'hint', id: 'vis-status' });
  const list = el('div', { class: 'vis-list', id: 'vis-list' });
  const refineIn = el('input', { type: 'text', id: 'vis-refine', class: 'vis-refine', placeholder: 'then change it: more grain · ลด glitch · add bloom · remove blur', autocomplete: 'off', spellcheck: 'false' });
  const refineGo = el('button', { id: 'vis-refine-go', text: 'Refine', onclick: () => refine() });
  const refineRow = el('div', { class: 'cmd-row', id: 'vis-refine-row', hidden: true }, refineIn, refineGo, refineMic);
  refineIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); refine(); } });

  const aiOn = el('input', { type: 'checkbox', id: 'vis-ai-on', checked: lsGet('hhlab.vision.ai', '0') === '1' });
  const model = el('select', { id: 'vis-model', title: 'Which Claude model reads your sentence. Costs are charged to your own account.' });
  const key = el('input', { type: 'password', id: 'vis-key', class: 'vis-key', placeholder: 'sk-ant-…  (your own Anthropic API key)', autocomplete: 'off', spellcheck: 'false' });
  const keySave = el('button', { id: 'vis-key-save', text: 'Save key' }), keyClear = el('button', { id: 'vis-key-clear', text: 'Remove key' });
  const keyStatus = el('p', { class: 'hint', id: 'vis-key-status' });
  const sent = el('pre', { class: 'vis-sent', id: 'vis-sent' });
  const sentBox = el('details', { class: 'vis-sentbox' }, el('summary', { text: 'What would be sent' }), sent);
  const ai = el('details', { class: 'liv-adv', id: 'vis-ai' }, el('summary', { text: 'AI (online, optional)' }),
    el('p', { class: 'hint', text: 'Off by default. When on, the sentence you type is sent to Anthropic (Claude) with your own API key, so freer wording can be understood. No video, pictures, audio, file names or paths are ever sent; open "What would be sent" to see it exactly. The key is stored encrypted by your operating system. If the AI cannot be reached, the offline dictionary is used.' }),
    el('label', { class: 'chk' }, aiOn, 'Use the online AI'), el('div', { class: 'cmd-row' }, model), el('div', { class: 'cmd-row' }, key, keySave, keyClear), keyStatus, sentBox);

  root.append(el('section', { class: 'card', id: 'vision-card' }, el('h4', { text: 'Describe the look' }),
    el('div', { class: 'body' },
      el('p', { class: 'hint', text: 'Say the picture in your head. You get three readings of it (gentle, balanced, bold) to preview on the selected clips; nothing is applied until you press Apply.' }),
      input, el('div', { class: 'cmd-row' }, go, mic, lang, el('label', { class: 'chk', title: 'The microphone also hears the song. Playback is paused while you hold the button and resumed after.' }, pauseChk, 'Pause playback while I speak')), status, list, el('div', { class: 'cmd-row' }, more), refineRow, ai)));

  try { lang.value = localStorage.getItem('hhlab.cmd.lang') || 'th'; } catch { /* storage unavailable */ }
  lang.addEventListener('change', () => lsSet('hhlab.cmd.lang', lang.value));
  attachDictation({ mic, input, setStatus: (t) => { status.textContent = t; }, getLang: () => lang.value, pauseChk, preview, dictate: (o) => bridge.dictate(o), maxSeconds: MAX_DESCRIBE_SECONDS, append: true,
    doneText: 'Is that what you said? Fix any word, then press Interpret. Nothing has changed yet.' });
  attachDictation({ mic: refineMic, input: refineIn, setStatus: (t) => { status.textContent = t; }, getLang: () => lang.value, pauseChk, preview, dictate: (o) => bridge.dictate(o), maxSeconds: MAX_SECONDS,
    doneText: 'Is that what you said? Fix any word, then press Refine. Nothing has changed yet.' });

  const selectedIds = () => [...store.multi];
  const effectsOnSelection = () => { const c = store.selectedClip; return c ? (c.effects || []).map((e) => e.type) : []; };
  const useAi = () => aiOn.checked && aiInfo.hasKey;

  function renderSent() { sent.textContent = JSON.stringify({ ...buildPayload({ text: input.value, current: current ? { title: current.title, effects: current.chain } : undefined, clipEffects: effectsOnSelection() }), catalogue: '(the public list of effects and their safe ranges, no personal data)' }, null, 1); }
  function renderKey() {
    keyStatus.textContent = aiInfo.hasKey ? `A key is saved (${aiInfo.storage === 'encrypted' ? 'encrypted by your operating system' : 'kept in memory for this session only: this computer cannot encrypt it'}).` : 'No key saved.';
    if (aiOn.checked && !aiInfo.hasKey) keyStatus.textContent += ' Add one to use the AI; until then the offline dictionary is used.';
  }
  async function loadAi() {
    try { aiInfo = await bridge.status(); } catch { /* the editor carries on without it */ }
    const saved = lsGet('hhlab.vision.model', '');
    model.replaceChildren(...Object.entries(aiInfo.models || {}).map(([id, label]) => el('option', { value: id, text: label })));
    model.value = aiInfo.models?.[saved] ? saved : aiInfo.defaultModel || model.value;
    renderKey(); renderSent();
  }
  aiOn.addEventListener('change', () => { lsSet('hhlab.vision.ai', aiOn.checked ? '1' : '0'); renderKey(); renderSent(); });
  model.addEventListener('change', () => lsSet('hhlab.vision.model', model.value));
  input.addEventListener('input', renderSent);
  keySave.addEventListener('click', async () => { const r = await bridge.setKey(key.value); if (r.ok) { key.value = ''; await loadAi(); } else keyStatus.textContent = r.reason; });
  keyClear.addEventListener('click', async () => { await bridge.clearKey(); key.value = ''; await loadAi(); });

  const thumbOf = () => el('canvas', { class: 'vis-thumb', width: 0, height: 0, hidden: true });
  function render() {
    const nowThumb = thumbOf(); nowThumb.dataset.now = '1';
    const cards = plans.map((p, i) => { const th = thumbOf(); th.dataset.plan = String(i);
      return el('div', { class: `vis-cand${p === current ? ' on' : ''}`, 'data-vis': i }, th,
        el('div', { class: 'vis-body' }, el('b', { text: p.title }), el('span', { class: 'vis-src', text: p.source === 'ai' ? 'AI' : 'offline' }),
          el('ul', { class: 'cmd-list' }, ...describePlan(p).map((t) => el('li', { text: t }))),
          el('button', { id: `vis-prev-${i}`, text: 'PREVIEW', title: 'See it in the monitor on the selected clips (press Space to play it). Nothing is applied until you press Apply.', onclick: () => previewPlan(p) }))); });
    list.replaceChildren(...(plans.length ? [el('div', { class: 'vis-cand vis-now' }, nowThumb, el('div', { class: 'vis-body' }, el('b', { text: 'Now' }), el('span', { class: 'vis-src', text: 'your frame' })))] : []), ...cards);
    refineRow.hidden = !plans.length;
    more.hidden = !plans.length; more.disabled = plans.length >= MAX_IDEAS; more.textContent = plans.length >= MAX_IDEAS ? `That is the most I show (${MAX_IDEAS})` : 'Show different ideas';
    renderSent(); paintThumbs();
  }

  // a small picture of each reading on the frame you are working on (the selected clip at the playhead), drawn by the same renderer as the monitor
  let paintToken = 0;
  function paintThumbs() {
    const token = ++paintToken;
    const clip = store.selectedClip;
    const thumbs = [...list.querySelectorAll('canvas.vis-thumb')];
    if (!clip || !renderer || !preview?.sources || !thumbs.length) { thumbs.forEach((c) => { c.hidden = true; }); return; }
    const s = store.project.settings, h = 72, w = Math.max(48, Math.min(128, Math.round(h * (s.width / s.height))));
    const inside = store.playhead >= clip.start && store.playhead < clip.start + clip.duration;
    const t = inside ? store.playhead : clip.start + Math.min(0.4, clip.duration / 2);
    const features = store.project.reactive?.enabled ? sampleFeatures(store.analysis, t) : null;
    let i = 0;
    const next = () => {
      if (token !== paintToken || i >= thumbs.length) return;
      const c = thumbs[i++];
      try {
        const copy = structuredClone(store.project);
        if (c.dataset.plan !== undefined) applyPlan(copy, [clip.id], plans[Number(c.dataset.plan)]);
        c.width = w; c.height = h;
        renderer.paintProject({ project: copy, sources: preview.sources, t, features, target: c });
        c.hidden = false; c.dataset.painted = '1';
      } catch (e) { c.hidden = true; console.error(e); }
      setTimeout(next, 0); // one at a time, so typing and playback stay smooth
    };
    next();
  }

  function previewPlan(p) { // (not called `preview`: that name is the monitor's preview passed to mountVision)
    const ids = selectedIds();
    if (!ids.length) { status.textContent = 'Select a clip first, then press PREVIEW.'; return; }
    current = p;
    const ok = store.showGhost({ label: p.title, apply: (proj) => applyPlan(proj, ids, p) > 0, done: `${p.title} added. Undo takes it back.` });
    status.textContent = ok ? 'Previewing: press Space to play it. Apply keeps it, Cancel forgets it. Not happy? Refine it below.' : 'That could not be shown on the selected clips.';
    render();
  }

  let fellBack = '', lastText = ''; // why the AI was skipped this time, kept so the answer from the dictionary can still say so
  async function ask(text, withCurrent, avoid) {
    fellBack = '';
    if (useAi()) {
      status.textContent = 'Asking the AI…'; go.disabled = refineGo.disabled = more.disabled = true;
      let r; try { r = await bridge.interpret({ model: model.value, input: { text, current: withCurrent && current ? { title: current.title, effects: current.chain } : undefined, clipEffects: effectsOnSelection(), avoid } }); } catch (e) { r = { ok: false, reason: e.message }; }
      go.disabled = refineGo.disabled = false; more.disabled = plans.length >= MAX_IDEAS;
      if (r.ok) return { plans: r.plans, notes: [r.notes].filter(Boolean), via: 'ai' };
      fellBack = `${r.reason} Used the offline dictionary instead.`;
      status.textContent = fellBack;
    }
    return null;
  }

  async function interpret() {
    store.clearGhost(); current = null;
    const text = input.value.trim(); lastText = text;
    const viaAi = await ask(text, false);
    if (viaAi) { plans = viaAi.plans; status.textContent = viaAi.notes[0] || 'Here are three readings.'; render(); return; }
    const r = interpretVision(text);
    if (!r.ok) { plans = []; status.textContent = `${fellBack} ${r.reason}`.trim(); render(); return; }
    plans = r.plans; status.textContent = `${fellBack} ${r.notes.join(' ')} ${useAi() && !fellBack ? '' : 'Offline dictionary.'}`.trim().replace(/\s+/g, ' '); render();
  }

  async function moreReadings() {
    if (!plans.length || plans.length >= MAX_IDEAS) return;
    const text = lastText || input.value.trim();
    const viaAi = await ask(text, false, plans.map((p) => ({ title: p.title, types: p.chain.map((c) => c.type) })));
    let add = null, note = '';
    if (viaAi) { add = viaAi.plans; note = viaAi.notes[0] || 'Three more readings from the AI (another request on your account).'; }
    else { const r = moreIdeas(text, plans); if (!r.ok) { status.textContent = `${fellBack} ${r.reason}`.trim(); return; } add = r.plans; note = `${fellBack} Three more readings from the offline dictionary.`.trim(); }
    plans = [...plans, ...add.slice(0, MAX_IDEAS - plans.length)];
    status.textContent = `${note} ${plans.length} in all.`; render();
  }

  async function refine() {
    const text = refineIn.value.trim();
    if (!current) { status.textContent = 'Preview one of the readings first, then say what to change.'; return; }
    const viaAi = await ask(text, true);
    if (viaAi) { plans = viaAi.plans; current = null; status.textContent = viaAi.notes[0] || 'Here are three new readings.'; render(); refineIn.value = ''; return; }
    const r = refinePlan(current, text);
    if (!r.ok) { status.textContent = `${fellBack} ${r.reason}`.trim(); return; }
    const i = plans.indexOf(current); if (i >= 0) plans[i] = r.plan;
    refineIn.value = '';
    previewPlan(r.plan);
    status.textContent = `${fellBack} ${r.changes.join(', ')}. Previewing: Apply keeps it, Cancel forgets it.`.trim();
  }

  store.on('selection', () => { renderSent(); paintThumbs(); });
  store.on('reset', () => { plans = []; current = null; lastText = ''; status.textContent = ''; render(); }); // a new or opened project: the old readings belonged to the old one
  loadAi();
  return { bridge, reload: loadAi, get plans() { return plans; } };
}
