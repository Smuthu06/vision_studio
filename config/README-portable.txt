Vision Studio - camera configuration editor
============================================

Files
  VisionStudio.exe   the program
  VisionStudio.ini   settings - keep it in the same folder as the program
  README.txt         this file

Choosing desktop or web mode
  Open VisionStudio.ini in Notepad, change the line under [app] and restart:

    mode = desktop   Vision Studio opens in its own window.
    mode = web       Vision Studio starts a small web server and opens the
                     editor in your browser. Its tray icon (bottom-right of the
                     taskbar) has "Open Vision Studio in browser" and "Quit".

  Web mode settings are under [web]: host, port and open_browser.
  host = 0.0.0.0 lets other PCs on the network open http://<this-pc>:<port>/
  (allow the port in Windows Defender Firewall).

  You can also override the file for one run:
    VisionStudio.exe --mode web --port 9000
    VisionStudio.exe --mode web --no-browser
    VisionStudio.exe --config D:\bench\vision-studio.ini

Requirements
  Windows 10 or 11 (64-bit). Desktop mode uses Microsoft Edge WebView2, which is
  preinstalled on Windows 10/11. If the window stays blank, install the
  "Evergreen WebView2 Runtime" from Microsoft.

If a setting is wrong, Vision Studio shows which line it ignored and starts
with the default value for it.
