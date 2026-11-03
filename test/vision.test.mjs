import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretVision, refinePlan, findVibes, VIBES, moreIdeas, MAX_IDEAS } from '../src/shared/vision/vibes.js';
import { buildPayload } from '../src/shared/vision/payload.js';
import { makePlan, applyPlan, describePlan, catalogue, plansFromAi, AI_SCHEMA, MAX_PLAN_EFFECTS } from '../src/shared/vision/plan.js';
import { validateChain } from '../src/shared/mutation/chain.js';
import { createProject, createClip } from '../src/shared/project.js';
import { EFFECTS } from '../src/shared/effects-defs.js';

function scene() {
  const p = createProject();
  p.media.push({ id: 'm1', kind: 'video', name: 'v', path: '/x.mp4', duration: 9, width: 64, height: 36 });
  const c = createClip({ type: 'media', mediaId: 'm1', name: 'A', start: 0, duration: 5, trackId: p.tracks.find((t) => t.kind === 'video').id });
  p.clips.push(c);
  return { p, c };
}

test('every dictionary entry builds a valid chain at every strength (no unknown effect or parameter, nothing out of range)', () => {
  for (const v of VIBES) {
    const r = interpretVision(v.words[0]);
    assert.ok(r.ok, `${v.id}: ${r.reason}`);
    assert.equal(r.plans.length, 3, v.id);
    for (const plan of r.plans) {
      const { issues } = validateChain(plan.chain);
      assert.deepEqual(issues, [], `${v.id} / ${plan.title}: ${JSON.stringify(issues)}`);
      assert.ok(plan.chain.length >= 1 && plan.chain.length <= MAX_PLAN_EFFECTS);
    }
  }
});

test('Thai and English words are found; "mid-word" Latin matches are not', () => {
  assert.deepEqual(findVibes('ฉากเหมือนฝันตอนบ่าย สีส้ม').map((h) => h.vibe.id), ['dream', 'warm']);
  assert.deepEqual(findVibes('dreamy warm afternoon like old film').map((h) => h.vibe.id).sort(), ['dream', 'film', 'vintage', 'warm']);
  assert.deepEqual(findVibes('a holder of golden-ish things').map((h) => h.vibe.id), ['warm'], '"old" inside "holder" and "golden-ish" is read as golden only');
  assert.deepEqual(findVibes('xyz nothing here'), []);
});

test('three readings: gentle < balanced < bold in strength, and the phrase is quoted back', () => {
  const r = interpretVision('เกรนฟิล์มเก่าๆ');
  assert.ok(r.ok);
  const [g, b, d] = r.plans;
  assert.match(g.title, /Gentle/); assert.match(b.title, /Balanced/); assert.match(d.title, /Bold/);
  const grain = (pl) => pl.chain.find((c) => c.type === 'film').params.grain;
  assert.ok(grain(g) < grain(b) && grain(b) < grain(d), `${grain(g)} ${grain(b)} ${grain(d)}`);
  assert.ok(r.notes[0].includes('"เก่า"'));
});

test('intensity words shift all three readings', () => {
  const base = interpretVision('glitch').plans[1].chain[0].params.amount;
  assert.ok(interpretVision('glitch heavy').plans[1].chain[0].params.amount > base);
  assert.ok(interpretVision('glitch subtle').plans[1].chain[0].params.amount < base);
});

test('two words naming the same effect merge into one effect, the first word wins', () => {
  const r = interpretVision('dream and foggy');
  const types = r.plans[1].chain.map((c) => c.type);
  assert.equal(new Set(types).size, types.length, `no duplicate effects: ${types}`);
});

test('an unknown phrase says so and offers the way out; an empty one explains', () => {
  const r = interpretVision('quantum marmalade');
  assert.equal(r.ok, false); assert.match(r.reason, /do not know these words/); assert.match(r.reason, /online AI/);
  assert.equal(interpretVision('   ').ok, false);
});

test('beat pulse creates audio links', () => {
  const r = interpretVision('pulse');
  const shake = r.plans[1].chain.find((c) => c.type === 'shake');
  assert.equal(shake.bindings.amount.source, 'beat');
  assert.ok(describePlan(r.plans[1]).some((l) => /← beat/.test(l)));
});

test('applyPlan only adds effects, to the clips asked, with fresh ids; PREVIEW can run it on a copy', () => {
  const { p, c } = scene();
  const plan = interpretVision('dream').plans[1];
  const copy = structuredClone(p);
  assert.equal(applyPlan(copy, [c.id], plan), 1);
  assert.equal(c.effects.length, 0, 'the real project is untouched');
  assert.equal(copy.clips[0].effects.length, plan.chain.length);
  assert.equal(new Set(copy.clips[0].effects.map((e) => e.id)).size, plan.chain.length);
  assert.equal(applyPlan(copy, ['nope'], plan), 0);
});

test('makePlan is the gate: unknown effects, non-addable ones and wild numbers cannot get through', () => {
  const r = makePlan({ title: 't' }, [{ type: 'rm -rf', params: {} }, { type: 'glitch', params: { amount: 999, nonsense: 1 } }, { type: 'grain', params: { amount: NaN } }]);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.chain.map((c) => c.type), ['glitch', 'grain']);
  assert.ok(r.plan.chain[0].params.amount <= EFFECTS.glitch.params[0].max);
  assert.ok(Number.isFinite(r.plan.chain[1].params.amount));
  assert.equal(makePlan({}, [{ type: 'nothing' }]).ok, false);
  assert.equal(makePlan({}, 'not an array').ok, false);
  const many = makePlan({}, Object.keys(EFFECTS).map((type) => ({ type, params: {} })));
  assert.ok(many.plan.chain.length <= MAX_PLAN_EFFECTS);
});

test('plansFromAi: valid candidates become plans, broken ones are skipped, links become bindings, extras are cut at three', () => {
  const raw = { notes: 'ok', candidates: [
    { title: 'A', summary: 's', effects: [{ type: 'grain', params: [{ key: 'amount', value: 0.4 }], links: [{ key: 'amount', signal: 'bass', amount: 0.5 }] }] },
    { title: 'B', summary: 's', effects: [{ type: 'made-up', params: [], links: [] }] },
    { title: 'C', summary: 's', effects: [{ type: 'bloom', params: [{ key: 'intensity', value: 0.7 }, { key: 'evil', value: 1 }], links: [{ key: 'intensity', signal: 'laser', amount: 1 }] }] },
    { title: 'D', summary: 's', effects: [{ type: 'blur', params: [], links: [] }] },
  ] };
  const r = plansFromAi(raw);
  assert.equal(r.plans.length, 2, 'A and C (B has no usable effect; D is the fourth)');
  assert.deepEqual(r.plans[0].chain[0].bindings.amount, { source: 'bass', amount: 0.5 });
  assert.deepEqual(r.plans[1].chain[0].bindings, {}, 'an unknown signal is dropped');
  assert.equal(r.plans[1].chain[0].params.evil, undefined);
  assert.equal(r.skipped.length, 1);
  assert.deepEqual(plansFromAi(null).plans, []); assert.deepEqual(plansFromAi({ candidates: 'x' }).plans, []);
  assert.equal(AI_SCHEMA.additionalProperties, false);
});

test('catalogue: names and safe ranges only', () => {
  const cat = catalogue();
  assert.ok(cat.length > 20);
  const g = cat.find((c) => c.type === 'glitch');
  assert.deepEqual(g.params.find((p) => p.key === 'amount'), { key: 'amount', label: 'Intensity', min: 0.1, max: 0.8, default: 0.5 });
  assert.ok(!JSON.stringify(cat).includes('path'));
});

test('refine: more / less move the main parameter, add / remove change the chain, nothing is guessed', () => {
  const plan = interpretVision('glitch gritty').plans[1];
  const amt = (pl, t) => pl.chain.find((c) => c.type === t).params.amount;
  let r = refinePlan(plan, 'เพิ่ม grain'); assert.ok(r.ok); assert.ok(amt(r.plan, 'grain') > amt(plan, 'grain'));
  r = refinePlan(plan, 'less glitch'); assert.ok(r.ok); assert.ok(amt(r.plan, 'glitch') < amt(plan, 'glitch'));
  r = refinePlan(plan, 'ลด glitch'); assert.ok(r.ok);
  r = refinePlan(plan, 'add bloom'); assert.ok(r.ok); assert.ok(r.plan.chain.some((c) => c.type === 'bloom'));
  r = refinePlan(plan, 'remove glitch'); assert.ok(r.ok); assert.ok(!r.plan.chain.some((c) => c.type === 'glitch'));
  r = refinePlan(plan, 'less overall'); assert.ok(r.ok); assert.ok(r.changes.length >= 2);
  assert.equal(refinePlan(plan, 'make it prettier').ok, false);
  assert.equal(refinePlan(plan, 'more').ok, false, 'which effect?');
  assert.equal(refinePlan(plan, 'less vhs').ok, false, 'vhs is not in this look');
  const single = interpretVision('glitch heavy').plans[0];
  const only = makePlan({ title: 't' }, [{ type: 'grain' }]).plan;
  assert.equal(refinePlan(only, 'remove grain').ok, false, 'the last effect is never removed');
  assert.ok(single);
  assert.deepEqual(plan.chain, interpretVision('glitch gritty').plans[1].chain, 'refining never mutates the original plan');
});

test('more ideas: three new readings per request, never a repeat, nine at most, and it says plainly when the dictionary has run out', () => {
  const text = 'ฝัน อบอุ่น';
  let shown = [...interpretVision(text).plans];
  const rounds = [];
  for (let i = 0; i < 2; i++) { const r = moreIdeas(text, shown); assert.ok(r.ok, r.reason); assert.equal(r.plans.length, 3); rounds.push(...r.plans); shown = [...shown, ...r.plans]; }
  assert.equal(shown.length, MAX_IDEAS);
  const sigs = shown.map((p) => JSON.stringify(p.chain.map((c) => [c.type, c.params])));
  assert.equal(new Set(sigs).size, shown.length, 'no two readings are the same');
  assert.ok(rounds.every((p) => p.source === 'offline'));
  const full = moreIdeas(text, shown); assert.equal(full.ok, false); assert.match(full.reason, /most I show/);
});

test('more ideas differ in character, not just in strength: other moods on their own, and the look with one more ingredient', () => {
  const text = 'ฝัน อบอุ่น';
  const first = interpretVision(text).plans;
  const r = moreIdeas(text, first);
  const firstTypes = new Set(first.map((p) => p.chain.map((c) => c.type).sort().join('+')));
  assert.ok(r.plans.some((p) => !firstTypes.has(p.chain.map((c) => c.type).sort().join('+'))), 'at least one has a different set of effects');
  assert.ok(r.plans.some((p) => /on its own/.test(p.title)), 'a single mood alone is offered when two were named');
  for (const p of r.plans) assert.deepEqual(validateChain(p.chain).issues, [], p.title);
});

test('more ideas: unknown words give a reason, a single mood falls back to ingredients and strengths, and the shown list is never changed', () => {
  assert.equal(moreIdeas('quantum marmalade', []).ok, false);
  const shown = interpretVision('glitch').plans, before = JSON.stringify(shown);
  const r = moreIdeas('glitch', shown); assert.ok(r.ok); assert.ok(r.plans.length >= 1);
  assert.equal(JSON.stringify(shown), before);
});

test('the AI is told what is already on screen (titles and effect names only) so it does not repeat', () => {
  const p = buildPayload({ text: 'dream', avoid: [{ title: 'Dream · Gentle', types: ['blur', 'bloom'] }, ...Array(20).fill({ title: 'x'.repeat(500), types: ['grain'] })] });
  assert.equal(p.alreadyShown.length, 9); assert.deepEqual(p.alreadyShown[0], { title: 'Dream · Gentle', effects: ['blur', 'bloom'] }); assert.equal(p.alreadyShown[1].title.length, 80);
  assert.equal(buildPayload({ text: 'dream' }).alreadyShown, undefined);
});

test('taste only reorders and prunes more ideas: liked ingredients come first, strongly disliked ones are left out while others remain, nothing is invented', () => {
  const text = 'ฝัน', shown = interpretVision(text).plans;
  const plain = moreIdeas(text, shown).plans.map((p) => p.title);
  const likes = moreIdeas(text, shown, 3, { weights: { 'fx:vhs': 0.9, 'fx:film': 0.6 } }).plans;
  assert.ok(likes[0].chain.some((c) => c.type === 'vhs'), `the liked ingredient is offered first (${likes.map((p) => p.title)})`);
  const dislikes = moreIdeas(text, shown, 9, { weights: { 'fx:vhs': -0.9, 'fx:film': -0.9, 'fx:grain': -0.9 } }).plans;
  assert.ok(!dislikes.some((p) => /with (vhs|film|grain)/i.test(p.title)), `no disliked companion is offered (${dislikes.map((p) => p.title)})`);
  assert.deepEqual(moreIdeas(text, shown, 3, { weights: {} }).plans.map((p) => p.title), plain, 'with nothing learned it is exactly as before');
  assert.deepEqual(moreIdeas(text, shown, 3, null).plans.map((p) => p.title), plain);
  const all = new Set(moreIdeas(text, shown, 9, { weights: { 'fx:chroma': 0.9 } }).plans.map((p) => p.title)); assert.ok([...all].every((t) => t.includes('Dream')), 'every idea still comes from the artist\'s own words');
});

test('the AI is told effect names the artist likes and drops, and nothing else about them, only when given', () => {
  const p = buildPayload({ text: 'dream', taste: { likes: ['grain', 'bloom', 'a', 'b', 'c', 'd'], dislikes: ['vhs'] } });
  assert.deepEqual(p.tasteHints.likes, ['grain', 'bloom', 'a', 'b', 'c']); assert.deepEqual(p.tasteHints.dislikes, ['vhs']);
  assert.equal(buildPayload({ text: 'dream' }).tasteHints, undefined); assert.equal(buildPayload({ text: 'dream', taste: { likes: [], dislikes: [] } }).tasteHints, undefined);
  assert.deepEqual(Object.keys(p).sort(), ['catalogue', 'request', 'tasteHints']);
});
