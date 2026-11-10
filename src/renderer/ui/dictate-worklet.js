// Runs on the audio thread: hands each block of microphone samples to the page. (Loaded by dictate.js through audioWorklet.addModule.)
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0]?.[0]; if (ch && ch.length) this.port.postMessage(new Float32Array(ch)); return true; }
}
registerProcessor('hhlab-dictate-tap', Tap);
