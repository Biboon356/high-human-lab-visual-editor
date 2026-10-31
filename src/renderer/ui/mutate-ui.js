// Mutate tab: roll variations of the selected clip's effect chain, compare them on the real frame, keep what you like, and save
// favourites as DNA. Everything it makes is an ordinary effect chain applied with one store.mutate (one Undo step); the media is
// never touched. The maths lives in shared/mutation/; this file is only the surface.
import { el, toast } from './dom.js';
import { store } from '../store.js';
import { VariationRenderer } from '../engine/variation-preview.js';
import { USER_PRESET_KEY } from './inspector.js';
import { sampleFeatures } from '/shared/audio-analysis.js';
import { activeVisualClips } from '/shared/timeline.js';
import { findMedia } from '/shared/project.js';
import { EFFECTS, WET } from '/shared/effects-defs.js';
import { supportsWet } from '/shared/mutation/effect-meta.js';
import { effectsToChain, chainToEffects } from '/shared/mutation/chain.js';
import { variations, mutate, generate } from '/shared/mutation/mutate.js';
import { newSeed } from '/shared/mutation/rng.js';
import { normalizeDna, createDna, dnaFromRoll, addDna, removeDna, renameDna, duplicateDna, libraryOf, diffChains, builtinDna, exportDna, parseDnaFile, migrateUserPresets } from '/shared/mutation/dna.js';

const STYLES = [['', 'Any style'], ['analog', 'Analog / tape'], ['camera', 'Camera / Y2K'], ['distort', 'Glitch / distort'], ['print', 'Print / zine'], ['colour', 'Colour'], ['organic', 'Organic'], ['pattern', 'Desi pattern'], ['scene', '3D / synth']];
const COUNTS = [4, 6, 9];

const shortName = (type) => (EFFECTS[type]?.label || type).split(/[ (/]/)[0];
const describe = (chain) => (chain.filter((c) => c.enabled !== false).map((c) => shortName(c.type)).join(' · ') || 'no effects');

export function mountMutate({ preview }) {
  const root = document.getElementById('mutate-root');
  const pane = root.closest('.pane');
  const renderer = new VariationRenderer();
  const st = { seed: null, strength: 0.5, count: 6, style: '', heavy: true, base: null, items: [], cmp: new Set(), ab: { a: 0, b: null }, wipe: 50, lean: false };
  const identity = () => normalizeDna(store.project.living?.dna).dna?.identity || null; // the Project DNA's identity, if the project has one
  const chainAt = (n) => (n === 0 ? baseChain() : st.items[n - 1]?.chain || null); // cell 0 is Current, then the variations

  // ---- the clip being worked on ----
  const target = () => {
    const clip = store.selectedClip;
    if (!clip) return null;
    if (clip.type === 'media' && findMedia(store.project, clip.mediaId)?.kind === 'audio') return null; // sound has no picture to mutate
    return clip;
  };
  const baseChain = () => (st.base ? st.base.chain : effectsToChain(target()?.effects || []));
  const opts = () => {
    const bias = st.style ? { [st.style]: 5 } : {};
    const idn = st.lean ? identity() : null; // optional: rolls lean the way the project's identity leans (never on their own)
    if (idn) for (const [k, w] of Object.entries(idn.biases)) bias[k] = (bias[k] || 0) + w;
    return { strength: st.strength, bias, maxHeavy: st.heavy ? 1 : 0 };
  };
  const rollOne = (base, seed) => (base.length ? mutate(base, { ...opts(), seed }) : generate({ ...opts(), seed }));

  // ---- controls ----
  const status = el('p', { class: 'hint pad mut-status', id: 'mutate-status' });
  const strength = el('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(st.strength * 100), id: 'mutate-strength', 'aria-label': 'Strength' });
  const strengthOut = el('span', { class: 'mut-out', text: `${Math.round(st.strength * 100)}%` });
  strength.addEventListener('input', () => { st.strength = Number(strength.value) / 100; strengthOut.textContent = `${strength.value}%`; });
  const count = el('select', { id: 'mutate-count', 'aria-label': 'How many variations' }, COUNTS.map((n) => el('option', { value: n, text: `${n} variations`, ...(n === st.count ? { selected: true } : {}) })));
  count.addEventListener('change', () => { st.count = Number(count.value); });
  const style = el('select', { id: 'mutate-style', 'aria-label': 'Style' }, STYLES.map(([v, l]) => el('option', { value: v, text: l })));
  style.addEventListener('change', () => { st.style = style.value; });
  const heavy = el('input', { type: 'checkbox', checked: st.heavy, id: 'mutate-heavy' });
  heavy.addEventListener('change', () => { st.heavy = heavy.checked; });
  const leanBox = el('input', { type: 'checkbox', id: 'mutate-lean' });
  leanBox.addEventListener('change', () => { st.lean = leanBox.checked; });
  const leanRow = el('label', { class: 'mut-row chk', hidden: true, title: 'Uses the style leanings of the Project DNA (Living tab → DNA)' }, leanBox, 'lean toward the project\'s identity');
  const seedInput = el('input', { type: 'number', min: 0, step: 1, placeholder: 'seed', id: 'mutate-seed', 'aria-label': 'Seed' });
  seedInput.addEventListener('input', () => { seedInput.dataset.manual = '1'; });
  const rollBtn = el('button', { class: 'primary', id: 'mutate-roll', text: 'Roll', title: 'New variations. Type a seed first to reproduce an earlier roll exactly.', onclick: () => roll() });
  const baseBar = el('div', { class: 'mut-base', id: 'mutate-base', hidden: true });
  const lookSel = el('select', { id: 'mutate-look', 'aria-label': 'Start from a look' }, el('option', { value: '', text: 'Start from a look…' }));
  for (const group of ['effect', 'look', 'organic']) {
    const og = el('optgroup', { label: { effect: 'Effect chains', look: 'Y2K / street / desi looks', organic: 'Organic looks' }[group] });
    for (const d of builtinDna().filter((x) => x.source.group === group)) og.append(el('option', { value: d.id, text: d.name }));
    lookSel.append(og);
  }
  lookSel.addEventListener('change', () => {
    const d = builtinDna().find((x) => x.id === lookSel.value);
    lookSel.value = '';
    if (d) { st.base = { chain: structuredClone(d.chain), label: d.name }; roll(); renderKeep(); }
  });
  let keepOpen = false;
  const keep = el('details', { class: 'mut-keep', id: 'mutate-keep' });
  keep.addEventListener('toggle', () => { keepOpen = keep.open; });
  const grid = el('div', { class: 'mut-grid', id: 'mutate-grid' });
  const library = el('div', { class: 'mut-lib', id: 'mutate-lib' });

  root.append(
    status,
    el('div', { class: 'mut-controls' },
      el('label', { class: 'mut-row' }, 'Strength', strength, strengthOut),
      el('div', { class: 'mut-row' }, count, style),
      el('label', { class: 'mut-row chk' }, heavy, 'allow one heavy effect (pattern, 3D)'), leanRow,
      el('div', { class: 'mut-row' }, seedInput, rollBtn)),
    baseBar, lookSel, grid, keep, library);

  // ---- rolling ----
  function roll() {
    const clip = target();
    if (!clip) { toast('Select a picture clip, text, shape or adjustment layer first.', 'error'); return; }
    const manual = seedInput.dataset.manual === '1' && seedInput.value !== '' && Number.isFinite(Number(seedInput.value));
    const seed = manual ? Math.floor(Math.abs(Number(seedInput.value))) % 4294967296 : newSeed();
    seedInput.value = seed; delete seedInput.dataset.manual;
    st.seed = seed;
    st.items = variations(baseChain(), { ...opts(), seed, count: st.count });
    st.ab = { a: 0, b: null };
    buildGrid(); paint();
  }

  function reroll(i) {
    const seed = newSeed(), v = rollOne(baseChain(), seed);
    st.items[i] = { seed, chain: v.chain, report: v.report };
    buildGrid(); paint();
  }

  const apply = (chain, what) => {
    const clip = target();
    if (!clip) return;
    store.mutate(() => { clip.effects = chainToEffects(chain); });
    toast(`Applied ${what}. Undo (Ctrl/Cmd+Z) takes it back.`);
  };

  function saveDna(item) {
    const clip = target();
    if (!clip) return;
    const name = document.getElementById('mutate-dna-name')?.value.trim();
    let dna;
    if (item) dna = dnaFromRoll({ base: baseChain(), options: { ...opts(), seed: item.seed }, mode: baseChain().length ? 'mutate' : 'generate', name: name || `Roll ${item.seed}` }).dna;
    else dna = createDna({ name: name || `${clip.name || 'Clip'} chain`, chain: effectsToChain(clip.effects), source: { kind: 'manual' } }).dna;
    if (!dna.chain.length) { toast('That chain has no effects to save.', 'error'); return; }
    store.mutate(() => { addDna(store.project, dna); });
    toast(`Saved “${dna.name}” to this project's DNA.`);
  }

  // ---- the grid ----
  const cellSize = () => { const { width, height } = store.project.settings, k = 320 / Math.max(width, height); return [Math.max(2, Math.round(width * k)), Math.max(2, Math.round(height * k))]; };
  let canvases = [];
  let abCanvases = null;

  function buildGrid() {
    grid.replaceChildren();
    canvases = [];
    abCanvases = null;
    baseBar.hidden = !st.base;
    baseBar.replaceChildren(...(st.base ? [el('span', { text: `Rolling from: ${st.base.label}` }), el('button', { text: '↺ back to the clip', id: 'mutate-base-reset', onclick: () => { st.base = null; st.items = []; buildGrid(); paint(); renderKeep(); } })] : []));
    if (!target()) return;
    const [w, h] = cellSize();
    const cells = [{ label: 'Current', chain: baseChain(), seed: null, report: null }, ...st.items.map((v, i) => ({ label: `#${i + 1}`, ...v, i }))];
    if (st.ab.a >= cells.length) st.ab.a = 0;
    if (st.ab.b !== null && st.ab.b >= cells.length) st.ab.b = null;
    // A/B: two cells at once, with a wipe — B is shown left of the divider, A to its right
    if (st.ab.b !== null && st.ab.b !== st.ab.a) {
      const ca = el('canvas', { width: w, height: h }), cb = el('canvas', { width: w, height: h });
      abCanvases = [ca, cb];
      const wipe = el('input', { type: 'range', min: 0, max: 100, value: st.wipe, id: 'mutate-wipe', 'aria-label': 'Wipe between A and B' });
      const clipB = () => { cb.style.clipPath = `inset(0 ${100 - st.wipe}% 0 0)`; };
      wipe.addEventListener('input', () => { st.wipe = Number(wipe.value); clipB(); }); clipB();
      grid.append(el('div', { class: 'mut-ab', id: 'mutate-ab' },
        el('div', { class: 'mut-wipe' }, ca, cb),
        wipe,
        el('div', { class: 'mut-ab-cap' }, el('span', { text: `B · ${cells[st.ab.b].label} ${describe(cells[st.ab.b].chain)}` }), el('span', { text: `A · ${cells[st.ab.a].label} ${describe(cells[st.ab.a].chain)}` })),
        el('button', { text: 'Close', id: 'mutate-ab-close', onclick: () => { st.ab.b = null; buildGrid(); paint(); } })));
    }
    cells.forEach((c, n) => {
      const cv = el('canvas', { width: w, height: h });
      canvases.push(cv);
      const rep = c.report ? `+${c.report.added.length} −${c.report.removed.length} ~${c.report.changed.length}` : '';
      const buttons = c.seed === null
        ? [el('button', { text: '★ Save', title: 'Save this chain as DNA', 'data-mut-save': '', onclick: () => saveDna(null) })]
        : [el('button', { class: 'primary', text: 'Use', title: 'Apply this chain to the clip (one Undo step)', 'data-mut-use': c.i, onclick: () => apply(c.chain, `variation ${c.label}`) }),
          el('button', { text: 'More', title: 'More like this: roll again starting from this variation', 'data-mut-like': c.i, onclick: () => { st.base = { chain: structuredClone(c.chain), label: `variation ${c.label} (seed ${c.seed})` }; roll(); renderKeep(); } }),
          el('button', { text: '⟳', title: 'Re-roll only this one', 'data-mut-reroll': c.i, onclick: () => reroll(c.i) }),
          el('button', { text: '★', title: 'Save as DNA (keeps the seed, so it can be reproduced)', 'data-mut-save': c.i, onclick: () => saveDna(c) })];
      grid.append(el('div', { class: 'mut-cell', 'data-mut-cell': n, 'data-seed': c.seed ?? '', 'data-types': c.chain.map((x) => x.type).join(',') },
        cv,
        el('div', { class: 'mut-cap' }, el('b', { text: c.label }), el('span', { text: describe(c.chain), title: describe(c.chain) }),
          el('span', { class: 'mut-abbtn' },
            el('button', { text: 'A', class: st.ab.a === n ? 'on' : '', title: 'Compare: put this in slot A', 'data-mut-a': n, onclick: () => { st.ab.a = n; if (st.ab.b === n) st.ab.b = null; buildGrid(); paint(); } }),
            el('button', { text: 'B', class: st.ab.b === n ? 'on' : '', title: 'Compare: put this in slot B (shows the wipe)', 'data-mut-b': n, onclick: () => { st.ab.b = n; if (st.ab.a === n) st.ab.a = 0; buildGrid(); paint(); } }))),
        el('div', { class: 'mut-meta', text: c.seed === null ? `${c.chain.length} effects` : `seed ${c.seed} · ${rep}`, title: c.seed === null ? '' : 'Type this seed in the box and press Roll to reproduce this exact result' }),
        el('div', { class: 'mut-act' }, buttons)));
    });
  }

  function paint() {
    const clip = target();
    status.textContent = '';
    if (!clip) { status.textContent = 'Select a clip on the timeline (picture, text, shape or adjustment layer), then press Roll.'; return; }
    if (!pane.classList.contains('on') || store.playing) return;
    const live = activeVisualClips(store.project, store.playhead).some((c) => c.id === clip.id);
    if (!live) { status.textContent = `Move the playhead onto “${clip.name || 'the clip'}” to see the variations on its frame.`; return; }
    const features = store.project.reactive?.enabled ? sampleFeatures(store.analysis, store.playhead) : null;
    const cells = [baseChain(), ...st.items.map((v) => v.chain)];
    const draw = (chain, target) => renderer.paint({ project: store.project, sources: preview.sources, t: store.playhead, features, clipId: clip.id, chain, target });
    try {
      cells.forEach((chain, n) => { if (canvases[n]) draw(chain, canvases[n]); });
      if (abCanvases) { draw(chainAt(st.ab.a), abCanvases[0]); draw(chainAt(st.ab.b), abCanvases[1]); }
    } catch (e) { status.textContent = `Could not draw the variations: ${e.message}`; console.error(e); }
  }
  let timer = 0;
  const schedulePaint = () => { clearTimeout(timer); timer = setTimeout(paint, 80); };

  // ---- locks (kept on the clip's own effects, so they survive Apply, save and re-roll) ----
  function renderKeep() {
    keep.replaceChildren();
    const clip = target();
    if (!clip || st.base || !clip.effects.length) { keep.hidden = true; return; }
    keep.hidden = false;
    const locked = clip.effects.filter((f) => f.locked || f.lockedParams?.length).length;
    keep.append(el('summary', { text: `Keep — never changed by a roll${locked ? ` · ${locked} locked` : ''}` }));
    keep.open = keepOpen;
    const changed = () => store.touch('render');
    for (const fx of clip.effects) {
      const def = EFFECTS[fx.type];
      if (!def) continue;
      const lock = el('input', { type: 'checkbox', checked: !!fx.locked, 'data-lock-fx': fx.type });
      const params = el('details', {}, el('summary', { text: 'values' }), el('div', { class: 'mut-params' }, [...def.params, ...(supportsWet(fx.type) ? [WET] : [])].map((d) => {
        const on = !!fx.lockedParams?.includes(d.key);
        const cb = el('input', { type: 'checkbox', checked: on || !!fx.locked, disabled: !!fx.locked, 'data-lock-param': `${fx.type}.${d.key}` });
        cb.addEventListener('change', () => {
          const set = new Set(fx.lockedParams || []);
          if (cb.checked) set.add(d.key); else set.delete(d.key);
          if (set.size) fx.lockedParams = [...set]; else delete fx.lockedParams;
          changed();
        });
        return el('label', { class: 'chk' }, cb, d.label);
      })));
      lock.addEventListener('change', () => { if (lock.checked) fx.locked = true; else delete fx.locked; changed(); renderKeep(); });
      keep.append(el('div', { class: 'mut-fx' }, el('label', { class: 'chk' }, lock, def.label), params));
    }
  }

  // ---- the DNA library ----
  function renderLibrary() {
    library.replaceChildren();
    const lib = libraryOf(store.project);
    st.cmp = new Set([...st.cmp].filter((id) => lib.some((d) => d.id === id)));
    const name = el('input', { type: 'text', id: 'mutate-dna-name', placeholder: 'name for the next save', maxlength: 80, 'aria-label': 'DNA name' });
    const typed = document.getElementById('mutate-dna-name')?.value;
    if (typed) name.value = typed;
    let old = [];
    try { old = JSON.parse(localStorage.getItem(USER_PRESET_KEY) || '[]'); } catch { /* storage unavailable */ }
    const pending = migrateUserPresets(old, lib).items;
    library.append(
      el('h3', { text: `Saved DNA · ${lib.length}` }),
      el('div', { class: 'mut-row' }, name, el('button', { text: 'Save chain', id: 'mutate-save-current', title: "Save the selected clip's whole chain as DNA", disabled: !target() || !target().effects.length, onclick: () => saveDna(null) })),
      el('div', { class: 'mut-row' },
        el('button', { text: 'Import…', id: 'mutate-import', title: 'Open a .hhdna file', onclick: importFile }),
        pending.length ? el('button', { text: `Bring in my saved chains (${pending.length})`, id: 'mutate-migrate', title: 'Chains saved earlier with “Save chain” in the Effects card', onclick: () => { store.mutate(() => { for (const d of pending) addDna(store.project, d); }); toast(`Brought in ${pending.length} saved chain${pending.length === 1 ? '' : 's'}.`); } }) : null));
    for (const d of lib) {
      const cb = el('input', { type: 'checkbox', checked: st.cmp.has(d.id), title: 'Tick two to compare', 'data-dna-cmp': d.id });
      cb.addEventListener('change', () => { if (cb.checked) st.cmp.add(d.id); else st.cmp.delete(d.id); if (st.cmp.size > 2) st.cmp.delete([...st.cmp][0]); renderLibrary(); });
      library.append(el('div', { class: 'mut-dna', 'data-dna': d.id },
        el('label', { class: 'chk' }, cb, el('b', { text: d.name })),
        el('small', { text: `${describe(d.chain)}${d.seed !== null ? ` · seed ${d.seed}` : ''}${d.parentId ? ' · from another DNA' : ''}` }),
        el('div', { class: 'mut-act' },
          el('button', { text: 'Apply', 'data-dna-apply': d.id, disabled: !target(), title: 'Replace the selected clip\'s chain (one Undo step)', onclick: () => apply(d.chain, `“${d.name}”`) }),
          el('button', { text: 'Roll from', 'data-dna-base': d.id, disabled: !target(), title: 'Roll variations starting from this DNA', onclick: () => { st.base = { chain: structuredClone(d.chain), label: `DNA “${d.name}”` }; roll(); renderKeep(); } }),
          el('button', { text: 'Copy', 'data-dna-copy': d.id, onclick: () => { store.mutate(() => { addDna(store.project, duplicateDna(d)); }); } }),
          el('button', { text: 'Rename', 'data-dna-rename': d.id, onclick: () => rename(d) }),
          el('button', { text: 'Export', 'data-dna-export': d.id, onclick: () => exportFile(d) }),
          el('button', { text: '✕', title: 'Delete', 'data-dna-del': d.id, onclick: () => store.mutate(() => { removeDna(store.project, d.id); }) }))));
    }
    if (st.cmp.size === 2) {
      const [a, b] = [...st.cmp].map((id) => lib.find((d) => d.id === id));
      const df = diffChains(a, b);
      const lines = df.identical ? ['Identical.'] : [
        df.added.length ? `Only in “${b.name}”: ${df.added.map(shortName).join(', ')}` : null,
        df.removed.length ? `Only in “${a.name}”: ${df.removed.map(shortName).join(', ')}` : null,
        df.reordered ? 'The shared effects run in a different order.' : null,
        df.enabled.length ? `On/off differs: ${df.enabled.map(shortName).join(', ')}` : null,
        ...df.changed.slice(0, 14).map((c) => `${shortName(c.type)} · ${c.key}: ${fmt(c.from)} → ${fmt(c.to)}`),
        df.changed.length > 14 ? `… and ${df.changed.length - 14} more value${df.changed.length - 14 === 1 ? '' : 's'}` : null].filter(Boolean);
      library.append(el('pre', { class: 'mut-diff', id: 'mutate-diff', text: `${a.name}  ↔  ${b.name}\n${lines.join('\n')}` }));
    }
  }
  const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

  function rename(d) {
    const row = library.querySelector(`[data-dna="${d.id}"] b`);
    const input = el('input', { type: 'text', value: d.name, maxlength: 80, 'data-dna-rename-input': d.id });
    row.replaceWith(input); input.focus(); input.select();
    let finished = false; // Enter rebuilds the list, which removes the input and fires blur: the second call must do nothing
    const done = (ok) => {
      if (finished) return;
      finished = true;
      if (ok && input.value.trim()) store.mutate(() => { renameDna(store.project, d.id, input.value); }); else renderLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true), { once: true });
  }

  async function exportFile(d) {
    try {
      const file = await window.hh.saveDna(exportDna(d), d.name);
      if (file) toast(`Exported to ${file.split(/[\\/]/).pop()}`);
    } catch (e) { toast(`Could not export: ${e.message}`, 'error'); }
  }

  async function importFile() {
    try {
      const f = await window.hh.openDna();
      if (!f) return;
      const r = parseDnaFile(f.text, libraryOf(store.project));
      if (!r.items.length) { toast(r.issues[0]?.message || 'There was nothing usable in that file.', 'error'); return; }
      store.mutate(() => { for (const d of r.items) addDna(store.project, d); });
      toast(`Imported ${r.items.length} DNA${r.rejected ? ` (${r.rejected} could not be used)` : ''}.`);
    } catch (e) { toast(`Could not import: ${e.message}`, 'error'); }
  }

  // ---- keeping up with the project ----
  const refreshLean = () => { const has = !!identity(); leanRow.hidden = !has; if (!has) { st.lean = false; leanBox.checked = false; } };
  const refreshAll = () => { refreshLean(); buildGrid(); renderKeep(); renderLibrary(); paint(); };
  store.on('selection', () => { st.items = []; st.base = null; st.ab = { a: 0, b: null }; refreshAll(); });
  store.on('reset', () => { st.items = []; st.base = null; st.cmp.clear(); st.ab = { a: 0, b: null }; refreshAll(); });
  store.on('project', () => {
    refreshLean();
    if (!pane.classList.contains('on') && !st.items.length) return;
    // the "Current" cell and the library follow the project; rolled variations stay as they are
    const clip = target();
    if (!clip) { st.items = []; st.base = null; }
    buildGrid(); renderKeep(); renderLibrary(); paint();
  });
  store.on('playhead', schedulePaint);
  refreshAll();
  return { state: st, roll, paint, renderer };
}
