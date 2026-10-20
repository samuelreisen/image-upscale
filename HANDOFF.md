<!-- handoff-mark: 2 -->

**Current mark: Mk II**

# ImageUpscale – handoff

> **MAINTENANCE RULE.** EVERYTHING done to this project is saved in this file. Every session reads this file first, in full.
> After each change (code, config, docs, files, a fix, an experiment, a refactor, even a small one), add a dated entry at the top of the
> Change log (section 14), newest first, with exactly these four fields:
> - **Asked** – the owner's request, quoted or closely paraphrased.
> - **Changed** – what was changed, with root causes and file names.
> - **Verified** – how it was checked, with real numbers, tests run and counts. Never just "works".
> - **Not done** – honest limits, and what was skipped, such as untested parts or no commit/push.
>
> The same step must also correct any other section the change makes untrue. This document is kept correct, not just appended to.
> A prompt that changes nothing (a pure question) needs no entry. Never remove or edit the `handoff-mark` stamp on line 1 by hand:
> `scripts/make-mark.js` owns it.

## 1. What it is and who it is for
ImageUpscale is a double-clickable desktop app (Windows and macOS, Electron) that enlarges photos 2× or 4× with Real-ESRGAN neural upscaling, entirely on the user's own machine. Nothing is uploaded; the only network use is the optional one-time download of the larger "Quality" model from Hugging Face. It is for non-technical people Sam hands it to: drop an image, press Upscale, drag a before/after slider, save as PNG, JPEG or WebP. A batch queue handles many images.

**Owner:** Sam Reisen (GitHub `samuelreisen`, repo `samuelreisen/image-upscale`).

**What the owner cares about / their standards:** a real installer, not "run a local server"; Apple Human Interface Guidelines look and feel; honest reporting (no installer claimed unless the file is on disk and listed; say plainly what is not built); roman-numeral update marks (Mk I, Mk II…) with this file as the project's memory; no em dashes in prose written to Sam.

## 2. How to run it
```
npm install                       # on a normal machine. In the Linux sandbox use: npm install --ignore-scripts for onnxruntime-node (see §10)
npm run models                    # downloads models/fast.onnx (4.9 MB), SHA-256 verified. "node scripts/fetch-models.js all" also gets quality.onnx
npm start                         # opens the app window (smoke test only; this is not the deliverable)
npm test                          # node --test: tiling, blending, model hash check, end-to-end upscale (needs models/fast.onnx)
npm run bench                     # CPU seconds per input megapixel for both models
npm run dist:win                  # on Windows: NSIS installer + portable, x64 and arm64
npm run dist:win:portable         # works on Linux without Wine: portable .exe only, default Electron icon (see §10)
./build-mac.sh                    # on a Mac: .dmg + .zip, universal
npm run dist:dir                  # unpacked Linux build, used here to prove the packaged layout works
```

> **DANGER: test data.** Tests and experiments must run against a scratch data folder, never the real data.
> Real data lives at: Electron `userData` = `%APPDATA%\ImageUpscale` (Windows), `~/Library/Application Support/ImageUpscale` (macOS), `~/.config/ImageUpscale` (Linux). It holds `models/quality.onnx` (downloaded model), `updates/` (installed `.upscl` marks, the live `HANDOFF.md`, `handoff-history/`).
> Scratch switch: set `IMAGEUPSCALE_DATA_DIR=<empty temp folder>` before launching the app or running anything that installs updates or downloads models. `electron/main.js` redirects `userData` there at startup.
> Unit tests (`npm test`) write only to OS temp folders and never touch `userData`.

## 3. Repository map
```
package.json            productName ImageUpscale, appId com.samuelreisen.imageupscale, electron-builder config
electron/
  main.js               window, native menu (every toolbar action also in a menu), all IPC handlers, batch job, save dialogs, launch args, open-file
  preload.js            the only bridge: window.native.* (ipcRenderer is never exposed)
  upscaler.js           onnxruntime-node session (DirectML on Windows, CoreML on macOS, else CPU, with CPU fallback), tiled inference, progress, cancel, decode/encode via sharp
  tile.js               pure maths: planTiles, Blender (feathered overlap blend), boxDown2 (4x tile to 2x). No Electron/ONNX imports, unit tested
  models.js             model registry (pinned URL + SHA-256), resumable verified download. No Electron imports, shared with scripts/fetch-models.js
  updates.js            .upscl installer for the running app, wraps scripts/markpack.js + install-mark.js
renderer/
  index.html            strict CSP, no inline script/style
  renderer.js           UI logic (queue, compare slider, model sheet, updates dialog). File names are only ever set with textContent
  styles.css            HIG layout on top of the tokens
  assets/hig-tokens.css Apple HIG tokens (semantic light/dark colours, type, radii, increased-contrast rules)
build/                  icon.png / icon.icns / icon.ico (generated from branding/app-icon.svg), entitlements.mac.plist
branding/               logo exploration: 8 SVG variants, showcase.html, contact-sheet.png, logo.svg (flat mark), app-icon.svg (gradient tile). Chosen: Quad Zoom
models/                 fast.onnx and quality.onnx fetched here, git-ignored
server/                 LOCAL WEB MODE (owner asked for it): server.js (Node http on 127.0.0.1:4317, same UI, same upscaler/models), web-shim.js (provides window.native in a browser)
scripts/
  pack-server.js  fetch-models.js  make-icons.js  make-logo.js  make-fixture.js  bench.js  cross-deps.js  after-pack.js
  markpack.js  make-mark.js  install-mark.js  verify-mark-system.js  mark.config.json   (update-file system, extension .upscl)
marks/history.json      list of built marks (starts as [])
tests/                  tile.test.js (unit), upscale.test.js (real model end to end), fixtures/scene.png (320×240)
build-mac.sh            run on a Mac to produce the .dmg
INSTALL.md  README.md  CLAUDE.md  HANDOFF.md
```

## 4. Data model
No database. Per-run state lives in the main process: `items` Map (`id → { path, name, width, height, status ready|working|done|error, resultPath, scale }`), cached `Upscaler` per model, one `job` and one `download` at a time. Finished upscales are written as lossless PNG into an OS temp folder `ImageUpscale-XXXXXX` (so a batch never holds many 100 MB+ buffers) and deleted on quit. The renderer holds only previews (data URLs, ≤3200 px long edge). Preferences (scale, model, format) are in the renderer's `localStorage`, wrapped in try/catch.

## 5. Core logic
- **Tiling:** `planTiles(w,h,192,16)` splits the image into ≤192 px tiles overlapping 16 px; the last tile on each axis is shifted back so every tile is full size. Every pixel is covered at least once.
- **Blend:** `StripBlender` accumulates tiles × feather weight and divides by the weight sum. Weights ramp over `overlap×scale` pixels only on edges that touch a neighbour; image borders stay full weight. It holds one tile row only: once a tile row is done, every output row above the next row's start is final, so it is converted to bytes and streamed (`sink`) to a temp `.raw` file, which sharp then encodes to PNG from a read stream. `Blender` (whole image in RAM) is kept only as the reference the tests compare against; `StripBlender` output is byte-identical to it.
- **Scale:** the model is always ×4. For 2× each 4× tile is box-averaged to 2× (`boxDown2`) before blending, so memory is a quarter of blending at 4×.
- **Limits:** output capped at 256 million pixels (16384 × 16384), i.e. about 16 MP input at 4× and 64 MP at 2×. The cap is disk (temp raw file = 3 bytes per output pixel) and PNG/libvips practicality, not RAM. WebP saves are refused above 16383 px on a side (format limit) with a message to use PNG or JPEG.
- **Alpha:** RGB goes through the model; alpha is resized separately with Lanczos and rejoined.
- **Execution provider:** try DirectML (Windows) or CoreML (macOS) alone first, then CPU. The label shown is the provider whose session actually loaded. If a GPU run throws mid-job the session is reopened on CPU and the tile retried once.
- **Cancel:** an `AbortController` is checked between tiles, so cancel takes effect within one tile.
- **Models** (`electron/models.js`, both BSD-3-Clause Real-ESRGAN exports, pinned to a Hugging Face commit and SHA-256):
  - Fast = `CoderViking/realesr-general-x4v3-onnx` @ `c6a9717…`, 4,866,417 bytes, sha256 `1940a93e…f112`. Official v0.2.5.0 weights; export script lives in that repo.
  - Quality = `SceneWorks/real-esrgan-onnx` `real_esrgan_x4.onnx` @ `09f741b…`, 67,051,616 bytes (64 MiB), sha256 `5c586662…c033` (matches the hash on its model card).

Regression targets (numbers this logic was verified against, re-check after changing it):
- `npm test` = 10 tests, 10 pass.
- Fixture `tests/fixtures/scene.png` (320×240) with the Fast model on CPU: 4× → 1280×960, PSNR vs plain Lanczos 29.4 dB; 2× → 640×480, 28.8 dB; 4 tiles each. Seam test (gradient, 300×200 ×2): max error ≤ 1 level.
- Speed on a 4-thread 2.1 GHz Xeon, CPU only, 4×: Fast ≈ 14 to 16 s per input megapixel, Quality ≈ 167 to 177 s per input megapixel (about 12× slower). The 320×240 fixture takes about 1.1 to 1.9 s (Fast) and about 13 s (Quality).

## 6. Subsystem notes
- **Compare view:** two stacked `<img>`; the "after" is clipped with `clip-path: inset(0 0 0 var(--pos))`. Slider is `role="slider"`, arrows move 2 %, Shift+arrows 10 %, Home/End jump. "Actual Size" shows the preview at one image pixel per device pixel; previews are capped at 3200 px, the saved file is always full size.
- **Model download:** `downloadModel` writes `quality.onnx.part`, resumes with a Range request, follows redirects (Hugging Face redirects to a CDN), checks size then SHA-256, then renames. A hash mismatch deletes the part file and retries once. Uses `stream/promises.pipeline` so an aborted stream is closed before a resume starts (a hand-rolled version raced and produced a short file).
- **Updates (`.upscl`):** see §11 and `electron/updates.js`. Installed marks go to `userData/updates`. Only `renderer/` and `HANDOFF.md` are hot-swappable; `electron/` code needs a reinstall. The app loads `updates/renderer` only when its mark number is higher than the bundled `mark.json`.
- **Local web mode (`server/`):** `npm run serve` (or `node server/server.js`, `--open` opens the browser). `server.js` serves `renderer/` unchanged, rewrites `index.html` on the fly (CSP `connect-src 'none'` becomes `'self'`, injects `/__web/web-shim.js`, adds a favicon) and implements the same operations as `electron/main.js` over HTTP (`/api/*`, progress via Server-Sent Events). Uploaded images and results live in an OS temp folder deleted on exit; the Quality model goes to `~/.ImageUpscale/models` (or `IMAGEUPSCALE_DATA_DIR`). Save = browser download; Save All = several downloads. No native menu: the shim maps Ctrl/Cmd+O, S, Shift+S, Enter and Esc to the same commands. Update files and "Open HANDOFF.md" are desktop-only. Binds 127.0.0.1; any request with a non-local Host or a foreign Origin gets 403 (DNS-rebinding guard); static files are confined to `renderer/` and the shim. Logic duplicated from `main.js` (item handling, job loop): keep them in step, or extract a shared module.
- **Native menu:** `buildMenu()` is rebuilt whenever the renderer pushes state (`state:set`) so enabled/checked items follow the UI.

## 7. Traps and facts only real data revealed
- **sharp was a dev dependency in the skill template.** electron-builder drops dev dependencies, so the first Windows build contained no `sharp` and the packaged app would have crashed on launch while `npm start` worked. `sharp` is now in `dependencies` and unpacked from the asar.
- **onnxruntime-node 1.30 dropped macOS Intel.** Its `bin/napi-v6/darwin` has only `arm64`. Pinned to exactly 1.23.2, which has darwin x64+arm64 and win32 x64+arm64 (DirectML). Do not bump it without checking the tarball for `darwin/x64`, or the universal `.dmg` breaks on Intel Macs.
- **onnxruntime-node's postinstall downloads CUDA binaries from api.nuget.org** and fails with ECONNRESET in the sandbox. It only matters for Linux CUDA, which this app does not use, so it is installed with `--ignore-scripts`. Windows and macOS binaries are inside the npm tarball.
- **Without pruning, each installer carries ~290 MB of onnxruntime for the wrong OSes.** `scripts/after-pack.js` deletes every other platform/arch of onnxruntime-node and `@img/sharp*`.
- **npm installs sharp's native package only for the host OS.** `scripts/cross-deps.js` adds the others with `--os/--cpu --no-save` before `dist:*`.
- Download resume bug (see §6) and a test race (a stale "Saved" banner made a test read a file early) were the two real defects found by running the thing; both fixed.
- CSP blocks inline `style=""` attributes; set styles from JS (`el.style.x = …`) or classes.
- **npm audit:** `npm audit` flags `adm-zip`, `global-agent`, `roarr`, `sprintf-js` via `onnxruntime-node`, but only its install script (`script/`, unzips CUDA downloads at `npm install`) uses them. They were being bundled into the app anyway, so `build.files` now excludes them and `onnxruntime-node/script/**`; the packaged app was re-run to prove it does not need them. The other advisories are electron-builder build tooling and never ship. `npm audit fix --force` would downgrade electron-builder and force onnxruntime-node 1.30 (no macOS Intel): do not run it.
- Streaming bug to remember: `fs.writeSync` takes the typed array, not `.buffer`.
- `IMAGE_EXT` only lists extensions; real validation is `sharp(...).metadata()`, so a text file named `.png` is rejected with a readable message.

## 8. Persistence
`userData/models/quality.onnx` (downloaded, hash-verified), `userData/updates/` (installed marks, `HANDOFF.md`, `handoff-history/`, `mark.json`, `renderer/`), renderer `localStorage` prefs. Everything else is temp and deleted on quit.

**Must never be lost:** the installed `HANDOFF.md` in `userData/updates` (newer-wins sync keeps backups in `handoff-history/`), and `marks/history.json` in the repo (the mark counter).

## 9. UI notes and traps
- HIG: system font stack (SF Pro on Apple, Segoe UI elsewhere), 15 px body, content edge to edge, toolbar and status bar are floating translucent glass above it, 44 px minimum hit targets, one prominent action ("Upscale"), Cancel on the leading side and only shown while busy, concentric radii (toolbar 28, controls 22, segmented 19 inside 3 px padding), verb buttons, empty state "Drop an image to start", errors say how to fix. Honours light/dark, `prefers-contrast: more`, `prefers-reduced-motion`, `prefers-reduced-transparency`.
- macOS uses `titleBarStyle: 'hiddenInset'`; the sidebar header and toolbar are drag regions with the controls set to `no-drag`. **This has not been seen on a real Mac** (no Mac here).
- The window minimum is 900 px wide; below that the toolbar would not fit.
- Icon: `build/icon.*` comes from `branding/app-icon.svg` (Quad Zoom mark: one pixel becomes four, which is what a 2× upscale does). Regenerate with `node scripts/make-logo.js`, render `branding/app-icon.svg` to a 1024 PNG, then `node scripts/make-icons.js <png>`. The same SVG is `renderer/assets/app-icon.svg` (empty state). No AI showcase backgrounds were made (the logo skill's image step needs a Gemini API key that is not available here).
- Animated GIF/WebP: the queue row says "first frame only".

## 10. Platform and build notes
- Build host so far: Linux sandbox. Linux `dist:dir` works and the packaged binary was driven through the UI under Xvfb.
- **Windows from Linux:** the NSIS setup installer cannot be built here. electron-builder makes the NSIS uninstaller by running the freshly built installer under Wine (`NsisTarget.computeScriptAndSignUninstaller`), and there is no Wine on this box; `-c.win.signAndEditExecutable=false` does not avoid it (tried, same `spawn wine ENOENT`). The **portable** target needs no uninstaller, so `npm run dist:win:portable` does build: `ImageUpscale-Portable-<ver>-x64.exe`, `-arm64.exe`, and a combined `ImageUpscale-Portable-<ver>.exe` that carries both. With `signAndEditExecutable=false` those exes have the default Electron icon and no version metadata. electron-builder's own downloadable Wine (`-c.toolsets.wine=1.0.1`, beta, Wine 11 from electron-builder-binaries) was tried on 2026-10-20: it downloads and starts, then fails with `failed to load .../x86_64-unix/ntdll.dll error c0000135` because the published `wine-11.0-linux-x86_64.tar.xz` contains only `lib/wine/x86_64-unix` and no `x86_64-windows`/`i386-windows` PE directories. A dead end on Linux for now; recheck when a newer toolset is published. System Wine (apt `wine`, `wine64`, `wine32:i386`) is available from apt in this sandbox but was not installed (owner declined). Cleanest route: build on a Windows runner (GitHub Actions `windows-latest`) or a Windows PC. None of the Windows output has been run on Windows. Real installers: run `npm run dist:win` on a Windows machine (or Linux with Wine).
- **macOS:** `.dmg` cannot be built on Linux. Run `./build-mac.sh` on a Mac. Ad-hoc signed (`-c.mac.identity=-`), so Gatekeeper asks for right-click, Open once (INSTALL.md).
- **Server bundle for Windows:** `npm run pack:server:win` builds `release/ImageUpscale-Server-Windows-x64.zip`: staged `server/`, `renderer/`, `electron/{tile,upscaler,models}.js`, `models/fast.onnx`, `npm ci --omit=dev --os=win32 --cpu=x64` (so the right sharp/ONNX binaries), pruned of other platforms, plus a portable `node.exe` (Node v22.23.3, SHA-256 checked against nodejs.org's SHASUMS256) and `Start ImageUpscale.bat`. No Wine, no installer. The same script stages Linux/macOS trees (`node scripts/pack-server.js linux x64 --no-zip`), which is how the file set was proven complete (run in isolation, browser test passed). Windows-on-ARM uses the x64 bundle under emulation (not tested).
- DirectML (Windows) and CoreML (macOS) paths are written and fall back to CPU, but have **not been run on real hardware**; only CPU has been exercised.
- `npm run dist:*` run `predist:*` first (fetch the Fast model, add the other-platform sharp packages).

## 11. Working method
- Read this file first. Log every change (see the Maintenance rule).
- Ship changes with `node scripts/make-mark.js --title "..." --notes "..." --entry entry.md`. Call `node` directly for multi-line notes: on Windows, `npm run` cuts a multi-line argument at the first line break.
- Marks are named Mk I, Mk II, Mk III (roman numerals). The `handoff-mark` stamp and `marks/history.json` hold the plain number.
- Install a mark with `node scripts/install-mark.js <file>` (newer HANDOFF.md wins, the replaced one is kept in `handoff-history/`). `node scripts/verify-mark-system.js` re-checks the whole system.
- In the app: File → Install Update File… (or double-click a `.upscl`), File → Installed Updates… to switch between the 5 newest, Help → Open HANDOFF.md. Extension is `.upscl`; mark files are named `ImageUpscale-MkI.upscl`.
- Always run tests against a scratch data dir (`IMAGEUPSCALE_DATA_DIR`).

## 12. Open items and known quirks (prioritised)
0. Server mode (`server/`) and `ImageUpscale-Server-Windows-x64.zip` exist but the Windows bundle has never been run on Windows (only an identically structured Linux staging was).
1. **Not built:** the NSIS `Setup` installers (need Windows or Wine) and the macOS `.dmg`/`.zip` (need a Mac: `./build-mac.sh`). Built here: Windows portable x64/arm64 (unsigned, default icon, never run on Windows).
2. DirectML and CoreML are untested on real hardware.
3. Icon is a real mark now (Quad Zoom) but a first pass; a designer may want to refine it.
4. Installers are unsigned (SmartScreen / Gatekeeper warnings).
5. Quality model is slow on CPU (~12× Fast); no GPU path has been timed.
6. Upscalers invent plausible detail (the fixture's small text is visibly reshaped); not faithful restoration.
7. Output cap is now 256 MP (streamed). Beyond that images are refused with a message; WebP output is limited to 16383 px per side.
8. Animated GIFs use the first frame only (the queue row now says so); multi-frame upscaling is not implemented.
9. A mark can only update `renderer/` and `HANDOFF.md`; main-process changes need a new installer.
10. `npm audit` still lists 10 advisories (2 high, 8 moderate). Reviewed: the app-relevant ones are in code that no longer ships; the rest is build tooling (see §7). Re-check after any dependency bump.

## 13. Rough chronology (why the code looks the way it does)
1. Browser-page plan rejected; direction set to a native Electron app with real installers, HIG UI and a mark system.
2. Tiling and blend maths written first as pure code with tests, because seams are the classic tiled-upscaler bug.
3. Model sources chosen by actually downloading candidates and loading them in onnxruntime (dynamic H/W, license BSD-3, published hash).
4. Packaging found two bugs the dev run hid (sharp missing, 290 MB of foreign binaries), then the macOS Intel gap in onnxruntime 1.30.
5. Size cap removed by streaming rows to disk (StripBlender); logo chosen from 8 variants; dead vulnerable install-script dependencies dropped from the bundle.

## 14. Change log
Format: `### <date> – <title>` then the four fields **Asked**, **Changed**, **Verified**, **Not done**. Newest first. Mark entries read `### <date> – Mk <Roman> "<title>" – update file` and end with a **Mark file** line.

### 2026-10-20 – Local web server mode and a Windows zip that needs no installer
- **Asked** – "fuck it run it as a server" (after the NSIS installer could not be built without Wine).
- **Changed** – New `server/server.js` + `server/web-shim.js`, `scripts/pack-server.js`, npm scripts `serve`, `serve:quiet`, `pack:server:win`, `pack:server:win-arm64`. CLAUDE.md rule "no localhost anywhere" amended with this one explicit exception. README/INSTALL/HANDOFF updated. Built `release/ImageUpscale-Server-Windows-x64.zip` (70 MB). The desktop app and `renderer/` are unchanged, so no new mark.
- **Verified** – Server bound to 127.0.0.1; wrong Host header 403, cross-origin POST 403, `/../package.json` and `/%2e%2e/package.json` 404. Chromium driven against it: file chooser upload, a corrupt file rejected with a message, upscale 3.0 s, downloads in PNG/JPEG/WebP all 1280×960, Save All shortcut, Quality sheet, zero page errors (a favicon 404 was found and fixed). Linux staging of the bundle copied out of the repo and run alone: same browser test passes. Windows bundle: `zipfile.testzip` ok, 581 entries, Node v22.23.3 SHA-256 verified, win32 x64 `onnxruntime` (DirectML) and `sharp`/libvips DLLs present, `.bat` has CRLF.
- **Not done** – Never run on Windows. Windows-on-ARM, macOS and Linux bundles not built as deliverables. No authentication (relies on loopback + Host/Origin checks), so do not set `HOST=0.0.0.0`. NSIS setup installer and `.dmg` still not built.

### 2026-10-20 – Tried to build the Windows setup installer without system Wine
- **Asked** – "make the windows setup installer finish everything"; then "why do you need wine, use electron", then "for every other project running a native app ive never needed wine".
- **Changed** – Nothing in the code. Found that electron-builder has a `toolsets.wine` option that downloads its own Wine. Tried it (`electron-builder --win --x64 --arm64 -c.toolsets.wine=1.0.1`). Removed the incomplete `ImageUpscale-Setup-1.0.0-x64.exe` stub (205 KB, not an installer) and intermediate `.7z` files, rebuilt the portable `.exe` files, kept `release/ImageUpscale-Windows-1.0.0.zip`. HANDOFF §10 updated.
- **Verified** – Bundled Wine downloaded and launched, then failed with `c0000135` on `ntdll.dll`; `tar tJf` of the cached bundle shows no `x86_64-windows` or `i386-windows` directories, so the bundle itself is incomplete on Linux. `ls -lh release/` after cleanup: three portable exes plus the zip.
- **Not done** – The NSIS setup installer is still NOT built. Options left: install system Wine via apt (declined so far), a GitHub Actions Windows runner, or run `npm run dist:win` on a Windows PC.

### 2026-10-20 – Windows zip for handing out
- **Asked** – "please give me a zip with the windows install".
- **Changed** – Built `release/ImageUpscale-Windows-1.0.0.zip` (git-ignored, under `release/`) holding the x64 and arm64 portable `.exe` plus `INSTALL.md`, in a folder `ImageUpscale-Windows/`. No code changed.
- **Verified** – `zipfile.testzip()` ok; listing shows the three entries (115.5, 108.6 MB and INSTALL.md); zip is 225 MB.
- **Not done** – It is the portable build, not an NSIS setup installer (needs Windows or Wine). Not run on Windows. Default Electron icon on the `.exe`. Unsigned.

### 2026-10-20 – Mk II "Logo and first-frame note" – update file
- **Asked** – Ship the interface changes from the logo and size-cap work as the next update file.
- **Changed** – Mk II carries `renderer/`: the Quad Zoom app icon in the empty state (`assets/app-icon.svg`), and the "first frame only" note on animated images in the queue. It also carries this HANDOFF.md. The streaming upscaler, the 256 MP cap, the WebP size guard, the new icon files and the smaller bundle live in `electron/` and `build/`, which a mark cannot replace; they need the rebuilt installers.
- **Verified** – Dry run self-check, real build, then `node scripts/verify-mark-system.js`; the renderer was also loaded in the real packaged app (empty state with logo, upscale, no page errors). The test suite is 12/12.
- **Not done** – Mk II was not installed on a real Windows or Mac machine, and an old installer that gets Mk II installed on top still has the old 64 MP limit and old icon because those are not hot-swappable.
- **Mark file:** `marks/out/ImageUpscale-MkII.upscl` (7 files, minimum shell 1.0.0)

### 2026-10-20 – Logo, streaming (256 MP cap), GIF note, audit clean-up of the bundle
- **Asked** – "/logo-generator and do the rest yourself": make a real logo, then work through the open items list (signing, size cap, GIFs, npm audit, mark limits).
- **Changed** – `scripts/make-logo.js` + `branding/` (8 variants, showcase, Quad Zoom chosen); `build/icon.*` regenerated, `renderer/assets/app-icon.svg` used in the empty state; `StripBlender` in `electron/tile.js` and streamed PNG encoding in `electron/upscaler.js` (cap 64 → 256 MP, WebP/JPEG dimension guards in `exportImage`); `note: first frame only` for multi-page images in `electron/main.js` and the queue row; `build.files` excludes `adm-zip`, `global-agent`, `roarr`, `sprintf-js` and `onnxruntime-node/script/**`. README/INSTALL/HANDOFF corrected. `scripts/verify-mark-system.js` made generic: it assumed Mk I was the only real mark, so after Mk II shipped its scratch "temporary Mk II" became Mk III and 3 of 21 checks failed on hard-coded names (the system was fine, the script was wrong). Mk II cut (`renderer/` + HANDOFF.md).
- **Verified** – `npm test` 12/12 (new: StripBlender byte-identical to Blender on noisy data for 4 sizes, animated GIF takes frame 1). 4× / 2× fixture PSNR unchanged (29.4 / 28.8 dB). A 3000×2250 image (12000×9000 = 108 MP output, refused by the old build) upscaled in 81 s with RSS flat at about 407 MB and re-read by sharp as a valid 12000×9000 PNG. Packaged Linux build re-run through the UI after the dependency exclusion: OK, About shows Mk I. Icon checked at 256/64/32/16 px. `node scripts/verify-mark-system.js` 21/21 with Mk I and Mk II both real (first run was 18/21, see Changed).
- **Not done** – Code signing (needs a paid certificate the owner has to obtain; cannot be done here). Mark limits (a mark can only change `renderer/` and `HANDOFF.md`) are by design, not fixable without a real auto-updater. No multi-frame GIF upscaling. No AI showcase images (no Gemini key). Windows setup `.exe` and macOS `.dmg` still need Windows/Wine and a Mac. Nothing run on real Windows or Mac hardware.

### 2026-10-18 – Built Windows portable installers, checked the update installer inside the real app, wrote INSTALL.md and README.md
- **Asked** – Build `dist:win` and `dist:mac`, `ls -lh release/`, report paths and sizes; wire the `.upscl` updater and check it with a temporary Mk II; INSTALL.md and README with real speed numbers and limits.
- **Changed** – `npm run dist:win:portable` added (portable target only, `-c.win.signAndEditExecutable=false`, no Wine needed). `build-mac.sh`, `INSTALL.md`, `README.md`, `CLAUDE.md` written. HANDOFF §2, §10, §12 corrected to the real build status. This entry is a docs-only change after Mk I, so the stamp is still 1 and no new mark was cut.
- **Verified** – `npm run dist:win` (NSIS + portable) failed twice with `spawn wine ENOENT`, the second time with `-c.win.signAndEditExecutable=false`; cause read in `NsisTarget.computeScriptAndSignUninstaller` (uninstaller is generated by running the installer under Wine). `npm run dist:win:portable` exit 0, three `.exe` files built (x64, arm64, combined); unpacked trees checked with `file` (PE32+ x86-64 and Aarch64), `models/fast.onnx` present, `DirectML.dll` and `onnxruntime.dll` present for the right arch, matching `@img/sharp-win32-*`, `mark.json` = Mk I inside `app.asar`. `electron-builder --mac dir --arm64` packaged `ImageUpscale.app` (arm64-only onnxruntime/sharp, `.upscl` document type in `Info.plist`, bundle id correct). Packaged Linux build driven through the UI under Xvfb: upscale OK. Update system in the real app (dialogs stubbed): temporary Mk II built in a scratch copy installed, UI reloaded into the Mk II renderer, `HANDOFF.md` replaced with a `was-MkI` backup, installing older Mk I afterwards left the Mk II handoff alone, switch to Mk I worked, a garbage file and a tampered file were refused with readable messages and wrote nothing. `node scripts/verify-mark-system.js`: 21/21 pass. `npm test`: 10/10 pass.
- **Not done** – NSIS Windows setup installers; macOS `.dmg`/`.zip` (no Mac: run `./build-mac.sh`); running any build on Windows or macOS; DirectML/CoreML on hardware; real icon (placeholder); signing. The Windows `.exe` files have the default Electron icon because executable editing was skipped.

### 2026-10-18 – Mk I "First release" – update file
- **Asked** – Build Mk I, the first update file, with extension `.upscl`, after setting up HANDOFF.md and the mark tooling.
- **Changed** – First mark. Ships `renderer/` (index.html, renderer.js, styles.css, assets/hig-tokens.css) plus this HANDOFF.md and `mark.json`. Nothing outside `renderer/` can be hot-swapped by a mark, so `electron/` code in the installers is unchanged by it. `marks/history.json` now holds Mk I; `HANDOFF.md` reads "Current mark: Mk I".
- **Verified** – `--dry-run` first (self-check parsed the file back with the installer's own parser: file count, stamp and HANDOFF text matched), then the real build, then `node scripts/verify-mark-system.js` (output reported in the final message of the session).
- **Not done** – At the moment Mk I was built nothing had installed an update through the app's own "Install Update File…" dialog, and nothing has been installed on a real Windows or Mac machine.
- **Mark file:** `marks/out/ImageUpscale-MkI.upscl` (6 files, minimum shell 1.0.0)

### 2026-10-18 – Built the app and set up HANDOFF.md and the update-file system
- **Asked** – "On-device image upscaler, native desktop app": Electron + electron-builder, Real-ESRGAN via onnxruntime-node (Fast bundled, Quality downloaded on demand), HIG styled UI, batch queue, before/after slider, save PNG/JPEG/WebP, handoff system with extension `.upscl`, Roman-numeral marks, installers for Windows and Mac, honest reporting.
- **Changed** – Everything in §3. Notable decisions: onnxruntime-node pinned to 1.23.2; sharp moved to dependencies; afterPack pruning; resumable hash-verified model download; 2× via per-tile box downsample; per-item PNG temp results; `.upscl` updater wired through `electron/updates.js` (installs to `userData/updates`, loads a newer `renderer/` from there); `scripts/` mark tooling copied from the skill templates with `mark.config.json` (`ext .upscl`, ships `renderer` + `HANDOFF.md`); CLAUDE.md standing block; `IMAGEUPSCALE_DATA_DIR` scratch switch.
- **Verified** – `npm test` 10/10 pass (includes real-model 4× and 2× on the fixture, cancel, size limit). Real Electron app launched under Xvfb (dev tree and packaged `linux-unpacked`): UI upscale, Quality 2× via UI (19 s), save PNG/JPEG/WebP with correct dimensions, Save All with no overwrite, corrupt file rejected with a message, no page errors, `require`/`process` undefined in the renderer. Model download aborted at ~30 % and resumed to a matching SHA-256; a one-byte change is detected. grep: no localhost, no remote URLs, no inline script/style in the renderer. Windows portable x64 and arm64 built without Wine (`npm run dist:win:portable`); their unpacked trees checked for the right PE type, `models/fast.onnx`, DirectML and onnxruntime DLLs and the matching `sharp` package.
- **Not done** – NSIS Windows setup installers (no Wine here; `spawn wine ENOENT` twice, once with `-c.win.signAndEditExecutable=false`), the macOS `.dmg`/`.zip` (no Mac), running any Windows build on Windows, DirectML/CoreML on real hardware, a real icon, code signing, a real Mac layout check.
