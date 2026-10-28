import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FONTS, TEXT_PRESETS, LOCKUPS, createTextClip, createTitleLockup } from '../src/shared/text-defs.js';

const css = fs.readFileSync(new URL('../src/renderer/fonts/fonts.css', import.meta.url), 'utf8');
const fontDir = new URL('../src/renderer/fonts/', import.meta.url);

test('every preset font is in the font list, and every bundled family ships its file and licence', () => {
  const names = new Set(FONTS.map((f) => (typeof f === 'string' ? f : f.name || f.family)));
  for (const p of TEXT_PRESETS) assert.ok(names.has(p.text.font), `${p.name}: font "${p.text.font}" is not in FONTS`);
  for (const m of css.matchAll(/url\(['"]?([^'")]+\.woff2)['"]?\)/g)) assert.ok(fs.existsSync(new URL(m[1].replace(/^\.\//, ''), fontDir)), `missing ${m[1]}`);
  const lic = fs.readFileSync(new URL('LICENSES.txt', fontDir), 'utf8');
  for (const fam of ['Michroma', 'Orbitron', 'Press Start 2P', 'UnifrakturCook', 'Pirata One', 'DotGothic16', 'Dela Gothic One', 'Zen Antique']) assert.match(lic.toLowerCase(), new RegExp(fam.split(' ')[0].toLowerCase()), `${fam} licence`);
});

test('new presets: vertical Japanese, chrome gradient with stops, katakana pixel type', () => {
  const by = (n) => TEXT_PRESETS.find((p) => p.name.startsWith(n));
  assert.equal(by('Tokyo Vertical').text.vertical, true);
  assert.match(by('Tokyo Vertical').text.content, /東京/);
  const chrome = by('Y2K Chrome Bubble').text;
  assert.ok(chrome.fx.gradStops.length >= 5 && chrome.fx.gradStops.every(([at]) => at >= 0 && at <= 1));
  assert.ok(chrome.fx.gradStops.every((s, i, a) => !i || s[0] >= a[i - 1][0]), 'gradient stops are ordered');
  assert.match(by('Cyber Katakana').text.content, /[ァ-ヶー]/);
  assert.equal(createTextClip(by('Digicam'), 0, 3).type, 'text');
});

test('every lockup builds a kicker and a title clip and honours custom words', () => {
  assert.ok(LOCKUPS.length >= 4);
  for (const L of LOCKUPS) {
    const [k, t] = createTitleLockup(1, 3, { lockup: L.name, kicker: 'KICK', title: 'Main\nTitle' });
    assert.equal(k.text.content, 'KICK'); assert.equal(t.text.content, 'Main\nTitle');
    assert.equal(k.start, 1); assert.equal(t.duration, 3);
    assert.ok(FONTS.some((f) => (f.name || f.family || f) === t.text.font));
  }
});
