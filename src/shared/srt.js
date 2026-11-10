// SubRip / WebVTT reading and SRT writing. Pure.
const TS = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

export function parseTime(s) {
  const m = TS.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** @returns {Array<{start:number,end:number,text:string}>} cues (markup tags stripped, multi-line text joined with \n) */
export function parseSubtitles(src) {
  const text = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => !(i === 0 && (/^WEBVTT/.test(l) || /^\d+$/.test(l.trim()) && a.length > 1 && /-->/.test(a[1]))));
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const [a, b] = lines[k].split('-->');
    const start = parseTime(a), end = parseTime(b.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const body = lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function formatTime(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))},${pad(ms % 1000, 3)}`;
}

export function serializeSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${formatTime(c.start)} --> ${formatTime(c.end)}\n${c.text}\n`).join('\n');
}
