// Which browser permissions the app grants. Pure, so the rule can be unit-tested (no device-dependent e2e can prove a refusal).
// Granted: listing installed fonts (Typography Lab) and the microphone, AUDIO ONLY, for spoken commands. Everything else, the camera included, is refused.
const audioOnly = (d) => { const t = d?.mediaTypes || (d?.mediaType ? [d.mediaType] : []); return t.length > 0 && t.every((x) => x === 'audio'); };
export const allowPermission = (permission, details) => permission === 'local-fonts' || (permission === 'media' && audioOnly(details));
