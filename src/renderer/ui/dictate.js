// Microphone capture for spoken commands: hold to record, release to stop. Everything stays on this computer.
// The sound is recorded at 16 kHz mono and handed to Whisper through the main process; nothing is stored and nothing is sent anywhere.
import { floatToInt16, DICTATION_RATE, MAX_SECONDS } from '/shared/command/dictation.js';

/** Starts capturing. Returns {stop(): Promise<Int16Array>, cancel()}; rejects (with a readable message) when there is no microphone or it is not allowed. */
export async function startCapture() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This computer did not offer a microphone to the app.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true }, video: false }); }
  catch (e) { throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access was not allowed.' : e?.name === 'NotFoundError' ? 'No microphone found.' : `The microphone could not be opened (${e?.name || e?.message}).`); }
  const ctx = new AudioContext({ sampleRate: DICTATION_RATE }); // the browser resamples the microphone for us
  const chunks = []; let n = 0, node = null, src = null;
  const close = async () => { try { if (node) node.port.onmessage = null; src?.disconnect(); node?.disconnect(); } catch { /* already gone */ } stream.getTracks().forEach((t) => t.stop()); try { await ctx.close(); } catch { /* closed */ } };
  try {
    await ctx.audioWorklet.addModule(new URL('./dictate-worklet.js', import.meta.url).href);
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'hhlab-dictate-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => { if (n < MAX_SECONDS * ctx.sampleRate) { chunks.push(e.data); n += e.data.length; } };
    src.connect(node);
  } catch (e) { await close(); throw new Error(`The microphone could not be started (${e?.message || e}).`); }
  return {
    rate: () => ctx.sampleRate,
    async stop() {
      await close();
      const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      return floatToInt16(all);
    },
    cancel: close,
  };
}
