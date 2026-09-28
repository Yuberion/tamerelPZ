# PZ MANAGEMENT

**Project Zomboid Mod Management & Development Suite** — a high-performance Windows desktop application designed to discover, inspect, author, validate, and debug mods for **Project Zomboid** (supporting both **Build 41** and **Build 42**).

**Author & Creator**: **Tamerel**  
Built with Electron 43, React 19, TypeScript, and electron-vite. **Zero runtime dependencies** for the core modding engine.

> **Status: Active Development (v0.1.0).** **Six of nine modules are live and fully functional**:
> 1. **Explorer (01)** — Read-only inventory, file tree, global mod grep, and an interactive 3D WebGL viewport with autonomous texture resolution.
> 2. **Loadout (02)** — Load order editor, dependency resolver, map manager, and profiles for client (`default.txt`) and servers (`.ini`).
> 3. **Workshop Overview (03)** — Steam Workshop hub with live subscription management and 31-category filtering via native `steamworks.js`.
> 4. **Workbench (04)** — Mod authoring studio: scaffolding (B41/B42), dual `mod.info` editor, 38-rule static validator, and Workshop packager.
> 5. **Tools (07)** — FBX Forge 3D converter (DirectX `.x`, OBJ, STL, PLY, DAE, glTF), Notepad++ syntax bridge, and RAM / JVM memory optimizer.
> 6. **Ledger (09)** — Crash log and console analyzer with stack trace folding and automatic mod attribution.
>
> In addition, the suite embeds an autonomous **MCP Server (`pz-modding`)** providing 6 JSON-RPC tools for AI agents and developers.

---

## What It Does

On launch, PZ MANAGEMENT automatically discovers your Steam installation, library folders across all drives, Workshop content for AppID `108600`, Project Zomboid install directories, and `%USERPROFILE%\Zomboid`. It scans every mod container in parallel and:

- Parses `mod.info` (id, name, author, version, `pzversion`, tags, `require=`).
- Classifies mods into categories (maps, vehicles, weapons, clothing, textures, audio, translations, frameworks, and more).
- Detects multi-build support (B41 / B42 / common overlays).
- Constructs bidirectional dependency graphs (`require=`).
- Extracts and indexes mod artwork (`poster.png`, `icon.png`, previews).
- Identifies cross-mod conflicts: duplicate mod IDs, missing dependencies, unreadable manifests, and overwritten base game files.

---

## Modules & Features

### 01. Explorer (Mod Inventory & 3D Inspector)
A high-density 3-pane virtualized inspector:

| Pane | Contents |
|---|---|
| **Left (Mod List)** | Virtualized list of all detected mods. Grouping by category, source, build, or flat; 6 sorting modes; instant fuzzy search with token highlighting; status badges (B41/B42, duplicate IDs, missing dependencies, local/workshop source). |
| **Center (Skeleton Tree)** | Virtualized lazy filesystem browser. Auto-expands key folders (`media`, `common`, `42/media`, `scripts`, `lua`, `clothing`); deep filter revealing matches inside collapsed folders. |
| **Right (Info & Previews)** | **Mod Tab**: Artwork preview, categories, ID, path, author, file counts, on-disk size breakdown by extension, dependency tree with clickable jump links.<br>**File Tab**: Code editor with syntax highlighting for Lua/JSON/INI/TXT, image preview with intrinsic dimensions, and audio playback (`.ogg`, `.wav`). |

#### Advanced Explorer Capabilities:
- **Interactive 3D WebGL Viewport (`MeshPreview`)**:
  - Live 3D model rendering directly inside the app for DirectX `.x` (both ASCII and binary token streams), FBX (binary 7.4/7.5 and ASCII), OBJ, STL, PLY, Collada DAE, and glTF/GLB.
  - Orbit camera, wireframe overlay, model auto-centering, grid floor, and real-time lighting.
  - **Autonomous Multi-Tier Texture Resolution**: Automatically detects, matches, and applies diffuse textures for any mod. Employs a 3-tier cascade:
    1. *Tier 1 (Current Mod)*: XML definitions (`clothingItems`), PZ script blocks (`model`, `item`, `vehicle` skins), and model folder textures.
    2. *Tier 2 (External Libraries & Sibling Mods)*: Resolves shared assets from sibling mods (`Zomboid/mods`) and popular workshop libraries (`tsarslib`, `damnlib`, `Frockin Splendor`, `92amgeneralM998`, etc.) with 60-second in-memory caching.
    3. *Tier 3 (Vanilla Fallback)*: Fallback to base game textures (e.g. hair and beard meshes textured via `F_Hair_Blonde.png` / `f_hair_white.png`).
- **Global Mod Grep (`ModGrepModal`)**:
  - Ultra-fast regex / text search across every file in all installed mods with line snippets and direct mod attribution.
- **Vanilla Overwrite Inspector**:
  - Compares mod files against the vanilla Project Zomboid `media` directory to pinpoint exactly which base game files are being overridden.

---

### 02. Loadout (Load Order & Profiles)
Edits the configuration files Project Zomboid reads directly: the client load list at `Zomboid\mods\default.txt` and dedicated server configs at `Zomboid\Server\<name>.ini`.

| Feature | Description |
|---|---|
| **Mods** | Ordered mod list for client (`mods { }`) or server (`Mods=`). Real-time detection of unresolved or missing mod IDs. |
| **Maps** | Interactive `maps { }` picker populated with verified map directories scanned from `media/maps`. |
| **Workshop Items** | Numerical `WorkshopItems=` synchronization with one-click autofill from the active mod list. |
| **Fix Order** | Topological dependency sort ensuring required parent mods load before dependent children. |
| **Merge Patching** | Automatic generation of isolated `*_Port` merge-patch mods to resolve file and tile conflicts. |
| **Profiles** | Save, load, export, and switch named mod presets without modifying game files until applied. Automatic `.bak` backups. |

---

### 03. Workshop Overview (Steam Workshop Manager)
Native Steam Workshop hub integrated via `steamworks.js`:

- **31-Category Filter**: Full coverage of official Project Zomboid tags (Build 42, Build 41, Weapons, Vehicles, Clothing/Armor, Maps, QOL, Framework, Multiplayer, etc.).
- **Live Steam Integration**: Real-time subscription list, update notifications, download progress, item descriptions, author credits, and changelogs.
- **Direct Management**: One-click subscribe, unsubscribe, open item in Steam client, or reveal local workshop content on disk.

---

### 04. Workbench (Mod Authoring Studio)
Dedicated environment for mod creators with atomic writing and strict path guards:

| Tool | Capabilities |
|---|---|
| **Scaffold** | Bootstraps clean mod structures: `mod.info` per build, chosen `media` subdirectories, starter Lua entry points, `craftRecipe` blocks, `PZAPI.ModOptions` templates, translations, and generated placeholder `poster.png`. Supports B41, B42, and multi-version layouts. |
| **mod.info Editor** | Dual visual field editor and raw text editor with live synchronisation, validation, and rolling `.bak` backups (`Ctrl+S`). |
| **Static Validator** | 38+ static checks across `mod.info`, Lua scripts, items/crafting recipes, and translation files. Features a real Lua lexer (ignoring false positives in strings and comments) and checks B41 Lua tables vs. B42 JSON formats. |
| **Pack & Shove** | Prepares `Contents/mods/<ModId>` + `workshop.txt` + `preview.png` staging for the in-game uploader or builds clean `.zip` archives. "Shove" supports batch processing multiple mods simultaneously. |

---

### 07. Tools (FBX Forge, RAM Optimizer & Notepad++)
Utility suite for 3D modeling, game performance, and code editing:

1. **FBX Forge (3D Converter)**:
   - Hand-rolled zero-dependency 3D geometry engine. Converts models into binary (7.4/7.5) or ASCII `.fbx`.
   - **DirectX `.x` Support**: Full support for Project Zomboid's native model format (both text and binary token streams, hierarchical `Frame` transforms baked, left-handed Z-axis correction).
   - **Supported Formats**: `.x`, `.obj`, `.stl` (welded), `.ply`, `.dae`, `.gltf`, `.glb`, plus optional fallback to `assimp` CLI for 40+ additional formats.
2. **RAM & JVM Options Optimizer**:
   - Analyzes system RAM and provides calculated Java Virtual Machine heap allocation parameters (`-Xms`, `-Xmx`) tailored for Project Zomboid B41 (32/64-bit) and B42 64-bit JVM runtimes.
3. **Notepad++ Syntax Bridge**:
   - Automatically installs custom User Defined Languages (UDL) into Notepad++:
     - `PZ Script`: syntax highlighting for `module`, `item`, `craftRecipe`, `vehicle`, and property blocks.
     - `PZ ModInfo`: highlighting for `mod.info` keys, comments, and build overlays.

---

### 09. Ledger (Crash & Log Analyzer)
Read-only analysis tool for `console.txt` and `Zomboid\Logs\*_DebugLog.txt`:

- **Stack Trace Folding**: Consolidates multi-line Java exceptions and Lua errors into single expandable entries.
- **Severity Elevation**: Recognizes Build 42 Lua runtime failures logged at `LOG` level and elevates them to real errors.
- **Mod Attribution**: Traces exceptions back to the exact offending mod via stack paths, mod ID tags, or log manifests.
- **Binary Asset Safety**: Renders visual image previews for texture errors instead of flooding the screen with binary characters.

---

### Autonomous MCP Server (`pz-modding`)
PZ MANAGEMENT includes a built-in headless Model Context Protocol (MCP) server located in `mcp-server/`. It provides 6 JSON-RPC tools for AI assistants and automation scripts:

| Tool | Purpose |
|---|---|
| `pz_decompile_class` | Decompiles and inspects Java classes directly from `projectzomboid.jar` using CFR. |
| `pz_lookup_event` | Queries the canonical registry of 232 official LuaEventManager events. |
| `pz_validate_item_script` | Validates Build 42 item, weapon, and crafting scripts (`base:` namespaces, braces). |
| `pz_validate_sandbox_options` | Validates `sandbox-options.txt` syntax (including the mandatory B42 `VERSION = 1,` rule). |
| `pz_audit_hygiene` | Scans mods for UTF-8 BOM, non-ASCII characters outside `Translate/RU/`, and outdated `versionMax`. |
| `pz_sync_port_mod` | Deploys adapted mods to `Zomboid/mods` while strictly enforcing `*_Port` isolation rules. |

---

## Write Model & Safety Architecture

PZ MANAGEMENT implements a strict multi-tier security and file-access model:

| Location | Read | Write | Notes |
|---|---|---|---|
| `Zomboid\mods`, `Zomboid\Workshop` | Yes | **Yes** | User-owned writable mod directories. |
| Custom Sources (`settings.json`) | Yes | **Yes** | Explicitly declared user folders. |
| Client `default.txt` / Server `*.ini` | Yes | **Yes** | Opaque target IDs only; path verified by main process. |
| Steam Workshop (`steamapps\workshop\…`) | Yes | **No** | Read-only to prevent cache corruption. |
| Game Install (`ProjectZomboid\`) | Yes | **No** | Strictly READ-ONLY. |

- **Zero Runtime Dependencies**: The core application avoids bloated packages — binary FBX codecs, DirectX `.x` parsers, ZIP packaging, PNG headers, and CRC32 are hand-crafted inside `src/main/services/`.
- **Path Guard**: Every path from the renderer is sanitized against directory traversal (`..`) and validated against allowed roots.
- **Atomicity**: Configuration and metadata writes use temporary files and atomic renames to prevent partial file corruption.

---

## Roadmap

| Module | Purpose | Status |
|---|---|---|
| **01 Explorer** | Mod inventory, file tree, 3D viewport, global grep | ✅ Live |
| **02 Loadout** | Load order editor, dependency sorting, profiles | ✅ Live |
| **03 Workshop Overview** | Steam Workshop integration, subscriptions, tags | ✅ Live |
| **04 Workbench** | Mod scaffolding, mod.info editor, validator, packager | ✅ Live |
| 05 Triage | Conflict detection & automated health checks | 🔒 Planned |
| 06 Cartograph | Map coordinate grid & cell collision manager | 🔒 Planned |
| **07 Tools** | FBX Forge 3D converter, RAM optimizer, Notepad++ bridge | ✅ Live |
| 08 Outpost | Server manager & collection synchronizer | 🔒 Planned |
| **09 Ledger** | Crash logs, console viewer, mod attribution | ✅ Live |

---

## Technology Stack

| Component | Technology | Version |
|---|---|---|
| Framework | Electron | 43.4.1 |
| Build Tool | electron-vite | 5.0.0 / Vite 7.3.6 |
| Frontend | React | 19.2.8 |
| Language | TypeScript | 7.0.2 *(native preview)* |
| Workshop API | steamworks.js | 0.4.0 |
| Protocol | `pzfile://` | Custom privileged scheme |

---

## Getting Started

### Prerequisites
- **Windows 10 / 11** (64-bit)
- **Node.js 22.12+** (required by Electron 43)
- Project Zomboid installed (Steam or GOG)

### Quick Start
```bash
git clone https://github.com/tamerel/tamerelPZ.git
cd tamerelPZ
npm install
npm run dev
```

Alternatively, run **`start.bat`** on Windows — it verifies the Node.js version, installs dependencies if missing, cleans up environment variables, and launches the development environment with hot reload.

### Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Starts Vite dev server with renderer HMR and main process rebuild. |
| `npm run build` | Compiles production bundle to `out/`. |
| `npm start` | Launches Electron against the compiled production build. |
| `npm run typecheck` | Strict TypeScript typecheck across both node and web workspaces. |

---

## Hotkeys

| Shortcut | Action |
|---|---|
| `Esc` | Return to Hub / Close modals |
| `Ctrl+F` | Focus search bar |
| `F5` / `Ctrl+R` | Rescan drives / Refresh active logs |
| `Ctrl+S` | Save active file (`mod.info` or load order) |
| `Ctrl+Shift+E` | Reveal selected item in Windows Explorer |
| `Alt+↑` / `Alt+↓` | Move selected mod up / down in load order |
| `Del` | Remove selected mod from load order |
| `F12` | Toggle Developer Tools |

---

## License & Disclaimer

**Author**: Tamerel  
**License**: [MIT](file:///E:/PZ%20Management/LICENSE)

*Project Zomboid is a registered trademark of The Indie Stone. PZ MANAGEMENT is an independent, unofficial community tool and is not affiliated with, endorsed by, or associated with The Indie Stone.*
