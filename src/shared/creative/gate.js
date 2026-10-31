// The Decision Gate: the ONE place that decides whether anything is surfaced. A candidate (suggest.js) must pass every condition:
//   1 RELEVANCE        it belongs to what the artist is doing right now, on the clips they are working with
//   2 CONFIDENCE       there is a clear reason (the bar rises when suggestions get dismissed)
//   3 NOVELTY          nothing like it was dismissed recently, and it is not on screen already
//   4 LOW INTERRUPTION nothing is playing, recording, performing or being typed, the artist paused for a moment, nothing else is showing
//   5 EXPLAINABILITY   the reason fits in one short sentence
// Any doubt means silence. Pure: the caller supplies the state and the time. Silence is the default and the aim.
export const GATE = {
  minConfidence: 0.65, // starts strict and only goes up
  quietMs: 2500, // the last edit was at least this long ago
  minGapMs: 45000, // after one suggestion (shown, ignored or dismissed) wait before the next
  dismissCooldownMs: 10 * 60 * 1000, // the same suggestion is not offered again for this long after a dismiss
  ignoredCooldownMs: 5 * 60 * 1000, // ...or after being left alone until it faded
  maxLine: 90,
  throttleFrom: 5, // from this many shown suggestions the dismissal rate raises the bar
  muteAfterShown: 6, muteRate: 0.8, muteMs: 24 * 60 * 60 * 1000, // dismissed almost every time: be quiet for a day
};

export const newStats = () => ({ shown: 0, dismissed: 0, applied: 0, mutedUntil: 0 });
export function cleanStats(s) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return s && typeof s === 'object' ? { shown: n(s.shown), dismissed: n(s.dismissed), applied: n(s.applied), mutedUntil: n(s.mutedUntil) } : newStats();
}

/** How confident a candidate must be right now: more dismissals raise the bar. */
export function thresholdFor(stats) {
  const rate = stats.shown >= GATE.throttleFrom ? stats.dismissed / stats.shown : 0;
  return Math.min(0.95, GATE.minConfidence + 0.3 * rate);
}

export const recordShown = (s) => ({ ...s, shown: s.shown + 1 });
export const recordApplied = (s) => ({ ...s, applied: s.applied + 1 });
export function recordDismissed(s, now) {
  const next = { ...s, dismissed: s.dismissed + 1 };
  if (next.shown >= GATE.muteAfterShown && next.dismissed / next.shown >= GATE.muteRate) next.mutedUntil = now + GATE.muteMs;
  return next;
}

/**
 * @param c a candidate from suggestFor
 * @param s {now, enabled, context: {kind, clipIds}, selection: ids, playing, busy (take, trace, recording), typing, lastEditAt, active: a
 *   suggestion is already on screen, lastShownAt, cooldowns: {key: untilMs}, stats}
 * @returns {{pass: boolean, failed: string[]}} failed names the conditions that did not hold (empty when it passes)
 */
export function evaluate(c, s) {
  const failed = [];
  if (!s.enabled || (s.stats?.mutedUntil || 0) > s.now) failed.push('off');
  const here = new Set([...(s.selection || []), ...(s.context?.clipIds || [])]);
  if (!c.contexts?.includes(s.context?.kind) || !c.clipIds?.length || !c.clipIds.every((id) => here.has(id))) failed.push('relevance');
  if (!(c.confidence >= thresholdFor(s.stats || newStats()))) failed.push('confidence');
  if ((s.cooldowns?.[c.key] ?? 0) > s.now) failed.push('novelty');
  if (s.playing || s.busy || s.typing || s.active || s.now - (s.lastEditAt ?? -Infinity) < GATE.quietMs || s.now - (s.lastShownAt ?? -Infinity) < GATE.minGapMs) failed.push('interruption');
  if (typeof c.line !== 'string' || !c.line.trim() || c.line.length > GATE.maxLine) failed.push('explainability');
  return { pass: failed.length === 0, failed };
}
