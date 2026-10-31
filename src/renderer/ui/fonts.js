// Installed-font list for the Typography Lab (Chromium's Local Font Access API; main process grants only that permission).
import { FONTS } from '/shared/text-defs.js';

let loading = null;

/** Resolves to a sorted, de-duplicated list of family names (built-in suggestions first if the API is unavailable). */
export function systemFonts() {
  loading ||= (async () => {
    try {
      const faces = await window.queryLocalFonts();
      return [...new Set(faces.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  })();
  return loading;
}

/** One shared <datalist id="font-list">, filled with the common list immediately and the system list when it arrives. */
export function ensureFontList() {
  let dl = document.getElementById('font-list');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'font-list';
    document.body.append(dl);
    const fill = (names) => dl.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n })));
    fill(FONTS);
    systemFonts().then((sys) => { if (sys.length) fill([...new Set([...FONTS.filter((f) => f.includes('-') || ['sans-serif', 'serif', 'monospace'].includes(f)), ...sys])]); });
  }
  return dl;
}
