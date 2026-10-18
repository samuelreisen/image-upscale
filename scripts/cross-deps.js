'use strict';
// Usage: node scripts/cross-deps.js [win|mac|all]
// npm only installs the native sharp packages for the machine it runs on. To package for another OS
// (or for both x64 and arm64) the other packages have to be present too. --no-save keeps package.json clean.
const { execFileSync } = require('child_process');

const SETS = {
  win: [['win32', 'x64'], ['win32', 'arm64']],
  mac: [['darwin', 'x64'], ['darwin', 'arm64']],
};
SETS.all = [...SETS.win, ...SETS.mac];

const which = process.argv[2] || 'all';
if (!SETS[which]) { console.error('Use win, mac or all.'); process.exit(1); }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const [os, cpu] of SETS[which]) {
  console.log(`sharp native package for ${os}/${cpu}`);
  execFileSync(npm, ['install', '--no-save', '--force', '--ignore-scripts', `--os=${os}`, `--cpu=${cpu}`, 'sharp'], { stdio: 'inherit', shell: process.platform === 'win32' });
}
