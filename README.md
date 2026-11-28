# Vision Studio – Camera Configuration Editor

A step-by-step builder for automotive camera test-bench project configurations, available
as a **web app** and a **native desktop app** from one codebase.

A new window contains only the **project information**. You build the rest of the
configuration by right-clicking nodes in the tree. Adding, duplicating and deleting nodes
happen only in that right-click menu; keyboard users open the same menu with
**Shift+F10**, the Menu key or **Insert**. The menu offers only the children allowed at that
point. On a leaf node it also offers its parent's additions, for example *Add Virtual
Channel* on `VC0`. Every edit
is validated live. **Save** writes JSON that follows the camera project schema.

## Why this stack

| Choice | Reason |
| --- | --- |
| **TypeScript + React** | One UI that runs in any browser and inside the desktop shell. The type system catches schema mistakes. |
| **Tauri 2** (Rust) for desktop | Uses the OS webview, so installers are about 5–10 MB instead of Electron's ~150 MB. Gives native open/save dialogs and real file writes, and has a strict permission model. Builds for Windows, macOS and Linux. |
| **Vite** | Fast dev server, and builds a static site or one self-contained `index.html`. |
| **immer** | Immutable document updates, which makes undo/redo cheap and reliable. |

The domain logic in `src/core` is plain TypeScript with no UI imports. It covers the schema,
node tree, validation, JSON round-trip and build guide, and is unit-tested on its own.

## Run it

```bash
npm install
npm run dev            # web app at http://localhost:1420
npm test               # core unit tests (vitest)
npm run build          # static web app in dist/  (host on any static server / intranet)
npm run build:single   # one self-contained dist-single/index.html (open from disk or share)
```

### Desktop

You need the Rust toolchain and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/). On Windows that is WebView2,
which is preinstalled on Windows 10 and 11.

```bash
npm run desktop:dev    # native window with hot reload
npm run desktop:build  # installers in src-tauri/target/release/bundle/
```

Pushing a tag such as `v1.0.0` runs `.github/workflows/release.yml`. That workflow builds
Windows (`.msi`/`.exe`), macOS (`.dmg`, universal) and Linux (`.deb`/`.AppImage`)
installers into a draft GitHub release, and also builds the web app.

### Windows: build the exe with `build-windows.bat`

On a Windows PC with Node.js 18+, Rust (`rustup`, MSVC toolchain) and Visual Studio
Build Tools ("Desktop development with C++"), double-click `build-windows.bat` or run:

```bat
build-windows.bat              :: VisionStudio.exe + VisionStudio.ini (portable folder)
build-windows.bat installer    :: also the NSIS setup.exe and MSI installers
build-windows.bat skiptests    :: skip the unit tests
build-windows.bat clean        :: full rebuild
```

The script checks the prerequisites, installs packages, runs the tests and builds. It
writes:

```
release\VisionStudio\VisionStudio.exe
release\VisionStudio\VisionStudio.ini      <- settings, edit with Notepad
release\VisionStudio\README.txt
release\VisionStudio-portable.zip
release\installers\...                     (with "installer")
```

Rebuilding keeps an existing `VisionStudio.ini` and `ui_config.json`, so your settings survive. The
`windows-portable` GitHub workflow runs this same script on a Windows runner, smoke-tests
web mode, and offers the portable folder as a download.

### One exe, two modes: `VisionStudio.ini`

The exe reads `VisionStudio.ini` from its own folder (template: `config/vision-studio.ini`):

```ini
[app]
mode = desktop        ; desktop = own window, web = serve the editor to a browser
ui_config = ui_config.json   ; dropdown lists (File › Settings), may be a network path

[desktop]
width = 1440
height = 900
maximized = false

[web]
host = 127.0.0.1      ; 0.0.0.0 lets other PCs on the network connect
port = 8080
open_browser = true
```

* **desktop**: the editor opens in a native window with native Open/Save dialogs.
* **web**: the exe serves the UI embedded in it over HTTP (no extra files) and opens the
  browser. A tray icon offers *Open Vision Studio in browser* and *Quit*. With
  `host = 0.0.0.0`, colleagues can open `http://<your-pc>:8080/`; allow the port in
  Windows Defender Firewall.
* **Command-line overrides:** `--mode web|desktop`, `--port N`, `--host H`,
  `--no-browser`, `--config <path>`.
* **Lookup order:** `--config`, then `<exe name>.ini` next to the exe, then
  `vision-studio.ini` next to the exe, then the user config folder, then the installed
  copy. Without any INI the defaults above apply.
* **Invalid values** are reported in a dialog that names the ignored lines, and the
  default is used for each one. If the web port is busy, the error says which setting to
  change.
* The installer (`installer` option) installs per user and puts `vision-studio.ini` next
  to the program, so it can be edited without admin rights.

### Web vs. desktop file handling

| | Desktop (Tauri) | Web: Chrome / Edge | Web: Firefox / Safari |
| --- | --- | --- | --- |
| Open | Native dialog | File picker | File picker |
| Save | Writes the file in place | Writes the file in place (File System Access API) | Downloads the `.json` |
| Close with unsaved changes | Confirmation dialog | Browser "leave page" prompt | Browser prompt |

In both versions you can drag a `.json` file onto the window to open it. Unsaved work is
autosaved as a recovery draft, and you're offered a restore the next time you open the app.

## Using it

1. **Project information.** Fill in name, version (`V.x.y.z`), author, email and date. Fields
   show inline errors as you type.
2. Right-click the project and choose **Add Project Modes**. Then right-click *Project Modes*
   and add `CaptureMode` and/or `PassthroughMode`, and toggle their features.
3. Right-click the project and choose **Add Camera Models**. Then **Add Camera Model** and
   fill in its parameters.
4. On the camera, add **Hardware** (Capture / Passthrough boards; *Auto 1:1* adds GPIO
   routing), **Frame Information** (virtual channels, frame outputs, embedded lines), and
   optionally **Fault Injection** and **I2C Monitoring**.
5. Press **F5** to validate and **Ctrl+S** to save. New, Open, Open sample project and
   Save As are in the **File** menu.

The **Build guide** in the sidebar tracks these steps with a progress bar. Clicking a step
selects the node that needs work and opens its right-click menu, or jumps to the node
that needs fixing. The guide folds away once everything is done. Empty nodes show a
one-line hint listing what their right-click menu can add.

**Validation stays quiet until it's useful.** A new project doesn't open in red:
* A field shows an error once you've edited it or moved past it.
* Every remaining issue appears when you press **F5** (Validate) or **Save**, and whenever
  you open an existing file.
* The status bar always shows the true totals.
* Field and cell problems are marked next to the input. The banner at the top of an editor
  is reserved for findings that belong to no single input, such as a missing hardware board
  for an enabled mode.

**EMCfeature.** A built-in mode feature. Its five EMC parameters are editable and
validated only while **any** project mode enables EMCfeature:
* Imager I2C Address
* EEPROM Length
* EEPROM Address(es)
* Hash Register Address
* Hash Length (bytes)

They sit in a separate *EMC parameters* section of the Camera Model editor.

When the feature is off:
* The section is greyed out and explains how to enable it (*Enable it in Project
  Modes*).
* The values are kept in the JSON, because the schema requires those keys, but they aren't
  checked.

In Settings › Mode features, EMCfeature is locked (it can't be renamed or removed), and it's
added automatically to older `ui_config.json` files. Gating works per field through
`FieldSpec.requiresFeature`, so further feature-dependent inputs only need that one
property.

**Settings (File › Settings…, Ctrl+,).** Manages the lists behind the editor's dropdowns:

| Section | Feeds |
| --- | --- |
| Mode features | Project Modes › Features |
| Imagers | Camera Model › Imager |
| Camera serializers | Camera Model › Serializer IC |
| Hardware: Manufacturer → Model → Serializer / Deserializer ICs | Capture / Passthrough Hardware (cascading: the manufacturer narrows the models, the model narrows the ICs) |
| Image formats | Camera Model › Packet Format, Frame Outputs › Format |
| Data types | Frame Outputs › Data ID (shown as `0x2A – RAW8`) |

* Changes apply to the dropdowns and to validation as soon as you press **Apply**. Every
  dropdown ends with *Edit list in Settings…*, which opens the matching section.
* If you rename a value the open configuration uses, Vision Studio offers to update those
  uses in one undoable step. Each row shows how often its value is used.
* A value outside the list is an **error** for features and image formats, which were
  always fixed lists. For the other lists it's a **warning**, so older files still open.
* **Where the lists live:** `ui_config.json`, next to the exe. The INI line
  `[app] ui_config = ui_config.json` sets the path; it's resolved against the INI's folder
  and can be a shared network file. The template is `config/ui_config.json`, and a unit
  test keeps it equal to the built-in defaults. A missing file is created from the current
  lists on the first start.
  * **Desktop mode** reads and writes the file through the native app.
  * **Web mode** serves it as `GET /api/ui-config`. `PUT` is accepted only from the PC
    running the exe (loopback address and a loopback `Host` header). Other PCs see the
    lists read-only.
  * **Without the exe** (dev server, static hosting) the lists are kept in the browser.
* **Safe saving:**
  * Saves are atomic.
  * Invalid JSON is reported with its line and column, and the file isn't overwritten
    unless you Apply.
  * If someone else saved the file while you were editing, you choose between
    *Replace with mine* and *Load their version*.
* **Export** and **Import** copy lists between installations, and **Reset to defaults**
  restores the shipped lists. The core logic is in `src/core/catalog.ts` and
  `src-tauri/src/ui_config.rs`.

**Details pane (right side, F1).** It documents the selected node and every one of its inputs:
* For each node: what it represents, where it sits in the saved JSON (for example
  `project.cameraModels[0].hw[1].passthroughMode`), which child nodes it can contain, and its
  validation status.
* For each field and table column: a full description, its type, whether it's required, its
  range or allowed values, format, default, unit, an example and practical tips. It also
  shows the input's current value, any validation messages and its exact JSON key.
* Click into any field or table cell and the pane shows that input's documentation at the
  top. The full list of inputs is one click away under *All inputs on this node*. There, a
  filter box searches all inputs, and double-clicking an entry (or *Go to input*) jumps to
  it. Drag the pane's left edge to resize it.
* While the pane is open, the form drops its grey helper lines so the descriptions aren't
  shown twice.

The texts live in `src/core/docs.ts`. Type, range and allowed values are generated from the
same specs the validator uses, so they always match. A unit test fails if any field or
column is left undocumented.

Other features:
* Undo/redo; consecutive keystrokes in one field merge into a single undo step.
* Duplicate camera models and virtual channels.
* Wide tables (fault injection, I2C monitoring) show their key columns in the grid. The
  remaining settings of the selected row appear in a drawer beside the grid, or below it
  when the editor is narrow.
* A Problems panel; clicking a problem jumps to the exact field or table cell.
* A JSON preview of the selected node or the whole file.
* Dark and light themes.
* Keyboard-only use: arrow keys move through the tree, Shift+F10 opens the context menu,
  Insert opens the add menu.

## Project layout

```
src/core/        schema.ts (field specs, parsing, value checks)
                 model.ts  (node types, allowed children, JSON round-trip, validation)
                 guide.ts  (step-by-step build checklist)
                 docs.ts   (input documentation for the Details pane)
                 catalog.ts (Settings lists: defaults, cascades, validation, renames)
src/state/       store.ts  (document state, undo/redo)
src/ui/          Tree, Editor (+ section registry), Settings, DetailsPane, fields/DataTable, Panels, overlays, icons
src/platform.ts  web ⇄ desktop file I/O abstraction
src-tauri/       native shell (Rust): INI config (config.rs), web-mode server (web.rs),
                 mode switch + tray (lib.rs), dialog/fs plugins, permissions, icons
config/          vision-studio.ini template + README for the portable folder
build-windows.bat  Windows build: exe + ini (+ installers)
e2e/flow.py      Playwright test: builds a full config from an empty project and saves it
e2e/settings.py  Playwright test: Settings lists drive the dropdowns, renames, cascade, persistence
```

**Adding a node type.** Add an entry to `DEFS` in `src/core/model.ts` with its fields,
tables, child types and checks, and serialise it in `nodeToJson` / `documentFromJson`. The
generic editor renders forms and tables from those specs. Only special widgets need an
entry in `SECTION_REGISTRY` (`src/ui/Editor.tsx`).

**Schema notes.**
* Files are written byte-for-byte compatible with the schema, including its spellings
  (`Lenght`, `lenghtHash`, `slaveAdress`, `registerAdress`, `"Little Indian"`) and the
  lower-case `passthroughMode` hardware key.
* Unknown keys are preserved.
* The corporate email domain is `CORPORATE_EMAIL_DOMAIN` in `src/core/schema.ts`. A
  mismatch is a warning, not an error.
