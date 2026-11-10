// Font lab (Type tab): make a font of your own from one of the bundled fonts. Pick a base, a way to move its outlines and how strongly; see it on your own words,
// next to the original; save it. A saved font is just a recipe in the project (rebuilt when the project opens) and is used on text by name. Thai keeps working:
// the rules that place vowels and tone marks are copied from the base untouched. Nothing is applied to a clip until you press "Use on the selected text" (one Undo step).
import { store } from '../store.js';
import { el } from './dom.js';
import { BASES, MOVES, MAX_RECIPES, normalizeRecipe, suggestName } from '/shared/fonts/recipes.js';
import { ensureRecipeFont, dropRecipeFont } from '../engine/font-recipes.js';
import { diag } from '../diag.js';

export function mountFontLab(root) {
  const api = { ensure: ensureRecipeFont };
  const base = el('select', { id: 'fl-base', 'aria-label': 'Start from' }, ...Object.entries(BASES).map(([id, b]) => el('option', { value: id, text: `${b.label} (${b.scripts})` })));
  const move = el('select', { id: 'fl-move', 'aria-label': 'How to change it' }, ...Object.entries(MOVES).map(([id, m]) => el('option', { value: id, text: m.label, title: m.hint })));
  const strength = el('input', { type: 'range', id: 'fl-strength', min: -1, max: 1, step: 0.05, value: MOVES.slant.def });
  const shown = el('b', { id: 'fl-strength-val' });
  const seed = el('input', { type: 'number', id: 'fl-seed', min: 1, max: 9999, step: 1, value: 3, title: 'The same seed always gives the same font' });
  const dice = el('button', { id: 'fl-dice', text: '🎲', title: 'Another seed', onclick: () => { seed.value = String(1 + Math.floor(Math.random() * 9999)); changed(); } });
  const name = el('input', { type: 'text', id: 'fl-name', maxlength: 40, autocomplete: 'off', spellcheck: 'false' });
  const sample = el('input', { type: 'text', id: 'fl-sample', value: 'น้ำที่ ก้ กิ สวัสดี Brand 2026', maxlength: 60, autocomplete: 'off', spellcheck: 'false', title: 'Your own words, to see the font on' });
  const canvas = el('canvas', { id: 'fl-preview', width: 560, height: 150, class: 'fl-preview', role: 'img', 'aria-label': 'Preview of the font' });
  const status = el('p', { class: 'hint', id: 'fl-status' });
  const list = el('div', { class: 'fl-list', id: 'fl-list' });
  const save = el('button', { id: 'fl-save', class: 'primary', text: 'Save this font', onclick: () => saveFont() });
  const hintLine = el('p', { class: 'hint', id: 'fl-hint' });
  root.append(el('section', { class: 'card', id: 'fontlab-card' }, el('h4', { text: 'Font lab' }),
    el('div', { class: 'body' },
      el('p', { class: 'hint', text: 'Make a font of your own from one of the bundled fonts. Thai tone marks and vowels keep their places. The new font is saved in the project as a small recipe and used on text by its name.' }),
      el('div', { class: 'cmd-row' }, base), el('div', { class: 'cmd-row' }, move, strength, shown), hintLine,
      el('div', { class: 'cmd-row' }, el('label', { class: 'fl-lbl', text: 'seed' }), seed, dice, name), sample, canvas, status, el('div', { class: 'cmd-row' }, save),
      el('p', { class: 'hint sub', text: 'Saved fonts' }), list,
      el('p', { class: 'hint', text: 'Made from fonts under the SIL Open Font License. A new font keeps the copyright and licence notices of its base and gets its own name; the licences are in the app\'s fonts folder (LICENSES.txt).' }))));

  const current = () => normalizeRecipe({ id: 'draft', name: name.value, base: base.value, move: move.value, strength: Number(strength.value), seed: Number(seed.value) });
  const clampToMove = () => { const m = MOVES[move.value]; strength.min = m.min; strength.max = m.max; if (Number(strength.value) < m.min || Number(strength.value) > m.max) strength.value = m.def; hintLine.textContent = m.hint; shown.textContent = String(+Number(strength.value).toFixed(2)); };
  const newDefaultName = () => { name.value = suggestName(move.value, store.project.fontRecipes || []); };

  // the preview: the font as it is now, over the original, both on your own words (a temporary name per build; the previous temporary font is forgotten)
  let token = 0, previous = null, timer = 0;
  async function paint() {
    const my = ++token, r = current(); if (!r) return;
    const draft = { ...r, name: `HHLAB Preview ${my}` };
    try {
      await ensureRecipeFont(draft);
      if (my !== token) { dropRecipeFont(draft); return; }
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, text = sample.value || 'Brand';
      const css = getComputedStyle(document.documentElement);
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = css.getPropertyValue('--panel2').trim() || '#161616'; ctx.fillRect(0, 0, w, h);
      const ink = css.getPropertyValue('--text').trim() || '#ddd', dim = css.getPropertyValue('--dim').trim() || '#888';
      const b = BASES[r.base]; ctx.textBaseline = 'alphabetic';
      const fit = (px, fam) => { ctx.font = `${b.weight} ${px}px "${fam}"`; const m = ctx.measureText(text).width, room = w - 40; return m > room ? Math.max(12, Math.floor(px * room / m)) : px; }; // shrink to fit, never squash
      const big = fit(52, draft.name), small = fit(30, b.family);
      ctx.fillStyle = ink; ctx.font = `${b.weight} ${big}px "${draft.name}"`; ctx.fillText(text, 14, 66);
      ctx.fillStyle = dim; ctx.font = `${b.weight} ${small}px "${b.family}"`; ctx.fillText(text, 14, 118);
      ctx.font = '10px monospace'; ctx.fillText('the original', w - 76, h - 8);
      canvas.dataset.painted = String(my); canvas.dataset.font = draft.name; status.textContent = '';
      if (previous) dropRecipeFont(previous); previous = draft;
    } catch (e) { status.textContent = `The font could not be made: ${e.message}`; }
  }
  const changed = () => { clampToMove(); clearTimeout(timer); timer = setTimeout(paint, 140); };
  for (const x of [base, move, strength, seed, sample]) x.addEventListener(x === strength || x === seed || x === sample ? 'input' : 'change', () => { if (x === move) newDefaultName(); changed(); });
  name.addEventListener('input', () => { /* the name is only used when you save */ });

  function renderList() {
    const rs = store.project.fontRecipes || [];
    list.replaceChildren(...(rs.length ? rs.map((r, i) => el('div', { class: 'fl-item', 'data-fl': i },
      el('b', { text: r.name, style: `font-family: "${r.name}"` }), el('span', { class: 'vis-src', text: `${BASES[r.base]?.label.split(':')[0] || r.base} · ${MOVES[r.move]?.label || r.move} ${+r.strength.toFixed(2)}` }),
      el('div', { class: 'cmd-row' }, el('button', { id: `fl-use-${i}`, text: 'Use on the selected text', onclick: () => useFont(r) }), el('button', { id: `fl-del-${i}`, text: 'Delete', onclick: () => deleteFont(r) })))) : [el('p', { class: 'hint', id: 'fl-empty', text: 'None yet.' })]));
  }

  async function saveFont() {
    const r = current(); if (!r) return;
    const rs = store.project.fontRecipes || [];
    if (rs.length >= MAX_RECIPES) { status.textContent = `A project keeps up to ${MAX_RECIPES} fonts: delete one first.`; return; }
    if (rs.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) { status.textContent = `You already have a font called "${r.name}": give it another name.`; return; }
    const rec = { ...r, id: `fr_${Math.random().toString(36).slice(2, 10)}` };
    try { await ensureRecipeFont(rec); } catch (e) { status.textContent = `The font could not be made: ${e.message}`; return; }
    store.mutate((p) => { p.fontRecipes = [...(p.fontRecipes || []), rec]; });
    diag.count('fontlab.save'); store.emit('render'); newDefaultName(); status.textContent = `"${rec.name}" is saved in this project. Select a text clip and press "Use on the selected text".`;
  }
  function useFont(r) {
    const clip = store.selectedClip;
    if (!clip || clip.type !== 'text') { status.textContent = 'Select a text clip on the timeline first.'; return; }
    store.mutate((p) => { const c = p.clips.find((x) => x.id === clip.id); c.text.font = r.name; c.text.weight = 400; c.text.italic = false; }); // a recipe font has one weight: do not let the browser fake a bold
    status.textContent = `The selected text now uses "${r.name}". Undo takes it back.`;
  }
  function deleteFont(r) {
    store.mutate((p) => { p.fontRecipes = (p.fontRecipes || []).filter((x) => x.id !== r.id); });
    status.textContent = `"${r.name}" is deleted. Text that used it falls back to another font.`;
  }

  store.on('project', renderList); store.on('reset', () => { renderList(); newDefaultName(); });
  clampToMove(); newDefaultName(); renderList(); changed();
  return api;
}
