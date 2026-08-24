# PZ MANAGEMENT

**Project Zomboid mod management suite** — a Windows desktop app that finds every Project Zomboid mod on your drive, parses its metadata, classifies it, and lets you inspect it down to individual files.

Built with Electron 43, React 19, TypeScript and electron-vite. **Zero runtime dependencies.**

> **Status: early build (v0.1.0).** Two of nine modules are live: **Stalker** (read-only inventory and inspection) and **Workbench** (mod authoring). Workbench is the only part of the suite that writes to disk, and it is restricted to mod containers you own — see [Write model](#write-model). See [Roadmap](#roadmap) for what is and isn't implemented.

---

## What it does

On launch the app auto-detects your Steam installation, every Steam library folder, the Workshop content directory for AppID `108600`, the Project Zomboid game directory and your `%USERPROFILE%\Zomboid` user directory. It then scans every mod container it finds and, for each mod:

- parses `mod.info` (id, name, author, version, `pzversion`, tags, `require=`)
- classifies it by folder layout heuristics — maps, vehicles, weapons, textures, translations, libraries, and 9 more categories
- detects supported game builds (B41 / B42) from version sub-folders
- resolves `require=` dependency graphs in both directions
- finds mod artwork (`poster.png`, `preview.png`, `icon.png`, …)

Then it reports cross-mod problems: **duplicate mod ids**, **unresolved requires**, and **mods with no readable `mod.info`**.

The **Workbench** module then lets you author mods: scaffold a new one, edit its `mod.info`, run ~30 static checks over it, and pack it for the Workshop.

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

### Authoring (the "Workbench" module)

Four tools over a virtualised list of the mods you can actually edit (mods outside a writable root are listed but flagged read-only):

| Tool | What it does |
|---|---|
| **Scaffold** | Creates a mod folder from scratch: `mod.info` per build, `media` sub-trees you tick, optional runnable starter files (lua entry points, an example item script, a translation stub) and a generated placeholder `poster.png`. Build 41 / Build 42 / both layouts. Refuses to touch an existing folder. |
| **mod.info** | Field editor and raw text editor over the same file, switchable without losing unsaved edits. Atomic writes, optional rolling `mod.info.bak`, `Ctrl+S`. |
| **Validate** | ~30 static checks across `mod.info`, Lua, `media/scripts` and translations, graded error / warning / note. Findings carry a stable rule id and are localised in the renderer. |
| **Pack** | Stages the `Contents/mods/…` + `workshop.txt` + `preview.png` layout the in-game uploader expects, or writes a single `.zip`. Build filtering and exclude patterns; version control, editor state, backups and logs are always skipped. |

The validator's Lua scanner runs a real lexer over strings, long strings (`[==[ … ]==]`) and both comment forms before checking bracket and block balance, so `end` inside a string or a `)` inside a comment does not produce a finding. Rules that could fire on legitimate content are warnings, never errors.

### Write model

The Workbench is the only writer, and it uses a **stricter allowlist than the read guard**:

| Location | Read | Write |
|---|---|---|
| `Zomboid\mods`, `Zomboid\Workshop` | yes | **yes** |
| `customSources[].path` | yes | **yes** |
| Steam Workshop content (`steamapps\workshop\…`) | yes | no |
| Game install (`ProjectZomboid\`) | yes | no |

Workshop content is Steam-managed — a write there is reverted on the next validation — and the game directory is replaced wholesale by updates, so neither is ever written to. Folder names and mod ids are restricted to `A-Za-z0-9._+-` before they are concatenated into a path, and `assertPathWritable` is the second line of defence. Nothing in the module deletes or moves files; the strongest operation is replacing a `mod.info` it has just backed up.

Zip archives, PNG placeholders and CRC32 are hand-rolled in `services/binfmt.ts` to preserve the zero-dependency constraint (DEFLATE comes from Node's builtin `zlib`).

### Hotkeys

| Key | Action |
|---|---|
| `Esc` | Back to hub (or clear search while typing) |
| `F5` / `Ctrl+R` | Rescan drive |
| `Ctrl+F` | Focus search |
| `Ctrl+Shift+E` | Reveal selection in Explorer |
| `↑` / `↓` | Navigate mods |
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
      binfmt.ts          hand-rolled CRC32, ZIP and PNG writers
      settings.ts        settings.json load/save (atomic)
  preload/index.ts       contextBridge.exposeInMainWorld('pz', api)
  shared/                types.ts (data contracts), ipc.ts (channels), api.ts (PzApi)
  renderer/              React 19 SPA
    App.tsx              view switch: 'hub' | ModuleId
    hub/                 tile grid + dashboard, 9-module registry
    modules/stalker/     Stalker, Toolbar, ModList, Skeleton, InfoPanel, useModRows
    modules/workbench/   Workbench, ScaffoldTool, InfoTool, ValidateTool, PackTool, Form
    components/          TitleBar, Menu, Splitter, Toast, Icon (~60 inline SVGs)
    lib/                 useVirtual, catmeta, format (fuzzy), highlight
    state/store.tsx      React Context store
    styles/              theme.css (tokens), app.css, stalker.css
scripts/run.mjs          env-scrubbing launcher
start.bat                Windows launcher
```

### Security model

- `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; the renderer sees a single typed `window.pz` object
- **Path allowlist guard** — renderer-supplied paths are untrusted. Every path-taking IPC handler and the `pzfile://` protocol handler funnels through `assertPathAllowed`, which rejects empty paths, anything containing `..`, and anything outside the detected roots. Roots are cached for 30s and invalidated on `settings:set`.
- **Writes use a second, narrower allowlist** (`assertPathWritable`) covering only `Zomboid\mods`, `Zomboid\Workshop` and user-declared custom sources. See [Write model](#write-model).
- **The allowlist is defined by settings, and `settings:set` does not validate its patch.** `customSources[].path`, `gameDirOverride` and `zomboidDirOverride` become guard roots, so a compromised renderer can widen its own allowlist. Treat the guard as defence in depth against path bugs, not as a boundary against a hostile renderer.
- **Outside the Workbench, no `fs` write, delete, move or copy call exists** except `settings.ts`, which writes only its own `settings.json`. The Workbench never deletes or moves anything either: it creates files, and replaces a `mod.info` it has just backed up.
- **Two handlers do hand untrusted content to the OS, though.** `shell:open` refuses ~50 executable and script extensions and reveals them in Explorer instead, and `shell:terminal` spawns an absolute `System32` interpreter path so a mod cannot shadow `powershell.exe` from its own folder. Everything else in a mod folder still opens with its registered default handler, so the usual "don't run unknown files" caution applies.
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

### Notable implementation details

Everything below is hand-rolled — the project has **no runtime dependencies at all**:

- **Virtualiser** (`lib/useVirtual.ts`, ~65 lines) — fixed-height rows, overscan 12, `ResizeObserver`-measured viewport. Keeps 900+ mod rows and 10k+ file rows scrolling at native speed.
- **Fuzzy matcher** (`lib/format.ts`) — exact-substring fast path with word-start bonus, subsequence scoring with streak bonuses and gap penalty; returns match indices for `<mark>` highlighting. Fast enough to run over ~1000 mods per keystroke.
- **Syntax highlighter** (`lib/highlight.ts`, ~82 lines) — regex tokenizers for Lua, JSON, XML and INI (`mod.info` highlights as INI).
- **Icon set** (`components/Icon.tsx`) — ~65 inline 24×24 stroke SVGs.
- **Zip / PNG writers** (`services/binfmt.ts`) — CRC32 table, local + central directory records and PNG chunk framing written by hand; DEFLATE borrowed from Node's builtin `zlib`. Already-compressed extensions are stored rather than re-deflated.
- **`pLimit`** (`fsx.ts`, ~20 lines) — used at 48 (stat/listing), 32 (source enumeration) and 28 (mod analysis) so thousands of `stat` calls don't stampede.
- **Frameless titlebar** — `frame: false` plus a React `TitleBar` with `-webkit-app-region` drag zones; native menu removed.
- **Image dimensions without decoding** — PNG/GIF/BMP/JPEG headers parsed from the first ≤64KB.
- **Scan safety limits** — `walkStats` caps at 250,000 entries and depth 32 and reports `truncated`; symlinks and junctions are skipped everywhere to avoid infinite recursion; text reads cap at 256KB (64KB for `mod.info`), rendering caps at 1200 lines.
- **B42 awareness** — version sub-folder discovery (`common`, `41.x`, `42.x`), weight-based selection of the canonical `mod.info`, and normalisation of B42 `<workshopId>/<ModId>` ids so duplicate and dependency checks line up.

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
  "lastModKey": "…"             // last selected mod, restored on launch
}
```

`disabledSources`, `customSources`, `gameDirOverride` and `zomboidDirOverride` are honoured by the scanner but **have no UI yet** — set them by hand-editing the file. An unrecognised `sortMode` or `groupMode` value is ignored silently, so use the exact values above. Pane widths are stored separately in `localStorage`.

---

## Roadmap

The hub shows nine module tiles. **Two are live; seven are sealed placeholders** that currently only show a toast:

| Module | Purpose | Status |
|---|---|---|
| **Stalker** | Mod explorer | ✅ Live |
| Loadout | Load order & profiles | 🔒 Sealed |
| Signal | Workshop sync | 🔒 Sealed |
| **Workbench** | Mod authoring | ✅ Live |
| Triage | Conflict doctor | 🔒 Sealed |
| Cartograph | Map manager | 🔒 Sealed |
| Bunker | Backups | 🔒 Sealed |
| Outpost | Server & collections | 🔒 Sealed |
| Ledger | Logs & settings | 🔒 Sealed |

### Known limitations

- **No enable/disable, load order writing, `mods.txt` generation, install/uninstall or backups.** Inventory, inspection and authoring only.
- **The validator is heuristic.** Its Lua and script scanners are hand-written lexers, not full parsers, tuned to avoid false errors; a clean report is not a guarantee the game will load the mod.
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
- Any handler that *writes* **must** additionally go through `assertPathWritable`, and must not delete or move user files.
- New validator rules need a matching `wbrule.<rule>` entry in **both** `EN` and `RU`; `RU` is typed as `Record<TKey, string>`, so a missing key is a compile error.
- Keep the zero-runtime-dependency constraint unless there's a compelling reason not to.

## About the name

*Stalker* is a module codename reflecting the app's post-apocalyptic visual styling — rusted steel, ash, bone, grain and scanline overlays, corner-bracket HUD motifs. **It is not S.T.A.L.K.E.R. mod support.** This app targets Project Zomboid (Steam AppID `108600`) exclusively.

## Disclaimer

Unofficial community project. Not affiliated with or endorsed by The Indie Stone.

## License

MIT
