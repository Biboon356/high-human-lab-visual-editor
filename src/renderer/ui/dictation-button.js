// A hold-to-speak button for any text box: hold, say it, let go; local Whisper writes the words into the box for you to read and fix.
// Nothing is run from speech alone. Shared by "Tell it" (short commands) and "Describe the look" (longer descriptions).
import { store } from '../store.js';
import { startCapture } from './dictate.js';

/**
 * @param o {mic: HTMLButtonElement, input: HTMLInputElement|HTMLTextAreaElement, setStatus(text), getLang(): 'th'|'en', pauseChk?: HTMLInputElement,
 *           preview?: {play(), pause()}, dictate(opts): Promise<{ok, text?, reason?}>, maxSeconds?: number, prompt?: () => string|undefined,
 *           append?: boolean, doneText: string, idleLabel?: string}
 */
export function attachDictation(o) {
  const { mic, input, setStatus, getLang, pauseChk, preview, dictate, maxSeconds, prompt, append = false, doneText, idleLabel = '🎙 Hold to speak' } = o;
  let rec = null, starting = false, wasPlaying = false, held = false;
  const resume = () => { if (wasPlaying) preview?.play(); wasPlaying = false; };

  async function begin() {
    if (rec || starting) return;
    starting = true; setStatus('Starting the microphone…');
    try {
      const ok = await window.hh.micEnsure();
      if (!ok.ok) throw new Error(ok.reason || 'Microphone access was not allowed.');
      wasPlaying = !!store.playing && !!pauseChk?.checked;
      if (wasPlaying) preview?.pause();
      rec = await startCapture({ maxSeconds });
      mic.classList.add('rec'); mic.textContent = '● Listening… let go when done'; setStatus('Listening…');
      if (!held) end(); // the button was already released while the microphone was starting
    } catch (e) { setStatus(e.message); resume(); }
    finally { starting = false; }
  }

  async function end() {
    if (!rec) return;
    const r = rec; rec = null;
    mic.classList.remove('rec'); mic.textContent = idleLabel;
    setStatus('Recognising…');
    try {
      const pcm = await r.stop();
      resume();
      const res = await dictate({ pcm: pcm.buffer, language: getLang(), prompt: prompt?.(), maxSeconds });
      if (!res.ok) { setStatus(res.reason); return; }
      input.value = append && input.value.trim() ? `${input.value.trim()} ${res.text}` : res.text;
      input.dispatchEvent(new Event('input')); input.focus();
      setStatus(doneText);
    } catch (e) { setStatus(`Speech failed: ${e.message}`); resume(); }
  }

  const down = () => { held = true; begin(); }, up = () => { held = false; end(); };
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); try { mic.setPointerCapture(e.pointerId); } catch { /* not capturable */ } down(); });
  mic.addEventListener('pointerup', up); mic.addEventListener('pointercancel', up);
  mic.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) down(); } });
  mic.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); up(); } });
  mic.addEventListener('blur', () => { if (held) up(); });
}
