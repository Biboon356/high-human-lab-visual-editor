// Persists the correction dictionary (see shared/glossary.js) in this browser profile.
import { normalizeGlossary } from '/shared/glossary.js';

const KEY = 'hhlab.glossary';

export function loadGlossary() {
  try { return normalizeGlossary(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

export function saveGlossary(list) {
  const clean = normalizeGlossary(list);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* storage unavailable: corrections still apply this session */ }
  return clean;
}

/** Adds entries, newest winning on a clashing `from`. Returns the saved list. */
export function addCorrections(entries) {
  return saveGlossary([...loadGlossary(), ...entries]);
}
