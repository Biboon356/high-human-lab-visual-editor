// The optional online interpreter: sends ONE typed sentence (plus the list of effects and their safe ranges) to Claude with the user's own key,
// and gets back up to three look plans in a fixed shape. No Electron imports here, so it can be tested with a fake server.
// What leaves the computer: the sentence, the current look's effect names/numbers, the names of the effects already on the selected clip, and the
// public catalogue of effects. Never video, pictures, audio, file names or paths.
import { AI_SCHEMA, plansFromAi } from '../shared/vision/plan.js';
import { buildPayload, clean } from '../shared/vision/payload.js';
export { buildPayload };

export const AI_MODELS = {
  'claude-opus-5-5': 'Opus 5.5 · most capable',
  'claude-sonnet-5-5': 'Sonnet 5.5 · balanced',
  'claude-haiku-5-5': 'Haiku 5.5 · fastest, cheapest',
};
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

const SYSTEM = `You turn a short description of a visual look into effect chains for a video editor used by musicians and music-video makers.
The user's wording may be Thai or English and may be poetic ("like a dream on a hot afternoon"); read the mood, do not ask questions.
Answer with exactly three candidates in the given JSON shape: a gentle, a balanced and a bold reading of the same request.
Rules:
- Use ONLY effect types and parameter keys from the catalogue, and keep every value inside its [min, max]. Colours are not available: leave them out.
- 2 to 5 effects per candidate; do not repeat an effect type inside one candidate. Order does not matter, the editor orders them.
- "links" make a parameter follow the music (signal: rms=loudness, bass, mid, high, beat; amount between -1 and 1). Add links only when the request is about music, rhythm or reacting; otherwise leave links empty.
- If "current" is given, the request is a refinement of that look: keep what the user did not mention and change what they asked for.
- If "alreadyShown" is given, the user wants three NEW readings that are clearly different in character from those (different effects or a different mood), not the same ideas at another strength.
- If "tasteHints" is given, these are effects the artist often keeps (likes) and often drops (dislikes): lean towards the likes and away from the dislikes, but still honour what they asked for.
- "notes" is one short sentence in the user's language saying how you read the request.
- Never include anything except the JSON.`;

const fail = (code, reason) => ({ ok: false, code, reason });

/**
 * @returns {Promise<{ok:true, plans, notes, skipped} | {ok:false, code:'no-key'|'auth'|'rate'|'offline'|'declined'|'cut'|'bad-answer'|'error', reason:string}>}  never throws
 */
export async function interpretWithClaude({ apiKey, model = DEFAULT_AI_MODEL, baseURL, input, loader, signal } = {}) {
  if (!apiKey) return fail('no-key', 'No API key saved yet.');
  if (!AI_MODELS[model]) return fail('error', `Unknown model "${model}".`);
  let Anthropic;
  try { Anthropic = (await (loader ? loader() : import('@anthropic-ai/sdk'))).default; }
  catch (e) { return fail('error', `The AI library could not be loaded (${e.code || e.message}).`); }
  const client = new Anthropic({ apiKey, baseURL: baseURL || undefined, maxRetries: 1, timeout: 90_000 });
  const payload = buildPayload(input);
  if (!payload.request.trim()) return fail('error', 'Nothing to interpret.');
  try {
    const res = await client.messages.create({
      model, max_tokens: 8000, system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }, { signal });
    if (res.stop_reason === 'refusal') return fail('declined', 'The AI declined this request. Try different words.');
    if (res.stop_reason === 'max_tokens') return fail('cut', 'The AI ran out of room before finishing. Try a shorter description.');
    const block = (res.content || []).find((b) => b.type === 'text');
    let raw; try { raw = JSON.parse(block?.text ?? ''); } catch { return fail('bad-answer', 'The AI answered in a shape I could not read.'); }
    const out = plansFromAi(raw);
    if (!out.plans.length) return fail('bad-answer', 'The AI gave nothing I can use as effects.');
    return { ok: true, plans: out.plans, notes: out.notes, skipped: out.skipped };
  } catch (e) {
    const A = Anthropic;
    if (e instanceof A.AuthenticationError || e instanceof A.PermissionDeniedError) return fail('auth', 'The API key was not accepted. Check it and save it again.');
    if (e instanceof A.RateLimitError) return fail('rate', 'Too many requests right now or the account is out of credit. Try again in a moment.');
    if (e instanceof A.APIConnectionError) return fail('offline', 'Could not reach the AI (no internet?). The offline dictionary still works.');
    if (e instanceof A.APIError) return fail('error', `The AI service said: ${clean(e.message, 160)}`);
    return fail('error', `The AI request failed: ${clean(e?.message, 160)}`);
  }
}
