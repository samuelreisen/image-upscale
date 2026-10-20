# ImageUpscale

Electron desktop app: on-device Real-ESRGAN image upscaling. Read `HANDOFF.md` for architecture, build notes and traps.

- Never run tests or experiments against real data: set `IMAGEUPSCALE_DATA_DIR` to a scratch folder first.
- The desktop app has no localhost or dev server. Renderer talks to the main process only through `window.native` (preload).
- Exception, asked for explicitly by the owner on 2026-10-20: local web mode in `server/` (`npm run serve`). It is the only server in the project, binds 127.0.0.1 only, and must keep rejecting foreign Host/Origin headers. Do not add servers elsewhere.
- Do not bump `onnxruntime-node` past 1.23.2 without checking the tarball still ships `darwin/x64` (see HANDOFF §7).
- Installers: report only what `ls -lh release/` shows. The `.dmg` needs a Mac (`./build-mac.sh`).

<!-- handoff-and-updates:start -->
## Handoff and update files (read this first)

- Read `HANDOFF.md` in full at the start of every session, before doing anything else.
- Check its "Current mark" line so you know which mark the project is on. Marks are Mk I, Mk II, Mk III (roman numerals, never v1 or Mk1).
- After every task that changes anything (code, config, docs, files, even a small fix), update `HANDOFF.md`: add a dated entry at the top of the Change log with Asked / Changed / Verified / Not done, and correct any section the change made untrue. Only a pure question needs no entry.
- Never remove or rewrite the `<!-- handoff-mark: N -->` stamp by hand. `scripts/make-mark.js` owns it.
- Ship changes by making the next mark: `node scripts/make-mark.js --title "..." --notes "..." --entry entry.md`.

Detail lives in [HANDOFF.md](HANDOFF.md).
<!-- handoff-and-updates:end -->
