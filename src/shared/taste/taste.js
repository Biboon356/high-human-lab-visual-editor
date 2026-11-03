// Taste Brain, first version (pure): what the artist keeps and what they let go of, as plain weighted counts. No model, no network: a handful of numbers
// per effect name that fade with time (half-life 45 days), so it follows the artist as their taste moves, and that can be shown, switched off and erased.
// It only ever BIASES (a label, an order, a hint to the AI). It never applies anything. Not confident (too few events, weak weights) = silent.
export const TASTE_VERSION = 1;
export const HALF_LIFE_DAYS = 45;
export const MIN_EVENTS = 5; // fewer than this and it says nothing
export const MIN_SCORE = 0.2; // a reading must fit at least this well to be called "your taste"
export const REGRET_WINDOW_MS = 20000; // an Undo this soon after an Apply counts as "I did not want that"
export const MAX_ITEMS = 120;
export const OPINION = 0.1; // below this a weight is just noise: no view on that effect
const DAY = 86400000;
export const EVENT_WEIGHT = { applied: 1, cancelled: -0.4, regret: -1.2 };

export const emptyProfile = () => ({ v: TASTE_VERSION, events: 0, counts: { applied: 0, cancelled: 0, regret: 0 }, items: {} });
const decayTo = (it, at) => it.w * Math.pow(2, -Math.max(0, at - it.t) / (HALF_LIFE_DAYS * DAY));
const tagOk = (t) => typeof t === 'string' && /^[a-z0-9:_\-]{1,40}$/.test(t);

/** Repairs whatever was stored: unknown shape becomes an empty profile, junk entries are dropped. */
export function cleanProfile(p) {
  if (!p || typeof p !== 'object' || p.v !== TASTE_VERSION || typeof p.items !== 'object' || !p.items) return emptyProfile();
  const out = emptyProfile();
  out.events = Number.isFinite(p.events) && p.events > 0 ? Math.floor(p.events) : 0;
  for (const k of Object.keys(out.counts)) out.counts[k] = Number.isFinite(p.counts?.[k]) && p.counts[k] > 0 ? Math.floor(p.counts[k]) : 0;
  for (const [tag, it] of Object.entries(p.items)) if (tagOk(tag) && it && Number.isFinite(it.w) && Number.isFinite(it.t) && Number.isFinite(it.n)) out.items[tag] = { w: it.w, t: it.t, n: Math.max(0, Math.floor(it.n)) };
  return trim(out);
}
function trim(p) {
  const keys = Object.keys(p.items);
  if (keys.length > MAX_ITEMS) { const keep = keys.sort((a, b) => Math.abs(p.items[b].w) - Math.abs(p.items[a].w)).slice(0, MAX_ITEMS); p.items = Object.fromEntries(keep.map((k) => [k, p.items[k]])); }
  return p;
}

/** @param ev {kind:'applied'|'cancelled'|'regret', tags:string[], at:number (ms)} @returns a new profile (the old one is not changed) */
export function recordEvent(profile, ev) {
  const w = EVENT_WEIGHT[ev?.kind], tags = [...new Set((ev?.tags || []).filter(tagOk))];
  if (w === undefined || !tags.length || !Number.isFinite(ev.at)) return profile;
  const p = cleanProfile(JSON.parse(JSON.stringify(profile)));
  for (const tag of tags) { const it = p.items[tag]; p.items[tag] = it ? { w: decayTo(it, ev.at) + w, t: ev.at, n: it.n + 1 } : { w, t: ev.at, n: 1 }; }
  p.events += 1; p.counts[ev.kind] += 1;
  return trim(p);
}

/** tag -> -1..1 (squashed, so one strong day cannot swamp months). */
export function weights(profile, now) { const out = {}; for (const [tag, it] of Object.entries(profile?.items || {})) out[tag] = Math.tanh(decayTo(it, now) / 2); return out; }
export const confident = (profile) => (profile?.events || 0) >= MIN_EVENTS;

/** How well a set of tags (effect names) fits the artist, and why. Null when it has no right to an opinion. */
export function fit(profile, tags, now) {
  if (!confident(profile)) return null;
  const w = weights(profile, now), mine = [...new Set(tags)].filter((t) => Math.abs(w[t] ?? 0) >= OPINION); // only the effects it actually has a view on
  if (!mine.length) return null;
  const score = mine.reduce((s, t) => s + w[t], 0) / (mine.length + 1); // a mean that grows with the evidence: one liked effect scores about 0.5, three about 0.75
  return { score, liked: mine.filter((t) => w[t] >= 0.25).sort((a, b) => w[b] - w[a]), disliked: mine.filter((t) => w[t] <= -0.25).sort((a, b) => w[a] - w[b]) };
}

/** What to show the artist and what to tell the AI: the strongest likes and dislikes (|weight| of at least 0.25), at most 5 each. */
export function summarize(profile, now) {
  const w = weights(profile, now), rows = Object.entries(w).map(([tag, v]) => ({ tag, w: v, n: profile.items[tag].n }));
  return { events: profile.events, counts: { ...profile.counts }, confident: confident(profile),
    likes: rows.filter((r) => r.w >= 0.25).sort((a, b) => b.w - a.w).slice(0, 5), dislikes: rows.filter((r) => r.w <= -0.25).sort((a, b) => a.w - b.w).slice(0, 5) };
}
export const effectOf = (tag) => (tag.startsWith('fx:') ? tag.slice(3) : null);
