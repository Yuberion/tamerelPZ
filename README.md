# PZ MANAGEMENT

**Project Zomboid mod management suite** — a Windows desktop app that finds every Project Zomboid mod on your drive, parses its metadata, classifies it, and lets you inspect it down to individual files.

Built with Electron 43, React 19, TypeScript and electron-vite. **Zero runtime dependencies.**

> **Status: early build (v0.1.0).** Five of nine modules are live: **Stalker** (read-only inventory and inspection), **Loadout** (load order and profiles), **Workbench** (mod authoring), **Tools** (an FBX converter and a Notepad++ bridge) and **Ledger** (crash logs and console output, read-only). Only Workbench, Loadout and Tools write to disk, each to a narrow, documented set of files — see [Write model](#write-model). See [Roadmap](#roadmap) for what is and isn't implemented.

---

## What it does

On launch the app auto-detects your Steam installation, every Steam library folder, the Workshop content directory for AppID `108600`, the Project Zomboid game directory and your `%USERPROFILE%\Zomboid` user directory. It then scans every mod container it finds and, for each mod:

- parses `mod.info` (id, name, author, version, `pzversion`, tags, `require=`)
- classifies it by folder layout heuristics — maps, vehicles, weapons, textures, translations, libraries, and 9 more categories
- detects supported game builds (B41 / B42) from version sub-folders
- resolves `require=` dependency graphs in both directions
- finds mod artwork (`poster.png`, `preview.png`, `icon.png`, …)

Then it reports cross-mod problems: **duplicate mod ids**, **unresolved requires**, and **mods with no readable `mod.info`**.

The **Workbench** module then lets you author mods: scaffold a new one, edit its `mod.info`, run ~30 static checks over it, and pack it for the Workshop. The **Loadout** module edits the mod lists the game itself reads, so the inventory can be turned into an actual load order. The **Ledger** module reads the game's own logs back, folds each crash into a single entry and points at the mod that threw it. The **Tools** module converts arbitrary files into `.fbx` with its own writer — including the text DirectX `.x` files PZ ships its models in — and teaches Notepad++ to read `media/scripts` and `mod.info`.

## Features

### Detection & scanning
- Steam root via registry (`HKCU\Software\Valve\Steam`, `HKLM\...\WOW6432Node\Valve\Steam`) with `Program Files` fallbacks; GOG registry fallback for the game directory
- All Steam libraries parsed from `libraryfolders.vdf`
- Five source kinds scanned: **local** (`Zomboid\mods`), **workshop**, **game** (`ProjectZomboid\mods`, `media\mods`), **project** (`Zomboid\Workshop\<Project>\Contents\mods`) and **custom** (user-added)
- Concurrent scan with live progress; in-memory cache keyed by folder mtime so rescans are near-instant
- Per-mod failures are isolated — one unreadable mod can't abort the scan

### Mod explorer (the "Stalker" module)
Three panes with draggable, persisted splitters:

| Pane | Contents |
|---|---|
| **Left** | Virtualised mod list — grouping by type/source/build/flat, 6 sort modes, fuzzy search with match highlighting, category colour bars, B41/B42 badges, issue glyphs, source glyphs |
| **Centre** | Lazy filesystem tree ("skeleton") — auto-expands `media`, `common`, `41.*`/`42.*`, `media/lua`, `media/scripts`; filter reveals matches inside collapsed folders; "load full tree" to depth 6 |
| **Right** | Info panel — **Mod** tab (artwork, categories, alerts, identity fields, on-disk stats with per-extension size bars, build folders, dependency graph with jump links, tags) and **File** tab (image preview with intrinsic dimensions, syntax-highlighted text preview, binary placeholder) |

Plus: filter chips with live counts, context menus (open folder, reveal in Explorer, open PowerShell here, copy mod id / path, open Workshop page), toast notifications, and a status bar with matched/total counts and scan timings.

### Load order & profiles (the "Loadout" module)

Edits the mod lists Project Zomboid reads for itself — the client list at `Zomboid\mods\default.txt` and every server config at `Zomboid\Server\<name>.ini`. Each config is a tab in a segmented picker; edits are held per config, so switching between them to compare never discards work.

| List | Config | Contents |
|---|---|---|
| **Mods** | both | Mod ids, in load order. `mods { }` for the client, semicolon-separated `Mods=` for a server |
| **Maps** | client | The `maps { }` block. Candidates are the real directory names under `media/maps` inside your installed map mods, read on demand |
| **Workshop ids** | server | Numeric `WorkshopItems=` ids, with one click to fill them in from the mods already listed |

Each line is resolved against the last scan, so an id that no installed mod answers to is flagged rather than silently ignored, and a repeat of an earlier line is marked too. Reorder by dragging, by the row arrows, or with `Alt+↑` / `Alt+↓`; **Fix order** does a dependency-aware pass that puts every mod after the mods its `require=` names. Bulk actions cover dedupe, dropping missing entries and clearing the list.

Writes are deliberately conservative: the client list is rebuilt whole (its `VERSION` line is echoed back as found), while a server ini keeps every other key and comment untouched — only its `Mods=` and `WorkshopItems=` lines change. With **Backup** on, the previous file is kept beside it as `.bak`.

**Profiles** are named snapshots of a list, stored in the suite's own `settings.json`. Saving one changes nothing the game reads, and loading one only fills the editor — nothing reaches disk until you press Apply. Mod ids move between client and server configs; map names and Workshop ids only load back into the same kind of config.

### Authoring (the "Workbench" module)

Four tools over a virtualised list of the mods you can actually edit (mods outside a writable root are listed but flagged read-only):

| Tool | What it does |
|---|---|
| **Scaffold** | Creates a mod folder from scratch: `mod.info` per build, `media` sub-trees you tick, optional runnable starter files (lua entry points, an example item script, a translation stub in the format its build expects) and a generated placeholder `poster.png`. Build 41 / Build 42 / both layouts. Refuses to touch an existing folder. |
| **mod.info** | Field editor and raw text editor over the same file, switchable without losing unsaved edits. Atomic writes, optional rolling `mod.info.bak`, `Ctrl+S`. |
| **Validate** | 38 static checks across `mod.info`, Lua, `media/scripts` and translations, graded error / warning / note. Findings carry a stable rule id and are localised in the renderer. |
| **Pack** | Stages the `Contents/mods/…` + `workshop.txt` + `preview.png` layout the in-game uploader expects, or writes a single `.zip`. Build filtering and exclude patterns; version control, editor state, backups and logs are always skipped. |

The validator's Lua scanner runs a real lexer over strings, long strings (`[==[ … ]==]`) and both comment forms before checking bracket and block balance, so `end` inside a string or a `)` inside a comment does not produce a finding. Rules that could fire on legitimate content are warnings, never errors.

Translations are checked in both of the game's formats: the Build 41 Lua table (`ItemName_EN.txt`, whose table name must match its language folder) and the Build 42 flat JSON object (`ItemName.json`). A mod supporting both builds can ship both, and each file is checked against the format its extension implies.

### Crash logs (the "Ledger" module)

Reads the game's own output: the live `Zomboid\console.txt` of the session that is running, plus every archived file under `Zomboid\Logs`, newest first. **Read-only — this module has no write path at all.**

Only the last 1 MiB of a file is loaded. Logs grow to megabytes and the interesting part is always the end, so a head read would show the hardware dump and never the crash; when the head is skipped the pane says so.

| Feature | Detail |
|---|---|
| **Entries, not lines** | A Java exception with forty stack frames, or a Lua error fenced by dashed rules, is folded into one row. The full trace opens in the detail pane. |
| **Real severity** | Build 42 logs most Lua failures at `LOG` level, so a line whose text names an exception, a traceback, `attempted index` or a nil value is counted as an error whatever prefix it carries. The patterns are deliberately narrow — a bare `error` would match the dozens of `FMOD … result: No errors` lines a normal launch prints. |
| **Three header formats** | `LEVEL: Category f:0 at Origin> message` (console.txt), the same with a leading `[timestamp]` (`Logs\*_DebugLog.txt`), and `[timestamp][info] message` (chat and per-feature logs). Build 41's numeric columns are consumed too. The level, subsystem and call site become columns; the timestamp and frame counter are dropped. |
| **Mod attribution** | An entry is traced to an installed mod through PZ's own `\| MOD: <name>` tail, a path walking through a mod container, or a known mod id inside the trace — then Reveal in Explorer / copy id. Uses the last scan's index, so no extra I/O. |
| **Filters** | Level chips with live counts, fuzzy search over entry text that also matches inside folded traces, and a **First error** jump that clears whatever is hiding it. |

Rows are virtualised, so a 10,000-line tail scrolls at native speed. Parsing runs once per read: changing a filter or typing in the search box never re-reads the file.

### Converters & editors (the "Tools" module)

Two tools that share a toolbar and nothing else.

**FBX forge** — turns a file into an `.fbx`. There is no FBX SDK and no external converter involved: the mesh readers, the FBX 7.4 binary container, the ASCII container and the verifier are all part of the app, in keeping with the zero-dependency rule (only `zlib`, a Node builtin, is borrowed — FBX array properties are plain zlib streams).

| Route | Inputs | What comes out |
|---|---|---|
| **Mesh** | `obj`, `stl` (ascii + binary), `ply` (ascii + binary LE), `x` (text), `dae`, `gltf`, `glb` | Real geometry: shared vertex pool, n-gons kept as n-gons, per-corner normals and UVs, one FBX material per source material |
| **Image** | `png`, `jpg`, `bmp`, `gif`, `tga`, `dds` | A quad with the picture's aspect ratio, 100 units on its long side, the file embedded as media |
| **Re-encode** | `fbx` (binary) | The same document as ASCII |
| **Capsule** | anything else | A named null carrying name, size, mtime and SHA-256 as custom properties, plus the original bytes as embedded media. **No geometry is invented** |

Details that matter in practice:

- **Binary is the default** because Blender's importer rejects ASCII FBX outright. ASCII stays available — it is readable, diffable, and what the Autodesk tools and Unity accept.
- **DirectX `.x` is here because Project Zomboid ships its own models in it.** Text `.x` converts, including `Frame` hierarchies: transforms are composed down the tree and baked into the vertices. Because DirectX is left-handed, geometry is mirrored on Z and every polygon rewound — otherwise every model arrives inside out. Binary and compressed `.x` are **refused rather than guessed at**.
- **glTF and Collada node transforms are baked** the same way; a reader that ignores them piles every part of a model at the origin. Collada's `<up_axis>` is honoured, and a declared axis always beats the "source is Z-up" checkbox.
- **STL always welds.** It repeats every shared corner, so a cube arrives as 36 vertices instead of 8; welding is keyed on a 1e-5 grid because exporters round.
- **Verify after writing** re-parses the file that was just written with an independent reader and checks the mesh count, vertex data and polygon corners against what was intended. On by default for binary output — it is the difference between "the writer did not throw" and "the file parses and holds the geometry".
- **Scale** is applied before writing; FBX's unit is the centimetre, so a model authored in metres wants `100`.

**Notepad++ bridge** — installs two User Defined Languages so the editor can read the two formats PZ invented for itself:

| Language | Extension | Covers |
|---|---|---|
| `PZ Script` | `.txt` | `module` / `item` / `recipe` / `vehicle` / `craftRecipe` blocks (B41 + B42), ~130 property names, value enums, recipe modifiers, brace folding, `//` and `/* */` comments |
| `PZ ModInfo` | `.info` | Known `mod.info` keys, `#` comments, build folder names |

Notepad++ is found through the registry (64-bit, `WOW6432Node` and per-user), then the folders its installers use, then a folder you point at. Portable copies are detected by `doLocalConf.xml` and get their config read from the install directory instead of `%APPDATA%`. The pack is written into Notepad++'s own `userDefineLangs` folder, which it reads file-by-file since 7.6 — so nothing it ships is overwritten, no administrator rights are needed, and deleting the two files undoes all of it. Each file carries a version marker, which is how the panel knows whether what is installed is current.

### Write model

Three modules write. The Workbench uses a **stricter allowlist than the read guard**:

| Location | Read | Write |
|---|---|---|
| `Zomboid\mods`, `Zomboid\Workshop` | yes | **yes** |
| `customSources[].path` | yes | **yes** |
| Steam Workshop content (`steamapps\workshop\…`) | yes | no |
| Game install (`ProjectZomboid\`) | yes | no |

Workshop content is Steam-managed — a write there is reverted on the next validation — and the game directory is replaced wholesale by updates, so neither is ever written to. Folder names and mod ids are restricted to `A-Za-z0-9._+-` before they are concatenated into a path, and `assertPathWritable` is the second line of defence. Nothing in the module deletes or moves files; the strongest operation is replacing a `mod.info` it has just backed up.

Loadout writes two, and only two, kinds of file inside your Zomboid user directory: `mods\default.txt` and `Server\<name>.ini`. Neither is a mod container, so the Workbench allowlist does not cover them and would not help; instead the target is not a renderer-supplied path at all. The renderer sends an opaque target id (`client` or `server:<name>`), main resolves the path itself from the detected user directory, and a server name is only accepted if it matches `^[\w][\w .-]{0,63}$` — no separators, no traversal. Nothing else is created, moved or deleted, and the previous file can be kept as `.bak`.

Ledger uses the same opaque-id contract in the read direction and adds no rights of its own: the renderer sends `console` or `log:<file name>`, main builds the path under the detected user directory, and an archived name is only opened if it matches `^[\w.\-]{1,120}\.txt$` **and** appears in a live listing of `Logs`. Reveal and Open go through the existing `shell:*` handlers, which already run the path guard.

Tools is the one place that writes **outside** every known root, so it carries its own rule. A file is readable only if the user picked it in a native dialog *during this session*, or if it already sits inside a scanned mod root — nothing else may hand the forge a path, which is what stops a converter from doubling as a way to read the rest of the drive. A directory is writable only if it is a mod container the user owns (`isPathWritable`) **or** a folder outside every known root that the user picked themselves; a folder inside the game install or Steam's Workshop cache is refused outright, because the read allowlist is wider than the write one on purpose and the forge does not get to widen it. The output directory lives in `settings.json` precisely because it can only get there through a dialog. The Notepad++ channels take neither an executable path nor a destination: main derives both, which is what keeps them from becoming a way around the `shell:open` `.exe` refusal.

Zip archives, PNG placeholders and CRC32 are hand-rolled in `services/binfmt.ts` to preserve the zero-dependency constraint (DEFLATE comes from Node's builtin `zlib`). The FBX containers in `services/fbxbin.ts` are hand-rolled for the same reason.

### Hotkeys

| Key | Action |
|---|---|
| `Esc` | Back to hub (or clear search while typing) |
| `F5` / `Ctrl+R` | Rescan drive (Loadout: re-read the configs · Ledger: re-read the log) |
| `Ctrl+F` | Focus search |
| `Ctrl+S` | Save — `mod.info` in Workbench, the load order in Loadout |
| `Ctrl+Shift+E` | Reveal selection in Explorer |
| `↑` / `↓` | Navigate mods |
| `Alt+↑` / `Alt+↓` | Move the selected load order entry |
| `Del` | Remove the selected load order entry |
| `F12` / `Ctrl+Shift+I` | DevTools |

---

## Requirements

- **Windows** (see [Platform support](#platform-support))
- **Node.js 22.12+** — required by `electron@43.4.1` (`engines.node: ">= 22.12.0"`); no Node 20.x release satisfies the pinned toolchain
- Project Zomboid installed (Steam or GOG)

## Getting started

```bash
git clone https://github.com/tamerel/tamerelPZ.git
cd tamerelPZ
npm install
npm run dev
```

On Windows you can just double-click **`start.bat`** — it handles `cd`, runs `npm install` if needed, scrubs the environment (see below) and starts dev mode.

### `start.bat` modes

| Command | Action |
|---|---|
| `start.bat` | Dev mode with hot reload (default) |
| `start.bat build` | Production build to `out\` |
| `start.bat prod` | Build, then launch |
| `start.bat app` | Launch an existing build |
| `start.bat check` | Run typecheck |

Set `PZ_NOPAUSE=1` to skip the `pause` on failure.

### npm scripts

| Script | Action |
|---|---|
| `npm run dev` | `electron-vite dev` — renderer HMR, main/preload rebuild + restart |
| `npm run build` | `electron-vite build` → `out/{main,preload,renderer}` |
| `npm start` | Launch Electron against the build in `out/` |
| `npm run preview` | `electron-vite preview` |
| `npm run typecheck` | Typecheck both TS projects (node + web) |

> **Why every script goes through `scripts/run.mjs`:** VS Code's integrated terminal exports `ELECTRON_RUN_AS_NODE=1` to child processes. If that leaks through, the Electron binary boots as plain Node, `require('electron')` returns a path string instead of the API object, and the app dies with *"Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')"*. The wrapper deletes `ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE`, then spawns `electron-vite` or the Electron binary. `start.bat` clears the same variables.

---

## Architecture

```
src/
  main/                  Electron main process (Node)
    index.ts             window bootstrap, pzfile:// protocol, single-instance lock
    ipc.ts               all ipcMain.handle registrations
    services/
      paths.ts           Steam/PZ/Zomboid detection, source list, allowedRoots()
      scanner.ts         mod enumeration, analysis, issue detection, cache
      modinfo.ts         mod.info parser + id normalisation
      detect.ts          heuristic category classifier
      fsx.ts             pLimit, listDir, buildTree, walkStats, readPreview
      guard.ts           read + write path allowlists for untrusted renderer paths
      authoring.ts       scaffold, mod.info read/write (Workbench)
      validate.ts        static validator: mod.info, lua, scripts, translations
      pack.ts            Workshop staging + zip archive (Workbench)
      loadout.ts         default.txt / server ini mod lists (Loadout)
      logs.ts            console.txt + Logs\*.txt tail reader (Ledger, read-only)
      convert.ts         FBX forge orchestration + the picked-path consent rule (Tools)
      fbx.ts             FBX 7.4 document builder + verifier (Tools)
      fbxbin.ts          hand-rolled FBX binary/ASCII codecs and node tree (Tools)
      mesh.ts            OBJ/STL/PLY readers, welding, normals, axis + scale passes
      meshdcc.ts         DirectX .x / Collada / glTF readers, transforms baked
      npp.ts             Notepad++ detection + the PZ syntax pack (Tools)
      binfmt.ts          hand-rolled CRC32, ZIP and PNG writers
      settings.ts        settings.json load/save (atomic)
  preload/index.ts       contextBridge.exposeInMainWorld('pz', api)
  shared/                types.ts (data contracts), ipc.ts (channels), api.ts (PzApi)
  renderer/              React 19 SPA
    App.tsx              view switch: 'hub' | ModuleId
    hub/                 tile grid + dashboard, 9-module registry
    modules/stalker/     Stalker, Toolbar, ModList, Skeleton, InfoPanel, useModRows
    modules/loadout/     Loadout, OrderList, AvailablePanel, useLoadout
    modules/workbench/   Workbench, ScaffoldTool, InfoTool, ValidateTool, PackTool, ShoveTool
    modules/ledger/      Ledger, LogList, LogDetail, parseLog, useLogs
    modules/tools/       Tools, ForgeTool, NppTool, useForge, useNpp
    components/          TitleBar, Menu, Splitter, Toast, Form, Icon (~70 inline SVGs)
    lib/                 useVirtual, catmeta, format (fuzzy), highlight
    state/store.tsx      React Context store
    styles/              theme.css (tokens), app.css, stalker.css, workbench.css, loadout.css, ledger.css, tools.css
scripts/run.mjs          env-scrubbing launcher
start.bat                Windows launcher
```

### Security model

- `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; the renderer sees a single typed `window.pz` object
- **Path allowlist guard** — renderer-supplied paths are untrusted. Every path-taking IPC handler and the `pzfile://` protocol handler funnels through `assertPathAllowed`, which rejects empty paths, anything containing `..`, and anything outside the detected roots. Roots are cached for 30s and invalidated on `settings:set`.
- **Writes use a second, narrower allowlist** (`assertPathWritable`) covering only `Zomboid\mods`, `Zomboid\Workshop` and user-declared custom sources. See [Write model](#write-model).
- **The allowlist is defined by settings, and `settings:set` does not validate its patch.** `customSources[].path`, `gameDirOverride` and `zomboidDirOverride` become guard roots, so a compromised renderer can widen its own allowlist. Treat the guard as defence in depth against path bugs, not as a boundary against a hostile renderer.
- **Only three services write inside the mod roots**, and none of them deletes, moves or copies a user file: `authoring.ts`/`pack.ts` (Workbench, inside the write allowlist), `loadout.ts` (two config files whose paths main derives itself) and `settings.ts` (its own `settings.json`). The Workbench creates files and replaces a `mod.info` it has just backed up; Loadout replaces a mod list it can likewise back up first.
- **Tools adds two more writers, both narrow.** `convert.ts` writes `.fbx` files, and only into a directory that is either inside the write allowlist or one the user picked in a native dialog — a directory inside the game install or Steam's Workshop cache is refused even when the user picks it. Its *inputs* are limited the same way: a path is readable only if this session's file dialog returned it, or if it is already inside a scanned mod root. `npp.ts` writes exactly two XML files into `userDefineLangs`, a path it derives itself from `%APPDATA%` or a detected portable install; no channel accepts a destination.
- **Two handlers do hand untrusted content to the OS, though.** `shell:open` refuses ~50 executable and script extensions and reveals them in Explorer instead, and `shell:terminal` spawns an absolute `System32` interpreter path so a mod cannot shadow `powershell.exe` from its own folder. Everything else in a mod folder still opens with its registered default handler, so the usual "don't run unknown files" caution applies.
- **`npp:open` is the third, and it is deliberately not a general launcher.** The file it opens goes through `assertPathAllowed`; the executable never comes from the renderer at all, because accepting one would be a way around the `.exe` refusal above.
- `shell:external` rejects anything that isn't `http(s)://`; `setWindowOpenHandler` and `will-navigate` push external links to the OS browser and deny in-app navigation
- CSP declared in `index.html`; `uncaughtException` / `unhandledRejection` are logged, not fatal — a stray rejection in a filesystem walk must never kill the app

### `pzfile://` protocol

Mod artwork and image previews load over a custom privileged scheme, `pzfile://f/<base64url(absolutePath)>`. Absolute paths are base64url-encoded so drive letters, spaces and backslashes survive Chromium URL normalisation. The handler decodes, normalises, runs the path guard, then `net.fetch`es the file — so artwork renders without disabling `webSecurity` or exposing the whole disk.

### IPC channels

| Channel | Purpose |
|---|---|
| `app:info` | App/Electron/Chrome/Node versions |
| `window:minimize` · `window:maximize` · `window:close` | Frameless window controls |
| `window:state` | *(event)* maximise state → renderer |
| `paths:detect` · `paths:pick-folder` | Detection report, native folder dialog |
| `mods:scan` · `mods:progress` | Full scan; progress *(event)*, throttled to ~60ms |
| `mods:stats` | Recursive file/dir/byte + per-extension stats |
| `fs:list` · `fs:tree` · `fs:preview` | Directory children, tree (depth 1–6), file preview |
| `shell:reveal` · `shell:open` · `shell:external` · `shell:terminal` | Shell integrations |
| `settings:get` · `settings:set` | Read / merge-patch settings |
| `wb:targets` | Containers new mods may be scaffolded into |
| `wb:scaffold` | Create a mod skeleton |
| `wb:read-info` · `wb:write-info` | Read / write a `mod.info` (write-guarded) |
| `wb:validate` · `wb:progress` | Static validation; progress *(event)* |
| `wb:pack` | Stage a Workshop project or write a `.zip` |
| `wb:shove` · `wb:shove-cancel` | Batch pack many mods in one run |
| `lo:files` | Every editable mod list: client `default.txt` + server inis |
| `lo:apply` | Write one config's mod lists back (write-guarded) |
| `log:list` | `console.txt` + every `Logs\*.txt`, freshest first |
| `log:read` | Tail of one log by opaque id (read-only, max 1 MiB) |
| `tools:pick` · `tools:pick-output` | Native dialogs; the only way a path outside the mod roots enters the forge |
| `tools:inspect` | Classify paths the renderer already knows about (files inside mod roots) |
| `tools:convert` · `tools:convert-cancel` · `tools:progress` | Run the FBX forge; progress *(event)*, throttled to ~60ms |
| `tools:reveal` | Reveal a converted file / open the output folder (picked-path rule, not the read guard) |
| `npp:status` · `npp:locate` | Probe for Notepad++; ask the user where it lives |
| `npp:install` · `npp:preview` | Write the PZ syntax pack; render it as text first |
| `npp:open` | Open one allowlisted file in Notepad++, optionally at a line |
| `npp:reveal` | Reveal the exe / open `userDefineLangs`, both resolved in main by name |

### Notable implementation details

Everything below is hand-rolled — the project has **no runtime dependencies at all**:

- **Virtualiser** (`lib/useVirtual.ts`, ~65 lines) — fixed-height rows, overscan 12, `ResizeObserver`-measured viewport. Keeps 900+ mod rows and 10k+ file rows scrolling at native speed.
- **Fuzzy matcher** (`lib/format.ts`) — exact-substring fast path with word-start bonus, subsequence scoring with streak bonuses and gap penalty; returns match indices for `<mark>` highlighting. Fast enough to run over ~1000 mods per keystroke.
- **Syntax highlighter** (`lib/highlight.ts`, ~82 lines) — regex tokenizers for Lua, JSON, XML and INI (`mod.info` highlights as INI).
- **Icon set** (`components/Icon.tsx`) — ~70 inline 24×24 stroke SVGs.
- **Zip / PNG writers** (`services/binfmt.ts`) — CRC32 table, local + central directory records and PNG chunk framing written by hand; DEFLATE borrowed from Node's builtin `zlib`. Already-compressed extensions are stored rather than re-deflated.
- **FBX containers** (`services/fbxbin.ts`) — the record format (end offset, property list, 13-byte nested-list sentinel), all eleven property types, zlib-packed array properties, the 23-byte header magic and the footer, plus a reader used to verify what was just written. Object names are stored reversed in binary (`Torso\0\1Model`) and as `Model::Torso` in ASCII, which is why the node tree carries a name *pair* and lets each encoder spell it its own way.
- **Mesh readers** (`services/mesh.ts`, `services/meshdcc.ts`) — OBJ, STL (ascii + binary), PLY (ascii + binary LE), text DirectX `.x`, Collada and glTF/GLB, all normalised to one model: shared position pool, n-gon polygons, attributes per polygon *corner* (the only layout that survives all six formats without an index table). Newell's method for n-gon normals, 1e-5 grid welding, and one flat-matrix convention that happens to be both DirectX's row-vector layout and glTF's column-vector layout, so both formats' matrices drop in untouched.
- **`pLimit`** (`fsx.ts`, ~20 lines) — used at 48 (stat/listing), 32 (source enumeration) and 28 (mod analysis) so thousands of `stat` calls don't stampede.
- **Frameless titlebar** — `frame: false` plus a React `TitleBar` with `-webkit-app-region` drag zones; native menu removed.
- **Image dimensions without decoding** — PNG/GIF/BMP/JPEG headers parsed from the first ≤64KB; the forge adds DDS and TGA so a texture becomes a correctly proportioned quad.
- **Scan safety limits** — `walkStats` caps at 250,000 entries and depth 32 and reports `truncated`; symlinks and junctions are skipped everywhere to avoid infinite recursion; text reads cap at 256KB (64KB for `mod.info`), rendering caps at 1200 lines.
- **B42 awareness** — version sub-folder discovery (`common`, `41.x`, `42.x`), weight-based selection of the canonical `mod.info`, normalisation of B42 `<workshopId>/<ModId>` ids so duplicate and dependency checks line up, and both the B41 Lua-table and B42 JSON translation formats.

### Tech stack

| Component | Version |
|---|---|
| Electron | 43.4.1 |
| electron-vite | 5.0.0 |
| Vite | 7.3.6 |
| React / React DOM | 19.2.8 |
| TypeScript | 7.0.2 *(native preview compiler)* |

State management is plain React Context + hooks. No state library, no icon library, no virtualiser library, no syntax highlighter, no CSS framework, no web fonts (system stack: Bahnschrift SemiCondensed / Segoe UI Variable / Cascadia Mono).

---

## Configuration

Settings live at:

```
%APPDATA%\pz-management\settings.json
```

Written atomically (tmp file + rename) and treated as best-effort — a corrupt or missing file falls back to defaults.

```jsonc
{
  // Source ids to skip.
  "disabledSources": [],
  // Extra mod containers. Objects, not bare paths — `kind` drives the on-disk layout
  // the scanner expects, so use "custom" unless you are mimicking a built-in source.
  "customSources": [
    { "id": "extra", "label": "Extra mods", "path": "E:\\Mods", "kind": "custom" }
  ],
  // name | name-desc | type | recent | id | source   ("recent" is labelled "Newest" in the UI)
  "sortMode": "name",
  // type | source | build | none                     ("none" is labelled "Flat" in the UI)
  "groupMode": "type",
  "gameDirOverride": "…",       // optional: override PZ game dir detection
  "zomboidDirOverride": "…",    // optional: override %USERPROFILE%\Zomboid
  "lastModKey": "…",            // last selected mod, restored on launch
  // Output container for the Tools converter. Only ever written by the module's
  // own folder dialog — that dialog is what makes the path writable at all.
  "toolsOutputDir": "…",
  // Notepad++ install folder, when detection needs a manual answer.
  "nppPathOverride": "…",
  // Saved Loadout lists, newest first. Written by the module, not by hand.
  "loadoutProfiles": [
    {
      "id": "m1x2y3-a1b2c3",
      "name": "Vanilla+",
      "kind": "client",
      "mods": ["Mod A", "Mod B"],
      "maps": ["Muldraugh, KY"],
      "workshopItems": [],
      "savedAt": 1750000000000
    }
  ]
}
```

`disabledSources`, `customSources`, `gameDirOverride` and `zomboidDirOverride` are honoured by the scanner but **have no UI yet** — set them by hand-editing the file. An unrecognised `sortMode` or `groupMode` value is ignored silently, so use the exact values above. Pane widths are stored separately in `localStorage`.

---

## Roadmap

The hub shows nine module tiles. **Five are live; four are sealed placeholders** that currently only show a toast:

| Module | Purpose | Status |
|---|---|---|
| **Stalker** | Mod explorer | ✅ Live |
| **Loadout** | Load order & profiles | ✅ Live |
| Signal | Workshop sync | 🔒 Sealed |
| **Workbench** | Mod authoring | ✅ Live |
| Triage | Conflict doctor | 🔒 Sealed |
| Cartograph | Map manager | 🔒 Sealed |
| **Tools** | Converters & editors | ✅ Live |
| Outpost | Server & collections | 🔒 Sealed |
| **Ledger** | Logs & settings | ✅ Live (logs only) |

### Known limitations

- **No install/uninstall, no subscription management and no backups.** Loadout edits the lists the game reads; it never adds or removes a mod on disk, so an entry it cannot resolve stays in the list until you drop it.
- **Loadout does not touch per-save mod lists.** Project Zomboid also copies a list into `Saves\…\mods.txt` when a world is created; changing `default.txt` affects new worlds, not existing saves.
- **Ledger is a reader, and only half a module.** No live follow — a log is re-read on `F5`, not tailed — and the "settings" half of the tile is not built: `disabledSources`, `customSources` and the path overrides are read from `settings.json` by the scanner but have no UI. Only the last 1 MiB of a file is loaded, so a very large log is shown from its tail.
- **Ledger's severity and mod attribution are heuristic.** Levels are raised from log text by pattern, and a mod is guessed from a name tag, a path or an id token; an unattributed entry means "no evidence", not "no mod involved".
- **The validator is heuristic.** Its Lua and script scanners are hand-written lexers, not full parsers, tuned to avoid false errors; a clean report is not a guarantee the game will load the mod.
- **The FBX forge writes geometry, not scenes.** No skeletons, no skin weights, no animation tracks, no cameras or lights — a converted mesh arrives with an identity transform and flat or source-supplied normals. Materials carry a name and a diffuse texture, not a shader graph.
- **Binary and compressed DirectX `.x` are not read.** Some Project Zomboid models ship in the binary flavour; those convert as capsules rather than geometry. The ASCII→binary FBX direction is likewise missing, because reading ASCII FBX needs a parser this build does not have.
- **A capsule is transport, not conversion.** For a file the forge cannot interpret it writes metadata and, optionally, the original bytes as embedded media. That is a valid FBX carrying your file; it is not a model, and nothing pretends otherwise.
- **The Notepad++ pack is highlighting, not IntelliSense.** UDLs give colour, folding and comment awareness. Auto-completion lists live in Notepad++'s install directory, which needs administrator rights, so they are out of scope; the keyword lists are also a curated snapshot of B41/B42 script keys rather than an exhaustive one.
- **Packing does not upload.** It stages the Workshop project layout; publishing is still done from inside Project Zomboid.
- **No packaging.** No electron-builder/forge config, no app icon, no CI, no releases. Distribution today is clone → `npm install` → `npm run build` → `npm start`.
- **No UI for custom sources or directory overrides** — hand-edit `settings.json`.
- **Scan cache is in-memory only** — a restart always does a cold scan.
- **Per-source scanning is unimplemented in the UI** — the scanner supports it, but the renderer always requests a full rescan.
- **Category classification is heuristic, not authoritative.** Weighted scoring over folder layout, with an opinionated rule that shared container folders (`media/ui`, `media/sound`, `Translate`) only win when the mod carries nothing heavier (`scripts`, `models`, `maps`, `clothing`, `texturepacks`).
- **No tests, no linter or formatter config.** The quality gate is `npm run typecheck`.

### Platform support

Windows-only in practice: registry probing via `reg query`, `shell:terminal` returns early off-win32, Explorer-specific wording, and `start.bat`. There is a `~/.steam/steam` detection candidate and macOS lifecycle handling in place, but no macOS/Linux game-directory detection and no non-Windows launcher.

---

## Contributing

```bash
npm run typecheck   # must pass — this is the only automated gate
```

Both TS projects are `strict` with `noUnusedLocals` and `noUnusedParameters`. Note that the toolchain uses **TypeScript 7.0.2**, the native preview compiler — bleeding edge, and worth knowing before you debug a type error.

Guidelines:
- `src/shared/` must not import `electron` or `node` at runtime — it is shared with the renderer.
- Any new IPC handler that accepts a path **must** go through `assertPathAllowed` from `services/guard.ts`.
- Any handler that *writes* **must** additionally go through `assertPathWritable`, and must not delete or move user files. The one exception is `loadout.ts`, which writes outside the mod containers — it must therefore never accept a path from the renderer, only an opaque target id it resolves itself.
- New validator rules need a matching `wbrule.<rule>` entry in **both** `EN` and `RU`; `RU` is typed as `Record<TKey, string>`, so a missing key is a compile error.
- Keep the zero-runtime-dependency constraint unless there's a compelling reason not to.

## About the name

*Stalker* is a module codename reflecting the app's post-apocalyptic visual styling — rusted steel, ash, bone, grain and scanline overlays, corner-bracket HUD motifs. **It is not S.T.A.L.K.E.R. mod support.** This app targets Project Zomboid (Steam AppID `108600`) exclusively.

## Disclaimer

Unofficial community project. Not affiliated with or endorsed by The Indie Stone.

## License

MIT
