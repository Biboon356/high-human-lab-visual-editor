// Speech recognition: model catalogue + download management + whisper.cpp (via @fugood/whisper.node). No Electron imports,
// so everything here can be unit-tested; main.js wires it to IPC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadFile } from './model-download.js';

/** ggml models published at huggingface.co/ggerganov/whisper.cpp. Quantised builds keep downloads small. */
export const MODELS = {
  fast: { file: 'ggml-small-q5_1.bin', label: 'Fast (Whisper small)', approxMB: 190, minBytes: 150e6, note: 'Quickest; fine for clear speech' },
  balanced: { file: 'ggml-medium-q5_0.bin', label: 'Balanced (Whisper medium)', approxMB: 540, minBytes: 450e6, note: 'Noticeably better Thai' },
  best: { file: 'ggml-large-v3-turbo-q5_0.bin', label: 'Best (Whisper large-v3-turbo)', approxMB: 574, minBytes: 480e6, note: 'Highest accuracy; needs a recent computer' },
};
export const DEFAULT_MODEL = 'balanced';

export const modelBase = () => process.env.HHLAB_MODEL_BASE || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export function modelStatus(dir) {
  return Object.fromEntries(Object.entries(MODELS).map(([id, m]) => {
    const file = path.join(dir, m.file);
    const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    return [id, { ...m, installed: bytes >= m.minBytes, bytes, partial: fs.existsSync(`${file}.part`) ? fs.statSync(`${file}.part`).size : 0 }];
  }));
}

export async function ensureModel(dir, id, { onProgress, signal } = {}) {
  const m = MODELS[id];
  if (!m) throw new Error(`Unknown speech model "${id}".`);
  return downloadFile({ url: `${modelBase()}/${m.file}`, dest: path.join(dir, m.file), minBytes: m.minBytes, onProgress, signal });
}

const BLANK = /^\s*(\[[A-Z_ ]+\]|\(.*\)|♪+|\*.*\*)\s*$/i;

let cache = null; // {modelPath, ctx}
async function loadEngine(loader) {
  try { return await (loader ? loader() : import('@fugood/whisper.node')); }
  catch (e) { throw new Error(`The speech engine could not be loaded on this computer (${e.code || e.message}).`); }
}

export async function releaseEngine() {
  if (cache) { try { await cache.ctx.release(); } catch { /* already gone */ } cache = null; }
}

/**
 * @param {{pcm:Int16Array, modelPath:string, language?:string, prompt?:string, onProgress?:(pct:number)=>void, signal?:{aborted:boolean, stop?:()=>void}, loader?:Function, threads?:number}} o
 * @returns {Promise<{segments:Array<{text:string,start:number,end:number}>}>} seconds
 */
export async function transcribePcm({ pcm, modelPath, language = 'th', prompt, onProgress, signal, loader, threads }) {
  if (!fs.existsSync(modelPath)) throw new Error('The speech model is not downloaded yet.');
  const eng = await loadEngine(loader);
  if (!cache || cache.modelPath !== modelPath) {
    await releaseEngine();
    try { cache = { modelPath, ctx: await eng.initWhisper({ model: modelPath, useGpu: true }) }; }
    catch (e) { throw new Error(`The speech model could not be opened (${e.message}). Delete it in the Auto-Edit panel and download it again.`); }
  }
  const { stop, promise } = cache.ctx.transcribeData(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), {
    language, temperature: 0, temperatureInc: 0.2, beamSize: 5, maxThreads: threads || Math.max(2, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1)),
    prompt, onProgress,
  });
  if (signal) signal.stop = stop;
  let res;
  try { res = await promise; }
  catch (e) { throw new Error(`Transcription failed: ${e.message}`); }
  if (res.isAborted || signal?.aborted) throw new Error('Transcription cancelled.');
  const segments = (res.segments || [])
    .map((s) => ({ text: String(s.text || '').trim(), start: s.t0 / 1000, end: s.t1 / 1000 })) // binding reports milliseconds
    .filter((s) => s.text && !BLANK.test(s.text) && s.end > s.start);
  return { segments, language: res.language || language };
}
