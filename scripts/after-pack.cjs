// Ad-hoc sign the macOS app. We have no Apple Developer ID, and an arm64 app whose
// bundle was modified after Electron's own signature (our resources, Info.plist, the
// unpacked native whisper/ffmpeg binaries) has an invalid signature: Gatekeeper then
// reports "is damaged and can't be opened" instead of the bypassable "unidentified
// developer" prompt. An ad-hoc signature over the whole bundle fixes that.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
