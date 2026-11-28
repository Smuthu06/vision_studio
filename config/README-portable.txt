Vision Studio - camera configuration editor
============================================

Files
  VisionStudio.exe   the program
  VisionStudio.ini   settings - keep it in the same folder as the program
  ui_config.json     dropdown lists (imagers, hardware, formats ...) - edit them
                     in Vision Studio with File > Settings
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

Where configurations are saved
  File > Save does not ask for a name. It writes <Project Name>_v<version>.json
  (e.g. sample_v1.0.0.json for project "sample", version V.1.0.0) into the
  folder set by project_dir under [app] in VisionStudio.ini. The default is
  ../../configurations/project_configuration, relative to the INI's folder; it
  is created on the first save.
  Saving again replaces the open file. A new version or project name gives a new
  file. Vision Studio asks before replacing any other file of the same name.
  File > Open lists the configurations in that folder; "Browse..." opens a
  file from anywhere else.
  In web mode only the PC running Vision Studio saves into the folder; other
  PCs download the file instead.

Tester configurations
  File > New > Tester asks for a project configuration (from project_dir)
  and builds a tester for it: right-click the tester to add modes, a mode to
  add camera models. Save writes <Tester Name>_v<version>.json into
  tester_dir (default ../../configurations/tester_configuration).
  The Bit File dropdown lists *.lvbitx in bitfile_dir (../../fpga_bitfile)
  and Datalogger Configuration lists *.json in datalogger_dir
  (../../datalogger_configuration). FPGA devices and FPGA board defaults are
  lists in File > Settings.

Requirements
  Windows 10 or 11 (64-bit). Desktop mode uses Microsoft Edge WebView2, which is
  preinstalled on Windows 10/11. If the window stays blank, install the
  "Evergreen WebView2 Runtime" from Microsoft.

Dropdown lists (ui_config.json)
  File > Settings edits the lists offered in the editor's dropdowns: mode
  features, imagers, camera serializers, hardware (manufacturer > model >
  serializer/deserializer), image formats and data types. They are saved to
  ui_config.json (the [app] ui_config line in VisionStudio.ini can point to a
  shared network file instead).
  In web mode only the PC running Vision Studio can save the lists; other PCs
  see them read-only. If the file is changed by someone else while you edit,
  Vision Studio asks before replacing their changes.

If a setting is wrong, Vision Studio shows which line it ignored and starts
with the default value for it.
