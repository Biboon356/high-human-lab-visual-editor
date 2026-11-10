// Dictation helpers (pure): turn what the microphone heard into 16 kHz Int16 PCM that is safe to hand to Whisper, and clean up what comes back.
// Whisper invents words ("thank you for watching") when it is given silence, so quiet or very short takes are refused here, before any model runs.
export const DICTATION_RATE = 16000;
export const MIN_SECONDS = 0.4; // shorter than this is a click or a bump, not a sentence
export const MAX_SECONDS = 15; // a command, not a speech
export const MAX_DESCRIBE_SECONDS = 30; // describing a picture takes longer than giving a command
export const HARD_MAX_SECONDS = 45;
/** The longest take allowed for a request, kept between the command length and a hard cap. */
export const clampSeconds = (s) => Math.min(HARD_MAX_SECONDS, Math.max(MAX_SECONDS, Number(s) || MAX_SECONDS));
export const PAD_SECONDS = 1.2; // whisper.cpp wants about a second of input; shorter takes are padded with silence
export const MIN_RMS = 0.006; // 0..1 full scale; below this the take is treated as silence (a quiet room is ~0.001, speech ~0.03+)

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out;
}

export function rmsOf(pcm) {
  if (!pcm.length) return 0;
  let s = 0; for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 0x8000; s += v * v; }
  return Math.sqrt(s / pcm.length);
}

/** @returns {{ok:true, pcm:Int16Array, seconds:number, rms:number} | {ok:false, reason:string}} */
export function prepareDictation(pcm, { maxSeconds = MAX_SECONDS } = {}) {
  const limit = clampSeconds(maxSeconds);
  const seconds = pcm.length / DICTATION_RATE;
  if (seconds < MIN_SECONDS) return { ok: false, reason: 'That was too short: hold the button while you speak.' };
  const rms = rmsOf(pcm);
  if (rms < MIN_RMS) return { ok: false, reason: 'I did not hear anything. Check the microphone and speak a little closer.' };
  let out = pcm.length > limit * DICTATION_RATE ? pcm.subarray(0, limit * DICTATION_RATE) : pcm;
  if (out.length < PAD_SECONDS * DICTATION_RATE) { const padded = new Int16Array(Math.ceil(PAD_SECONDS * DICTATION_RATE)); padded.set(out); out = padded; }
  return { ok: true, pcm: out, seconds: Math.min(seconds, limit), rms };
}

/** Joins whisper segments into one line. Thai is written without spaces between words, so segments are joined with a space only when both sides are Latin. */
export function joinSegments(segments) {
  let out = '';
  for (const s of segments || []) {
    const t = String(s.text || '').trim(); if (!t) continue;
    out += out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t) ? ` ${t}` : t;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** A short vocabulary hint for whisper (its `prompt`): it nudges recognition towards the words the commands use. Unproven benefit; harmless when ignored. */
export function dictationPrompt(effectLabels = []) {
  return `glitch ${effectLabels.join(' ')} เบส จังหวะ ความดัง เสียงสูง ตามเบส ผูกกับ`.trim();
}
