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
5. Press **F5** to validate and **Ctrl+S** to save.

The **Build guide** in the sidebar tracks these steps with a progress bar. Clicking a step
selects the node that needs work and opens its right-click menu, or jumps to the node
that needs fixing. Each editor also shows a read-only *Next step* hint listing what can be
added through the right-click menu.

**Details pane (right side, F1).** It documents the selected node and every one of its inputs:
* For each node: what it represents, where it sits in the saved JSON (for example
  `project.cameraModels[0].hw[1].passthroughMode`), which child nodes it can contain, and its
  validation status.
* For each field and table column: a full description, its type, whether it's required, its
  range or allowed values, format, default, unit, an example and practical tips. It also
  shows the input's current value, any validation messages and its exact JSON key.
* Click into any field or table cell and the pane shows that input's documentation at the
  top. Double-click an entry (or use *Go to input*) to jump to the input. A filter box
  searches all inputs. Drag the pane's left edge to resize it.

The texts live in `src/core/docs.ts`. Type, range and allowed values are generated from the
same specs the validator uses, so they always match. A unit test fails if any field or
column is left undocumented.

Other features:
* Undo/redo; consecutive keystrokes in one field merge into a single undo step.
* Duplicate camera models and virtual channels.
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
src/state/       store.ts  (document state, undo/redo)
src/ui/          Tree, Editor (+ section registry), DetailsPane, fields/DataTable, Panels, overlays, icons
src/platform.ts  web ⇄ desktop file I/O abstraction
src-tauri/       desktop shell (Rust): dialog + fs plugins, permissions, icons
e2e/flow.py      Playwright test: builds a full config from an empty project and saves it
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
