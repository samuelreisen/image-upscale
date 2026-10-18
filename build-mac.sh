#!/usr/bin/env bash
# Build the macOS .dmg and .zip. Must be run ON A MAC (a .dmg cannot be built on Windows or Linux).
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This has to run on macOS. Copy this folder to a Mac and run ./build-mac.sh there." >&2
  exit 1
fi
command -v node >/dev/null || { echo "Install Node.js first: https://nodejs.org" >&2; exit 1; }

npm install
[ -f build/icon.icns ] || npm run icons
# predist:mac fetches the Fast model (SHA-256 verified) and adds the Intel + Apple Silicon sharp packages
npm run dist:mac

echo
echo "Built:"
ls -lh release/*.dmg release/*.zip
echo
echo "The app is unsigned. On first launch: right-click the app, choose Open, then Open again."
