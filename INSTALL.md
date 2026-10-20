# Installing ImageUpscale

ImageUpscale runs entirely on your computer. Your images are never uploaded. The only thing it can download is the optional Quality model (64 MB, one time), from Hugging Face.

The app is **not code-signed** (that needs a paid certificate), so Windows and macOS will warn you the first time. It is safe if you got it directly from the person who built it.

## Windows

You were given one of these files. If unsure, pick the **x64** one. Use **arm64** only on Windows-on-ARM machines (for example a Surface Pro X or Snapdragon laptop).

| File | What it is |
|---|---|
| `ImageUpscale-Portable-1.0.0-x64.exe` | Runs from wherever you put it. No install. |
| `ImageUpscale-Portable-1.0.0-arm64.exe` | Same, for Windows on ARM. |
| `ImageUpscale-Portable-1.0.0.exe` | One bigger file that works on either kind of PC. |

1. Double-click the file.
2. If you see **Windows protected your PC** (SmartScreen): click **More info**, then **Run anyway**.
3. The first start takes a few seconds while it unpacks itself.

A normal installer (`ImageUpscale-Setup-1.0.0-x64.exe`, with Start Menu and Desktop shortcuts) is built by running `npm run dist:win` **on a Windows PC**. It was not built for this release.

The portable files do not register the `.upscl` file type. To install an update file, open the app and choose **File, Install Update File…**.

## macOS

The `.dmg` has to be built on a Mac and has **not been built yet**. On a Mac with Node.js installed, open Terminal in this folder and run:

```
./build-mac.sh
```

That produces `release/ImageUpscale-1.0.0-universal.dmg` (Intel and Apple Silicon). Then:

1. Open the `.dmg` and drag **ImageUpscale** into **Applications**.
2. First launch: **right-click** (or Control-click) ImageUpscale, choose **Open**, then click **Open** again in the warning. You only do this once.
3. If macOS says the app is "damaged" or "can't be opened", open Terminal and run `xattr -cr /Applications/ImageUpscale.app`, then try again. (Or: System Settings, Privacy & Security, scroll down, **Open Anyway**.)

## First use

1. Drop an image on the window, or choose **File, Open Images…**.
2. Pick **2×** or **4×**, and **Fast** or **Quality**.
3. Click **Upscale**. **Cancel** stops it within a moment.
4. Drag the slider to compare before and after, then **Save…**.

**Fast** is built in and is the right choice for most photos. **Quality** is sharper on some images but about 12 times slower on a CPU. Choosing it offers a one-time 64 MB download, which can be paused and resumed.

Very large images are refused with a message. Crop or shrink them first (limit is about 16 megapixels at 4×, 64 megapixels at 2×). Big images work but take a while: the Fast model needs roughly 15 seconds per megapixel on an ordinary CPU.

## Update files (`.upscl`)

If you were sent an update file (for example `ImageUpscale-MkII.upscl`), choose **File, Install Update File…** and pick it. **File, Installed Updates…** lets you switch back to an earlier one. An update can change how the app looks and works on screen; it cannot replace the installed program itself.

## Uninstall

Windows portable: delete the `.exe`. Settings and the Quality model live in `%APPDATA%\ImageUpscale`; delete that folder to remove them. macOS: drag ImageUpscale to the Bin; data is in `~/Library/Application Support/ImageUpscale`.
