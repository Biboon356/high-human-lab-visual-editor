import { el, fmtTime } from './dom.js';
import { store } from '../store.js';
import { paramRow, flatRow, rowUpdaters } from './param-row.js';
import { findMedia } from '/shared/project.js';
import { EFFECTS, EFFECT_PRESETS, createEffect, instantiatePreset } from '/shared/effects-defs.js';
import { CLIP_PROPS, TEXT_PROPS, BLEND_MODES } from '/shared/params.js';
import { FONTS, TEXT_ANIMATIONS } from '/shared/text-defs.js';
import { GEN_PARAMS, GEN_STYLES } from '/shared/organic-defs.js';

const USER_PRESET_KEY = 'hhlab.userEffectPresets';
const loadUserPresets = () => { try { return JSON.parse(localStorage.getItem(USER_PRESET_KEY) || '[]'); } catch { return []; } };
const saveUserPresets = (p) => { try { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } };

const card = (title, body, actions = []) =>
  el('section', { class: 'card' }, el('h4', {}, title, el('span', { class: 'grow' }), actions), el('div', { class: 'body' }, body));

/** Wraps an edit of a plain field: snapshot once, mutate, re-render preview. */
function field(input, event, apply, { structural = false } = {}) {
  let snapped = false;
  input.addEventListener(event, () => {
    if (!snapped) { store.snapshot(); snapped = true; }
    apply(input);
    store.touch(structural ? 'project' : 'render');
  });
  input.addEventListener('change', () => { snapped = false; });
  return input;
}

export function mountInspector(root) {
  let lastId = null;

  const render = () => {
    const clip = store.selectedClip;
    lastId = clip?.id || null;
    rowUpdaters.clear();
    root.replaceChildren();
    if (!clip) {
      root.append(el('div', { class: 'empty', text: 'Select a clip on the timeline to edit its properties, effects and animation.' }));
      return;
    }
    const lt = () => Math.min(Math.max(0, store.playhead - clip.start), clip.duration);
    const media = clip.type === 'media' ? findMedia(store.project, clip.mediaId) : null;

    // ---- Clip
    const nameIn = field(el('input', { type: 'text', value: clip.name }), 'input', (i) => { clip.name = i.value; }, { structural: true });
    const body = [flatRow('Name', nameIn)];
    body.push(el('div', { class: 'stat' }, `start `, el('b', { text: fmtTime(clip.start) }), `  dur `, el('b', { text: fmtTime(clip.duration) }), media ? `  in ` : '', media ? el('b', { text: fmtTime(clip.in) }) : ''));
    if (media?.hasAudio) {
      const vol = el('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: clip.volume ?? 1 });
      body.push(flatRow('Volume', field(vol, 'input', (i) => { clip.volume = Number(i.value); }, { structural: true })));
    }
    if (clip.type !== 'media' || media?.kind !== 'audio') {
      for (const d of CLIP_PROPS) {
        if (clip.type === 'generator' && d.key !== 'opacity') continue;
        body.push(paramRow({ owner: clip, def: d, getBase: () => clip.props[d.key], setBase: (v) => { clip.props[d.key] = v; }, localTime: lt }));
      }
      if (clip.type === 'text') for (const d of TEXT_PROPS) body.push(paramRow({ owner: clip, def: d, getBase: () => clip.props[d.key], setBase: (v) => { clip.props[d.key] = v; }, localTime: lt }));
      const blend = el('select', {}, BLEND_MODES.map((m) => el('option', { value: m, text: m, ...(m === clip.props.blend ? { selected: true } : {}) })));
      body.push(flatRow('Blend', field(blend, 'change', (i) => { clip.props.blend = i.value; })));
    }
    root.append(card(clip.type === 'text' ? 'Text clip' : clip.type === 'generator' ? 'Organic clip' : 'Clip', body));

    if (clip.type === 'text') root.append(textCard(clip, lt));
    if (clip.type === 'generator') root.append(genCard(clip, lt));
    if (clip.type !== 'media' || media?.kind !== 'audio') root.append(effectsCard(clip, lt));
  };

  function textCard(clip, lt) {
    const T = clip.text;
    const ta = field(el('textarea', { rows: 3, spellcheck: false }), 'input', (i) => { T.content = i.value; });
    ta.value = T.content;
    const fontList = el('datalist', { id: 'font-list' }, FONTS.map((f) => el('option', { value: f })));
    const font = field(el('input', { type: 'text', value: T.font, list: 'font-list' }), 'input', (i) => { T.font = i.value; });
    const weight = field(el('select', {}, [300, 400, 500, 700, 900].map((w) => el('option', { value: w, text: w, ...(w === T.weight ? { selected: true } : {}) }))), 'change', (i) => { T.weight = Number(i.value); });
    const size = field(el('input', { type: 'range', min: 0.01, max: 0.5, step: 0.005, value: T.size }), 'input', (i) => { T.size = Number(i.value); });
    const align = el('div', { class: 'seg' }, ['left', 'center', 'right'].map((a) =>
      el('button', { class: T.align === a ? 'on' : '', text: a[0].toUpperCase(), title: a, onclick: () => { store.mutate(() => { T.align = a; }, 'project'); } })));
    const color = field(el('input', { type: 'color', value: T.color }), 'input', (i) => { T.color = i.value; });
    const stroke = field(el('input', { type: 'range', min: 0, max: 0.15, step: 0.002, value: T.strokeWidth }), 'input', (i) => { T.strokeWidth = Number(i.value); });
    const strokeC = field(el('input', { type: 'color', value: T.strokeColor }), 'input', (i) => { T.strokeColor = i.value; });
    const upper = field(el('input', { type: 'checkbox', checked: T.uppercase }), 'change', (i) => { T.uppercase = i.checked; });
    const italic = field(el('input', { type: 'checkbox', checked: T.italic }), 'change', (i) => { T.italic = i.checked; });
    const bgOn = field(el('input', { type: 'checkbox', checked: T.bg.enabled }), 'change', (i) => { T.bg.enabled = i.checked; });
    const bgC = field(el('input', { type: 'color', value: T.bg.color }), 'input', (i) => { T.bg.color = i.value; });
    const bgPad = field(el('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: T.bg.pad }), 'input', (i) => { T.bg.pad = Number(i.value); });
    const anim = field(el('select', {}, Object.entries(TEXT_ANIMATIONS).map(([k, v]) => el('option', { value: k, text: v, ...(k === T.anim.type ? { selected: true } : {}) }))), 'change', (i) => { T.anim.type = i.value; });
    const aDur = field(el('input', { type: 'range', min: 0.1, max: 12, step: 0.05, value: T.anim.duration }), 'input', (i) => { T.anim.duration = Number(i.value); });
    const aSpd = field(el('input', { type: 'range', min: 0.1, max: 4, step: 0.05, value: T.anim.speed }), 'input', (i) => { T.anim.speed = Number(i.value); });
    return card('Typography', [ta, fontList, flatRow('Font', font), flatRow('Weight', weight, el('label', { class: 'chk' }, italic, 'italic')),
      flatRow('Size', size), flatRow('Align', align, el('label', { class: 'chk' }, upper, 'CAPS')), flatRow('Fill', color),
      flatRow('Outline', stroke, strokeC), flatRow('Plate', bgOn, bgC, bgPad),
      flatRow('Animation', anim), flatRow('Anim. time', aDur), flatRow('Anim. speed', aSpd)]);
  }

  function genCard(clip, lt) {
    const G = clip.gen;
    const style = field(el('select', {}, Object.entries(GEN_STYLES).map(([k, v]) => el('option', { value: k, text: v, ...(k === G.style ? { selected: true } : {}) }))), 'change', (i) => { G.style = i.value; });
    const tr = field(el('input', { type: 'checkbox', checked: G.transparent }), 'change', (i) => { G.transparent = i.checked; });
    const rows = GEN_PARAMS.map((d) => paramRow({ owner: G, def: d, getBase: () => G.params[d.key], setBase: (v) => { G.params[d.key] = v; }, localTime: lt }));
    return card('Organic engine', [flatRow('Style', style), flatRow('Transparent', tr), ...rows]);
  }

  function effectsCard(clip, lt) {
    const addSel = el('select', {}, el('option', { value: '', text: '+ Add effect…' }), Object.entries(EFFECTS).map(([k, v]) => el('option', { value: k, text: v.label })));
    addSel.addEventListener('change', () => {
      if (!addSel.value) return;
      store.mutate(() => clip.effects.push(createEffect(addSel.value)));
    });
    const user = loadUserPresets();
    const presetSel = el('select', {}, el('option', { value: '', text: 'Presets…' }),
      EFFECT_PRESETS.map((p, i) => el('option', { value: `b${i}`, text: p.name })),
      user.map((p, i) => el('option', { value: `u${i}`, text: `★ ${p.name}` })));
    presetSel.addEventListener('change', () => {
      const v = presetSel.value; if (!v) return;
      const p = v[0] === 'b' ? EFFECT_PRESETS[Number(v.slice(1))] : user[Number(v.slice(1))];
      store.mutate(() => {
        if (v[0] === 'b') clip.effects.push(...instantiatePreset(p));
        else clip.effects.push(...p.chain.map((e) => createEffect(e.type, e.params)));
      });
    });
    const saveBtn = el('button', { text: 'Save chain', title: 'Save this clip\'s effect chain as a preset', onclick: () => {
      if (!clip.effects.length) return;
      const name = prompt('Preset name?'); if (!name) return;
      saveUserPresets([...loadUserPresets(), { name, chain: clip.effects.map((e) => ({ type: e.type, params: { ...e.params } })) }]);
      render();
    } });
    const list = clip.effects.map((fx, i) => {
      const def = EFFECTS[fx.type];
      const en = field(el('input', { type: 'checkbox', checked: fx.enabled, title: 'Enable' }), 'change', (inp) => { fx.enabled = inp.checked; }, { structural: false });
      en.addEventListener('change', () => render());
      const move = (d) => store.mutate(() => { const j = i + d; if (j < 0 || j >= clip.effects.length) return; [clip.effects[i], clip.effects[j]] = [clip.effects[j], clip.effects[i]]; });
      const sec = el('section', { class: `card fx-card ${fx.enabled ? '' : 'off'}` },
        el('h4', {}, en, def.label, el('span', { class: 'grow' }),
          el('button', { text: '↑', title: 'Move earlier in chain', disabled: i === 0, onclick: () => move(-1) }),
          el('button', { text: '↓', title: 'Move later in chain', disabled: i === clip.effects.length - 1, onclick: () => move(1) }),
          el('button', { text: '✕', title: 'Remove', onclick: () => store.mutate(() => clip.effects.splice(i, 1)) })),
        el('div', { class: 'body' }, def.params.map((d) => paramRow({ owner: fx, def: d, getBase: () => fx.params[d.key] ?? d.def, setBase: (v) => { fx.params[d.key] = v; }, localTime: lt }))));
      return sec;
    });
    const c = card('Effects chain (top → bottom)', [el('div', { class: 'fx-toolbar' }, addSel, presetSel, saveBtn),
      clip.effects.length ? null : el('div', { class: 'hint', text: 'No effects. Add one, or start from a preset.' })]);
    // effect cards are nested outside the card body so they keep their own chrome
    const holder = el('div', {}, c, ...list.map((s) => { s.style.marginTop = '8px'; return s; }));
    return holder;
  }

  // Re-render only when the selection or clip structure changes; slider drags use 'render' and never rebuild.
  store.on('selection', render);
  store.on('project', () => { if (!document.activeElement || !root.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') render(); else if (lastId !== store.selection) render(); });
  store.on('playhead', () => { for (const u of rowUpdaters) u(); });
  store.on('keyframes', () => { for (const u of rowUpdaters) u(); });
  render();
}
