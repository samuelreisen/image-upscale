ImageUpscale for Windows
========================

ImageUpscale makes photos 2x or 4x bigger with Real-ESRGAN, a neural network that adds detail.
It runs entirely on this computer. Your pictures are never uploaded anywhere.

Version 1.0.0


WHAT YOU NEED
-------------
- Windows 10 or Windows 11, 64-bit (most PCs).
- About 300 MB of free disk space. The optional Quality model adds 64 MB.
- A web browser: Edge, Chrome or Firefox.
- Nothing else. No installer, no admin rights, no Node.js. Everything needed is in this folder.


HOW TO START (first time)
-------------------------
1. Extract the ZIP. Right-click the downloaded ZIP file, choose "Extract All...", pick a place
   such as Documents, then click Extract.
   Do NOT run the app from inside the zip viewer. It will not work there.

2. Open the extracted folder "ImageUpscale-Server-Windows-x64".

3. Double-click "Start ImageUpscale.bat".

4. A black window opens and your browser opens the app. If the browser does not open by itself,
   copy this address into it:

       http://127.0.0.1:4317/

5. Keep the black window open while you use the app. Closing it stops the app.

If Windows says "Windows protected your PC": click "More info", then "Run anyway".
This only appears the first time, because the file is not code-signed.


HOW TO USE IT
-------------
1. Drop an image onto the page, or click "Open Images..." (shortcut: Ctrl+O).
   PNG, JPEG, WebP, BMP, TIFF, GIF and AVIF all work. You can add several at once.
2. Choose 2x or 4x at the top.
3. Choose a model:
   - Fast (the default): right for most photos. Built in, nothing to download.
   - Quality: sharper on some photos, but much slower. The first time you choose it, click
     Download (64 MB, once). Downloads can be paused and resumed.
4. Click Upscale (shortcut: Ctrl+Enter). Cancel stops it. Esc also cancels.
5. Drag the slider across the picture to compare before and after.
6. Choose the file format at the bottom: PNG keeps everything, JPEG and WebP are smaller.
7. Click Save (shortcut: Ctrl+S). Your browser downloads the picture, normally into your
   Downloads folder. Save All (shortcut: Ctrl+Shift+S) downloads every finished picture.


HOW LONG IT TAKES
-----------------
Fast takes roughly 15 seconds per megapixel of the picture you put in. A 2-megapixel photo takes
about 30 seconds. Quality takes about 12 times longer.
These numbers were measured on a 4-core test machine. Your PC may be faster or slower.


LIMITS
------
- Pictures up to about 16 megapixels can be made 4x bigger (about 64 megapixels at 2x).
  Bigger pictures are refused with a message. Crop or shrink them first.
- The upscaler invents detail. Small text, faces and fine patterns can change shape.
  Do not rely on it where the exact detail matters.
- Animated GIFs: only the first frame is upscaled.
- WebP files can be at most 16,383 pixels on a side. Use PNG for very large results.


STOPPING IT
-----------
Close the black window, or click it and press Ctrl+C. Then close the browser tab.


PRIVACY
-------
- The app only listens on this PC (address 127.0.0.1). Other computers, including ones on
  your own network, cannot connect to it.
- While you work, pictures are copied into a temporary folder. That folder is emptied when
  the app stops.
- The only internet use is the optional Quality model download, from huggingface.co.
  The Fast model needs no internet at all.
- There is no password. Do not change the HOST setting to 0.0.0.0, because that would
  make the app reachable from your network.


TROUBLESHOOTING
---------------
The black window closes straight away
    Usually the ZIP was never extracted, or the download was damaged. Extract the ZIP again
    to a normal folder and start the .bat from there. To read the error, open a Command
    Prompt in this folder and run:  "Start ImageUpscale.bat"

"Port 4317 is already in use" or the page does not load
    Another copy of ImageUpscale is probably still running. Close its black window, or use
    another port. Open a Command Prompt in this folder, then run these two lines:

        set PORT=4400
        "Start ImageUpscale.bat"

    Then open  http://127.0.0.1:4400/  in your browser.

The firewall asks about "Node.js" or "node.exe"
    Either Allow or Cancel is fine. The app only listens on this PC, so it does not need
    any firewall access.

"The Quality model is not downloaded yet"
    Choose Quality, then click Download. If it stops part way, click Download again.
    It resumes where it left off.

"This picture is too large"
    Crop it, or shrink it, and try again.

"not a supported image" or "could not be read"
    Save the picture as PNG or JPEG and try again.

Antivirus blocks or quarantines node.exe or a .dll file
    Add this folder to your antivirus exceptions. The files are the standard Node.js and
    ONNX Runtime files that the app needs.

It is very slow
    That is normal for Quality, and for large pictures on an older PC. Use Fast, or make
    the picture smaller.


UNINSTALL
---------
Close the app, then delete this folder.
Your settings and the Quality model are stored in  C:\Users\<your name>\.ImageUpscale
Delete that folder too if you want to remove everything.


WHAT IS IN THIS FOLDER
----------------------
Start ImageUpscale.bat   starts the app
node\node.exe            Node.js 22, the runtime the app runs on (checksum verified when packed)
app\                     the app: server, web page, upscaler, Fast model, and the Windows
                         native libraries (ONNX Runtime with DirectML, sharp with libvips)
README.txt               this file
