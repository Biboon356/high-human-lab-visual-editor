// "Describe the look" (Looks tab): say the picture in your head in your own words; get three readings (gentle, balanced, bold), PREVIEW each in
// the monitor, refine with a short sentence ("more grain", "remove blur"), then Apply (one Undo step) or Cancel. Nothing is applied by looking.
// Offline it uses a small dictionary of moods; with the optional online AI (your own key, off by default) it can read freer wording.
// If the AI fails or is off, the dictionary still works: the editor carries on.
import { store } from '../store.js';
import { el } from './dom.js';
import { interpretVision, refinePlan } from '/shared/vision/vibes.js';
import { applyPlan, describePlan } from '/shared/vision/plan.js';
import { buildPayload } from '/shared/vision/payload.js';

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function mountVision(root) {
  // the seam: window.hh is frozen by the preload bridge, so the e2e swaps this instead
  const bridge = { status: () => window.hh.aiStatus(), interpret: (o) => window.hh.aiInterpret(o), setKey: (k) => window.hh.aiSetKey(k), clearKey: () => window.hh.aiClearKey() };
  let plans = [], current = null, aiInfo = { hasKey: false, storage: 'memory', models: {}, defaultModel: '' };

  const input = el('textarea', { id: 'vis-input', class: 'vis-input', rows: 3, placeholder: 'The picture in your head, in your own words…  e.g. ฉากเหมือนฝันตอนบ่าย สีส้มซีด · dreamy warm afternoon, a bit like old film', spellcheck: 'false' });
  const go = el('button', { id: 'vis-go', class: 'primary', text: 'Interpret', onclick: () => interpret() });
  const status = el('p', { class: 'hint', id: 'vis-status' });
  const list = el('div', { class: 'vis-list', id: 'vis-list' });
  const refineIn = el('input', { type: 'text', id: 'vis-refine', class: 'vis-refine', placeholder: 'then change it: more grain · ลด glitch · add bloom · remove blur', autocomplete: 'off', spellcheck: 'false' });
  const refineGo = el('button', { id: 'vis-refine-go', text: 'Refine', onclick: () => refine() });
  const refineRow = el('div', { class: 'cmd-row', id: 'vis-refine-row', hidden: true }, refineIn, refineGo);
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
      input, el('div', { class: 'cmd-row' }, go), status, list, refineRow, ai)));

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

  function render() {
    list.replaceChildren(...plans.map((p, i) => el('div', { class: `vis-cand${p === current ? ' on' : ''}`, 'data-vis': i },
      el('b', { text: p.title }), el('span', { class: 'vis-src', text: p.source === 'ai' ? 'AI' : 'offline' }),
      el('ul', { class: 'cmd-list' }, ...describePlan(p).map((t) => el('li', { text: t }))),
      el('button', { id: `vis-prev-${i}`, text: 'PREVIEW', title: 'See it in the monitor on the selected clips (press Space to play it). Nothing is applied until you press Apply.', onclick: () => preview(p) }))));
    refineRow.hidden = !plans.length;
    renderSent();
  }

  function preview(p) {
    const ids = selectedIds();
    if (!ids.length) { status.textContent = 'Select a clip first, then press PREVIEW.'; return; }
    current = p;
    const ok = store.showGhost({ label: p.title, apply: (proj) => applyPlan(proj, ids, p) > 0, done: `${p.title} added. Undo takes it back.` });
    status.textContent = ok ? 'Previewing: press Space to play it. Apply keeps it, Cancel forgets it. Not happy? Refine it below.' : 'That could not be shown on the selected clips.';
    render();
  }

  let fellBack = ''; // why the AI was skipped this time, kept so the answer from the dictionary can still say so
  async function ask(text, withCurrent) {
    fellBack = '';
    if (useAi()) {
      status.textContent = 'Asking the AI…'; go.disabled = refineGo.disabled = true;
      let r; try { r = await bridge.interpret({ model: model.value, input: { text, current: withCurrent && current ? { title: current.title, effects: current.chain } : undefined, clipEffects: effectsOnSelection() } }); } catch (e) { r = { ok: false, reason: e.message }; }
      go.disabled = refineGo.disabled = false;
      if (r.ok) return { plans: r.plans, notes: [r.notes].filter(Boolean), via: 'ai' };
      fellBack = `${r.reason} Used the offline dictionary instead.`;
      status.textContent = fellBack;
    }
    return null;
  }

  async function interpret() {
    store.clearGhost(); current = null;
    const text = input.value.trim();
    const viaAi = await ask(text, false);
    if (viaAi) { plans = viaAi.plans; status.textContent = viaAi.notes[0] || 'Here are three readings.'; render(); return; }
    const r = interpretVision(text);
    if (!r.ok) { plans = []; status.textContent = `${fellBack} ${r.reason}`.trim(); render(); return; }
    plans = r.plans; status.textContent = `${fellBack} ${r.notes.join(' ')} ${useAi() && !fellBack ? '' : 'Offline dictionary.'}`.trim().replace(/\s+/g, ' '); render();
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
    preview(r.plan);
    status.textContent = `${fellBack} ${r.changes.join(', ')}. Previewing: Apply keeps it, Cancel forgets it.`.trim();
  }

  store.on('selection', renderSent);
  loadAi();
  return { bridge, reload: loadAi, get plans() { return plans; } };
}
