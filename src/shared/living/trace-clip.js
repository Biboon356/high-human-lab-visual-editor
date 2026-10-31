// A recorded gesture as a clip: a generator of style 'trace' that draws the hand's path (engine/trace-renderer.js).
//   residue  the line the hand left, fading (or staying) as time passes
//   grow     roots that grow along the line, appearing exactly as fast as the hand moved
// The path is kept with its real timing in clip.gen.path.pts; everything else is the ordinary generator data (params, keyframes).
import { createClip, defaultProps } from '../project.js';
import { GEN_PARAMS } from '../organic-defs.js';
import { simplifyPath, gestureRange } from './gesture.js';

export const TRACE_MODES = ['residue', 'grow'];

/**
 * @param g gesture (see gesture.js), times in timeline seconds
 * @param o {mode, seed, tail (seconds the clip lasts after the last point), trackId}
 */
export function createTraceClip(g, { mode = 'residue', seed = 7, tail = 2.5, trackId = null } = {}) {
  if (!TRACE_MODES.includes(mode)) throw new Error(`Unknown trace mode "${mode}"`);
  const range = gestureRange(g);
  if (!range) throw new Error('There is no gesture to turn into a trace.');
  const pts = simplifyPath(g).map((p) => [Math.round((p[0] - range.t0) * 1000) / 1000, p[1], p[2], p[3]]);
  const params = Object.fromEntries(GEN_PARAMS.map((d) => [d.key, d.def]));
  Object.assign(params, mode === 'grow'
    ? { density: 1.3, distortion: 0.7, thickness: 0.22, glow: 0.7, green: 0.7, seed }
    : { density: 1, distortion: 0.35, thickness: 0.2, glow: 0.55, green: 0.35, movement: 0.4, seed });
  return createClip({
    type: 'generator',
    name: `Trace · ${mode}`,
    trackId,
    start: range.t0,
    duration: Math.max(1, range.t1 - range.t0 + tail),
    gen: { style: 'trace', transparent: true, params, keyframes: {}, bindings: {}, mode, fade: mode === 'residue' ? 3 : 0, path: { pts } },
    props: { ...defaultProps(), blend: 'screen' },
    effects: [],
  });
}
