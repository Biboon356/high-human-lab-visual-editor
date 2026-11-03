// Typographic tooltips: replaces the native `title` bubble with a label plus keyboard chips ("Undo" ⌘ Z).
// The name stays available to assistive tech: icon-only buttons get an aria-label from the title before it is removed.
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY = { 'Ctrl/Cmd': isMac ? '⌘' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt' };
const SHORTCUT = /^[\w⌘⇧←→↑↓−+\/-]{1,24}$/;

/** "Undo (Ctrl/Cmd+Z)" → { label: "Undo", keys: ["⌘", "Z"] }; prose in brackets stays part of the label. */
export function parseTip(text) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text);
  if (!m || !SHORTCUT.test(m[2])) return { label: text, keys: [] };
  const keys = m[2].split('+').map((k) => KEY[k.trim()] || k.trim()).filter(Boolean);
  return { label: m[1], keys };
}

export function mountTooltips() {
  const tip = document.getElementById('tip');
  let timer = 0, current = null;
  const hide = () => { clearTimeout(timer); tip.hidden = true; current = null; };
  const place = (target) => {
    const r = target.getBoundingClientRect(), t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2, y = r.bottom + 8;
    if (y + t.height > innerHeight - 6) y = r.top - t.height - 8;
    tip.style.left = `${Math.round(Math.max(6, Math.min(x, innerWidth - t.width - 6)))}px`;
    tip.style.top = `${Math.round(Math.max(6, y))}px`;
  };
  const show = (target) => {
    const { label, keys } = parseTip(target.dataset.tip);
    tip.replaceChildren(Object.assign(document.createElement('span'), { textContent: label }));
    if (keys.length) { const k = document.createElement('span'); k.className = 'keys'; for (const key of keys) k.append(Object.assign(document.createElement('kbd'), { textContent: key })); tip.append(k); }
    tip.hidden = false; place(target); current = target;
  };
  const arm = (target, delay) => {
    if (target.hasAttribute('title')) {
      const v = target.getAttribute('title');
      target.dataset.tip = v;
      if (!target.hasAttribute('aria-label') && !target.textContent.trim()) target.setAttribute('aria-label', parseTip(v).label);
      target.removeAttribute('title');
    }
    if (!target.dataset.tip || target === current) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(target), delay);
  };
  document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('[title],[data-tip]'); if (t) arm(t, 420); else hide(); });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[title],[data-tip]'); if (t && e.target.matches(':focus-visible')) arm(t, 0); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  addEventListener('blur', hide);
}
