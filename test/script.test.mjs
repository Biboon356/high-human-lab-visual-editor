import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { graphemes, hasDevanagari, safeTracking } from '../src/shared/script.js';
import { FONTS, TEXT_PRESETS, LOCKUPS, createTitleLockup, lockupFonts } from '../src/shared/text-defs.js';

const css = fs.readFileSync(new URL('../src/renderer/fonts/fonts.css', import.meta.url), 'utf8');
const lic = fs.readFileSync(new URL('../src/renderer/fonts/LICENSES.txt', import.meta.url), 'utf8').toLowerCase();

test('Hindi clusters stay whole: conjuncts, vowel signs and nukta are one unit each', () => {
  assert.deepEqual(graphemes('हिन्दी'), ['हि', 'न्दी']);
  assert.deepEqual(graphemes('क्षत्रिय'), ['क्ष', 'त्रि', 'य']);
  assert.deepEqual(graphemes('तूफ़ान'), ['तू', 'फ़ा', 'न']);
  assert.deepEqual(graphemes('सड़क'), ['स', 'ड़', 'क']);
  assert.deepEqual(graphemes('AB c'), ['A', 'B', ' ', 'c']);
  assert.equal(graphemes('').length, 0);
  // the cluster list always rebuilds the original string
  for (const s of ['रात की रानी', 'शुभ रात्रि', 'दिल की बात', 'mixed हिन्दी and English']) assert.equal(graphemes(s).join(''), s);
});

test('letter-spacing is never added to Devanagari (it would break the headline bar), Latin keeps it', () => {
  assert.equal(hasDevanagari('Hello हिन्दी'), true);
  assert.equal(hasDevanagari('Hello'), false);
  assert.equal(safeTracking('हिन्दी', 0.3), 0);
  assert.equal(safeTracking('हिन्दी', -0.05), -0.05);
  assert.equal(safeTracking('HELLO', 0.3), 0.3);
});

test('Devanagari and street fonts are bundled with a Devanagari/Latin face per family and a licence', () => {
  const dev = ['Rozha One', 'Yatra One', 'Modak', 'Tiro Devanagari Hindi', 'Eczar', 'Teko', 'Khand', 'Kalam', 'Amita', 'Martel'];
  const street = ['Anton', 'Permanent Marker', 'Special Elite', 'Rubik Spray Paint', 'Black Ops One', 'Rubik Glitch', 'Archivo Black', 'Rock Salt', 'Bungee', 'Bebas Neue'];
  const genre = ['Rubik Distressed', 'Londrina Solid', 'Reenie Beanie', 'Covered By Your Grace', 'Courier Prime', 'Monoton', 'Shrikhand', 'Righteous', 'Audiowide', 'Space Grotesk', 'Space Mono', 'Syne', 'Unbounded', 'Big Shoulders Display', 'Metal Mania', 'New Rocker', 'Cinzel Decorative', 'Grenze Gotisch', 'IM Fell English SC'];
  for (const f of [...dev, ...street, ...genre]) { assert.ok(FONTS.includes(f), `${f} is offered in the font list`); assert.ok(css.includes(`font-family: "${f}"`), `${f} has a @font-face`); assert.ok(lic.includes(f.toLowerCase().split(' ')[0]), `${f} licence`); }
  for (const f of dev) assert.ok(new RegExp(`font-family: "${f}"[^}]*U\\+0900-097F`).test(css), `${f} has a Devanagari-range face`);
});

test('Hindi presets only use fonts that have Devanagari glyphs bundled, and their text is Devanagari', () => {
  const dev = new Set(['Rozha One', 'Yatra One', 'Modak', 'Tiro Devanagari Hindi', 'Eczar', 'Teko', 'Khand', 'Kalam', 'Amita', 'Martel']);
  const hindi = TEXT_PRESETS.filter((p) => hasDevanagari(p.text.content));
  assert.ok(hindi.length >= 10, `${hindi.length} Hindi presets`);
  for (const p of hindi) { assert.ok(dev.has(p.text.font), `${p.name}: ${p.text.font}`); assert.ok(!p.text.vertical, `${p.name}: not vertical`); assert.ok(!(p.props?.tracking > 0), `${p.name}: no spacing`); }
});

test('lockups: every part names a real preset; there are 2- and 3-font combinations; the third part comes back as a clip', () => {
  const names = new Set(TEXT_PRESETS.map((p) => p.name));
  for (const L of LOCKUPS) for (const part of [L.kicker, L.title, L.sub].filter(Boolean)) assert.ok(names.has(part.preset), `${L.name}: ${part.preset}`);
  const counts = LOCKUPS.map((L) => lockupFonts(L).length);
  assert.ok(counts.filter((n) => n === 3).length >= 3 && counts.filter((n) => n === 2).length >= 4, `font counts ${counts}`);
  const three = LOCKUPS.find((L) => L.sub);
  const clips = createTitleLockup(0, 3, { lockup: three.name });
  assert.equal(clips.length, 3);
  assert.ok(new Set(clips.map((c) => c.text.font)).size >= 2);
  assert.equal(createTitleLockup(0, 3, { lockup: 'Rose script' }).length, 2);
  assert.ok(new Set(LOCKUPS.map((L) => L.name)).size === LOCKUPS.length, 'lockup names are unique');
});

test('genre packs: 20+ lockups, at least eight use three fonts, every genre is represented, and the ransom preset is a cut-out text', () => {
  assert.ok(LOCKUPS.length >= 20, `${LOCKUPS.length} lockups`);
  const three = LOCKUPS.filter((L) => lockupFonts(L).length === 3).map((L) => L.name);
  assert.ok(three.length >= 8, `3-font lockups: ${three}`);
  for (const key of ['Ransom', 'Vapor', 'Swiss', 'metal', 'Filmi', 'Mixtape']) assert.ok(LOCKUPS.some((L) => L.name.includes(key)), key);
  const ransom = TEXT_PRESETS.find((p) => p.name === 'Ransom Note (cut-out)');
  assert.equal(ransom.text.ransom, true);
  assert.equal(TEXT_PRESETS.find((p) => p.name === 'Metal Logo (Metal Mania)').text.ransom, undefined, 'only the ransom preset opts in');
});
