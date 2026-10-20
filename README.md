# ImageUpscale

A desktop app that enlarges photos **2× or 4×** with Real-ESRGAN, entirely on your own machine. Nothing is uploaded. Built with Electron; the neural network runs in the main process through `onnxruntime-node` (CPU everywhere, DirectML on Windows, CoreML on macOS where available).

- Drop or open images, choose 2× or 4×, **Fast** or **Quality** model
- Batch queue, per-image progress, cancel within one tile
- Before/after slider (mouse or keyboard), Actual Size view
- Save as PNG, JPEG or WebP through the native dialog, or Save All to a folder
- Shows which execution provider is really in use (CPU, DirectML or CoreML)
- Apple HIG styling: light, dark, increased contrast, reduced motion
- `.upscl` update files with numbered marks (Mk I, Mk II…), see `HANDOFF.md`

Installing: see [INSTALL.md](INSTALL.md). Architecture, traps and change history: [HANDOFF.md](HANDOFF.md).

## Models

| | Fast (default, bundled) | Quality (optional download) |
|---|---|---|
| Network | Real-ESRGAN general x4v3 (compact) | Real-ESRGAN x4plus (RRDBNet) |
| Size | 4.9 MB, ships inside the app | 64 MiB, downloaded once to the app's data folder |
| Source | `CoderViking/realesr-general-x4v3-onnx` | `SceneWorks/real-esrgan-onnx` (`real_esrgan_x4.onnx`) |
| Licence | BSD-3-Clause (xinntao/Real-ESRGAN) | BSD-3-Clause (xinntao/Real-ESRGAN) |
| SHA-256 | `1940a93e…f112` | `5c586662…c033` |

Both URLs are pinned to a Hugging Face commit and checked against the SHA-256 above (the download is resumable and refuses a file that does not match). Weights are the official Real-ESRGAN releases converted to ONNX by the third parties named above; the conversions were tested here against a plain Lanczos upscale, not against the original PyTorch models.

## Speed (measured)

CPU only, 4 threads of an Intel Xeon @ 2.1 GHz, 4× upscale, `npm run bench` (the model needs the same time for 2×):

| Model | Time per megapixel of input | 320×240 test image | 3 MP photo (about 2000×1500) |
|---|---|---|---|
| Fast | about 14 to 16 s | 1.1 to 1.9 s | roughly 45 s |
| Quality | about 167 to 177 s | about 13 s | roughly 9 minutes |

Quality is about 12 times slower than Fast on a CPU. The 3 MP column is extrapolated from the per-megapixel figure, not separately timed. DirectML (Windows GPUs) and CoreML (macOS) are implemented with automatic fallback to CPU but **have not been run on real hardware**, so there are no GPU numbers.

## Limits, honestly

- **Upscalers invent detail.** The result is plausible, not a faithful restoration. Small text, faces and fine patterns can be reshaped (the test image's tiny text visibly changes). Do not use it where accuracy matters.
- **Quality is big and slow on CPU.** Fast is the default for that reason.
- **Size cap:** output is limited to 256 megapixels (about 16 MP input at 4×, 64 MP at 2×). Rows are streamed to disk, so memory stays flat (a 108 MP output used about 400 MB of RAM and took 81 s on the Fast model). WebP saves are limited to 16383 px per side.
- **Installers are unsigned.** Expect SmartScreen on Windows and Gatekeeper on macOS (see INSTALL.md).
- **Animated GIFs** are upscaled from their first frame only (the queue says so).
- **Update files** can replace the interface (`renderer/`) and `HANDOFF.md`, not the main-process code.
- **Build status:** only the Windows portable `.exe` files (x64, arm64, combined) have been built, on Linux, with the default Electron icon, and have not been run on Windows. The Windows setup installer and the macOS `.dmg` are not built (they need Windows/Wine and a Mac). The icon is a first-pass mark, not a designer's final.

## Develop

```
npm install               # in the Linux sandbox onnxruntime-node needs: npm install --ignore-scripts (HANDOFF §7)
npm run models            # fetch + verify the Fast model into ./models
npm test                  # 10 tests: tiling, seam-free blending, model hash check, real 4x/2x upscale, cancel, size limit
npm start                 # open the window (smoke test)
npm run bench             # CPU timing
npm run dist:win          # on Windows: NSIS setup + portable, x64 and arm64
npm run dist:win:portable # works from Linux without Wine: portable only
./build-mac.sh            # on a Mac: .dmg and .zip (universal, ad-hoc signed)
```

Tests and experiments must use a scratch data folder: `IMAGEUPSCALE_DATA_DIR=/some/empty/dir`.

## Privacy

The app makes no network requests except the optional Quality model download (huggingface.co). The renderer has a strict Content Security Policy (`default-src 'none'`, `connect-src 'none'`), context isolation on, Node integration off, and talks to the main process only through a small preload API.
