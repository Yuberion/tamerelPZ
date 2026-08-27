# PZ MODDING KNOWLEDGE BASE

Reference for developing and improving **PZ Management**. Combines verified facts
about Project Zomboid modding (community wiki, forums, official blog) with how
each concept is implemented in this codebase. When extending PZM, start here.

Sources legend:
- **[code]** — behaviour already implemented/verified in this repository (most reliable).
- **[wiki]** — https://pzwiki.net/wiki/Mod_structure , `Mod.info`, `Translation`,
  `Load_order`, `Getting_started_with_modding`, `Build_42`.
- **[forum]** — theindiestone.com forums; **[blog]** — projectzomboid.com blog;
- **[guide]** — FWolfe/Zomboid-Modding-Guide (GitHub).

---

## 1. Game & builds

| Build | Status | Relevance |
|---|---|---|
| Build 41 (41.78) | Stable, still played | Root-level mod layout (`media/` at mod root) |
| Build 42 (42.x, "Unstable" → public branch since Dec 2024; MP arrived in 42.13) | Current development focus | Versioned layout (`common/`, `42/`, `41/` sub-folders), JSON translations, crafting overhaul [blog] |

B42 highlights for modders [blog][wiki]: crafting system overhaul (recipes
searchable by input/output, selectable ingredients), animals, basements,
WorldGen hooks, new animation system work. Mods can support **both builds from
one folder** by mixing layouts (see §3).

Steam AppID: **108600**. User directory: `%USERPROFILE%\Zomboid`.

---

## 2. Directory map

```
<steam>\steamapps\common\ProjectZomboid\      game install (read-only for mods)
    media\                                    vanilla media (lua/, scripts/, ...)
    ModTemplate\                              official mod template incl. workshop.txt form [code]
<steam>\steamapps\workshop\content\108600\<itemId>\   subscribed Workshop mods
%USERPROFILE%\Zomboid\
    mods\                                     local mods ("local" source)
    Workshop\<Project>\Contents\mods\<Mod>\   local Workshop *projects* ("project" source)
    Server\<config>.ini                       dedicated server configs (Mods=, WorkshopItems=)
    Lua\, Saves\, Maps\, logs (console.txt)   runtime state
```

Source kinds scanned by PZM [code]: `local`, `workshop`, `game`
(`ProjectZomboid\mods`, `media\mods`), `project` (`Zomboid\Workshop\…`),
`custom`. See `src/main/services/paths.ts`.

---

## 3. Mod container layouts

### Build 41 layout

```
MyMod\
  mod.info          <- required, parsed by B41
  poster.png        512x256 recommended
  media\
    lua\{shared,client,server}\
    scripts\*.txt
    ...
```

### Build 42 layout

```
MyMod\
  common\           <- shared assets (large files: models/textures/animations) [wiki]
    media\...
    mod.info        <- canonical metadata for B42
  42\               <- B42-only override (optional; may be 42.20 style)
    media\...
  41\               <- B41-only override (optional)
    media\...
```

Rules [code][wiki][forum]:
- B42 **ignores a root-only `mod.info`** — each version folder carries its own.
- Folder names matched by `/^(?:common|4[0-9](?:\.\d+)*)$/i` [code] (`VERSION_DIR_RE`
  in pack.ts, same regex in authoring.ts).
- Weight order when picking canonical info: highest major version wins, `common`=1 [code].
- Mixing B41+B42 in one mod is supported: `common/` + `41/` (+ optional `42/`) [wiki].

### Workshop project layout (what the in-game uploader stages/reads)

```
<Project>\
  workshop.txt      <- Workshop item metadata (§5)
  preview.png       <- thumbnail shown in Workshop search
  Contents\
    mods\
      MyMod\        <- the actual mod folder (either build layout above)
```

Implemented in `src/main/services/pack.ts` (`packWorkshop`) and `authoring.ts`
(`scaffoldMod` creates the wrapper when target kind is `project`).

---

## 4. `mod.info` format

Parser contract [code]: `src/main/services/modinfo.ts`.

Syntax:
- `key=value`, one pair per line; **keys are case-insensitive** (lowercased on parse).
- Comments: line starts with `#`, `//`, or `;`.
- **Repeated keys are legal and meaningful**: `description=` lines are concatenated
  by the loader (multi-language blurbs are correct usage!); `poster`, `require`,
  `pack`, `tiledef` are list keys [code — validator fix in commit `1ba2a6f`].
- Only `name` and `id` are truly single-valued [code].
- Values are single-line: embedded `\r\n` collapse to spaces on serialise [code].

Keys:

| Key | Meaning |
|---|---|
| `name` | display name in mod list |
| `id` | unique mod identity; other mods point at it via `require=`; recorded in saves |
| `id=<workshopId>/<ModId>` | B42 workshop form; normalise by stripping digits+slash [code `normaliseModId`] |
| `description` | blurb; repeatable, loader concatenates |
| `poster` / `icon` | artwork paths relative to mod folder; poster repeatable, check every entry |
| `require=` / `requires=` | hard dependencies; comma/semicolon separated; repeatable |
| `tags=` / `category=` | free text labels, `;` separated |
| `modversion=` / `version=` | author's own version string (game never compares) |
| `pzversion=` / `versionmin=` | game build the mod targets (warning purposes) |
| `url=` | link (Workshop page/forum/repo) |
| `pack=` | texture pack declaration (classification signal) |
| `tiledef=` | custom tile definitions (classification signal) |
| `excludeTranslations` | known extra key [code KNOWN_INFO_KEYS in validate.ts] |

Full known-key sets live in `authoring.ts` (`KNOWN_KEYS`, `FIELD_ORDER`) and
`validate.ts` (`KNOWN_INFO_KEYS`). Keep them in sync when adding fields.

---

## 5. `workshop.txt`

Written/read verbatim by the in-game uploader [code `workshopTxt` in authoring.ts]:

```
version=1
id=<existing item id or blank for new>
title=<item title>
description=<line>            <- one line per source line; reader concatenates with \n
tags=Build 42;Items           <- semicolon separated
visibility=public             <- EXACT tokens: public | friendsOnly | private | unlisted
```

- Unknown keys make the uploader fall back to defaults silently [code comment].
- Visibility token mismatch does not error — item publishes with default visibility
  (mapped to Steam API: public 0, friendsOnly 1, private 2, unlisted 3) [code types.ts].

---

## 6. `media/` tree reference

| Path | Purpose |
|---|---|
| `media/lua/shared/` | loaded first, both sides (definitions, NPCs/traits, sandbox presets) |
| `media/lua/client/` | UI, context menus, timed actions; loaded after shared |
| `media/lua/server/` | server-side logic (spawning, farming, weather); loaded at game start only |
| `media/scripts/*.txt` | item/recipe/sound/vehicle scripts (§7) |
| `media/scripts/vehicles/` | canonical vehicle layout [code classifier weight 110] |
| `media/models_X/`, `animations_X/` | B41 model/anim data (`_X` suffix) |
| `media/anims_X/`, `AnimSets`, `AnimScript` | animation assets |
| `media/textures/` | item icons etc. (`Icon = Name` resolves here, case-insensitive on Win) |
| `media/texturepacks/`, `tiles/`, `tiledefinitions/`, `heightmaps/`, `binmap/` | tile/map art assets |
| `media/maps/<MapName>/` | custom maps (spawnmap, lot files, cells) |
| `media/clothing/` | clothing models/textures |
| `media/sound/`, `sound/music/` | audio + `media/scripts/sounds` declarations |
| `media/ui/` | UI textures (nearly universal — weak classification signal) [code] |
| `media/fonts/` | fonts |
| `media/lua/shared/Translate/<LANG>/` | translation files (§8) |

**Case sensitivity**: the Linux dedicated server requires lowercase `media/`;
`Media/` loads nothing there. PZM flags miscased folders [validate.ts `miscasedMedia`].

---

## 7. Scripts (items, recipes, sounds, vehicles)

Format: plain-text object scripts inside `module X { ... }` blocks. Scaffold
example generated by PZM [code authoring.ts]:

```
module Base
{
    item MyMod_Example
    {
        DisplayCategory = Material,
        Type            = Normal,     -- Normal | Weapon | Food | Clothing | Container | Drainable | ...
        DisplayName     = My Example,
        Icon            = MyMod_Example,   -- resolves to media/textures/MyMod_Example.png
        Weight          = 0.3,
    }
}
```

- Later definitions of the same item name override earlier ones (load-order dependent).
- Recipes: `recipe ... { Inputs / Outputs / ... }` — B42 reworked crafting
  (searchable recipes, selectable ingredients) [blog 42.20 overview].
- Sound definitions live in scripts too (`sound ... { ... }`), referencing ogg files.
- PZM classifies content by script names/folders with weighted scoring [detect.ts];
  category thresholds: score ≥30 kept, top 3, else `misc`.

---

## 8. Translations

Layout: `Translate/<LANG>/<Table>.txt|json` under `media/lua/shared/` (or per-build).

- **B41**: Lua-table format; file `ItemName_EN.txt` must define table named
  `ItemName_EN` — **table name suffix must match the language folder** [code validator].
  Common tables: ItemName, Recipes, UI, ContextMenu, Tooltip, Sandbox [wiki Translation].
- **B42**: flat JSON object keyed `"<Module>.<Key>"`, e.g. `ItemName.json`
  containing `{ "Base.MyMod_Example": "My Example" }`; table name carried by
  file name [code authoring.ts writeExamples].
- A mod supporting both builds ships both formats in their respective build
  folders; validators must check each file against the format its extension
  implies [code validate.ts translate collection accepts .txt AND .json].

---

## 9. Lua modding essentials [guide][wiki]

Engine: modified **Kahlua** (Lua interpreter written in Java).
- No `io.*` / `os.*` modules; Java classes selectively exposed; returns are often
  **Java collections** — iterate with `:size()`/`:get(i)` (0-based!), `ipairs`/`#` do NOT work on them.
- Lua tables are 1-based; globals everywhere unless `local`.

Event system:
```lua
local function onGameStart() ... end
Events.OnGameStart.Add(onGameStart)     -- pass function REFERENCE, never call it
-- Events.OnGameStart.Remove(onGameStart)
triggerEvent("SomeEvent", ...)          -- fire from Lua
LuaEventManager.AddEvent("Custom")      -- declare a custom event
```
Frequent events: `OnGameStart`, `OnNewGame`, `OnGameBoot` (good for delayed
patches), `OnInitGlobalModData` (server init), `OnPlayerUpdate` (hot path —
optimise callbacks), `OnEquipPrimary`, `OnFillContainer`. Full list: pzwiki
"Lua event" page. Client/server split matters: many events fire on one side only.

Overwrite etiquette (compatibility):
1. Overwrite the smallest surface possible — redefine one function instead of
   copying whole vanilla files.
2. Save original and call it when your condition doesn't apply:
   ```lua
   local orig = ISToolTipInv.render
   function ISToolTipInv:render()
       if not CONDITION then return orig(self) end
       ...
   end
   ```
3. Mod Lua files load **alphabetically within each folder**, after vanilla.
   Patch another mod by naming files later alphabetically or delaying via
   `Events.OnGameBoot.Add(...)`.
4. To replace an already-registered callback you must `Remove` then `Add`.

---

## 10. Load order & conflicts [wiki Load_order]

- Enable order is stored in save/profiles (`mods.txt` under Zomboid); dedicated
  servers use `Mods=` + `WorkshopItems=` lines in `<Zomboid>\Server\<cfg>.ini`
  (Workshop ids there, `Mods=` gets mod ids; non-Steam servers need mods copied locally).
- Script collisions resolve by definition order; Lua by alphabetical file load;
  textures/UI by identical paths overwriting.
- Duplicate `id=` across installed mods breaks enablement/saves — PZM reports
  these [scanner.ts issues.duplicateIds]; unresolved `require=` likewise.

---

## 11. Tooling ecosystem

Official / first-party:
- **In-game Workshop uploader** (Main Menu → Workshop) — consumes the §5 layout.
- **TileZed / WorldEd** — official mapping tools (world editor, tile sheets).
- **`ProjectZomboid\ModTemplate`** — official template incl. workshop.txt form.

Community:
- **Unjammer WorldEd fork** (github.com/Unjammer/WorldEd) — standalone fork,
  dark themes, biomemap generator, InGameMap routes/buildings, thumbnails to
  8192px, **B42 features: basements, animals, WorldGen**.
- **CartoZed** (maps), **LootZed** (loot distributions), **WordZed**;
  ItemZed/TranslationZed exist but marked *Outdated* on pzwiki (pre-B42 formats).
- **VS Code** + Lua language server; remote debugging possible (pzwiki "Remote debugging").
- **Blender** + export pipelines for models/animations.
- **Community Project Zomboid modding template** (GitHub, linked from pzwiki Mod structure).
- **Java decompiling** (JD-GUI) — the practical way to discover API internals [guide].

References:
- pzwiki.net: `Modding`, `Getting_started_with_modding`, `Mod_structure`,
  `Mod.info`, `Scripts`, `Item_(scripts)`, `Translation`, `Lua_event`,
  `Load_order`, `File_formats`, `Build_42`, release pages (42.x changelogs with FAO-modders notes).
- theindiestone.com forums (Tutorials & Resources board).
- Official blog feature overviews (e.g. Build 42.20).

---

## 12. Pitfalls checklist (drives PZM validation)

Already covered by PZM validator [validate.ts]: missing/no-id `mod.info`,
duplicate keys that lose data (`name`/`id`), posters declared but absent,
unbalanced Lua brackets/comments, dead `require=` ids (needs known ids),
empty directories, miscased `Media/`, non-ASCII filenames (breaks Steam upload),
translation format mismatches per build, oversized scans (caps: 4k files /
512KB per file / depth 24, report truncated).

Not yet covered (candidates):
- B41 translation table-name ≠ folder language (parser-level check exists as
  prose in help texts; could become a `wbrule`).
- `Icon=` referencing a texture missing from `media/textures/` (textures set is
  already collected — cheap win).
- Known-event-name lint for `Events.<Name>.Add(` (whitelist from pzwiki Lua events).
- `module X` block balance in scripts (scripts currently checked as raw text).
- B42-only: root `mod.info` present while version folders also carry one
  (root copy ignored by B42 — informational finding).

---

## 13. Domain-informed roadmap notes (for sealed modules)

| Module | Domain grounding |
|---|---|
| **Loadout** | Profiles = ordered enable lists; generate `mods.txt` / edit `Mods=` in `%Zomboid%\Server\*.ini`; conflict preview via §10 rules |
| **Signal** | Workshop sync = steamcmd `+workshop_download_item 108600 <id>` or reading `libraryfolders.vdf` caches; diff local vs subscribed |
| **Triage** | Conflict doctor: intersect script item names across enabled mods (definition-order winners), duplicate Lua global overwrites (grep `function X:` across mods), texture path collisions |
| **Cartograph** | Parse `media/maps/*/spawnmap.lua`, `*.lot`/cell bin, `tiledefinitions.text`; preview via tileset PNGs; integrate with tiledef= declared in mod.info |
| **Tools** | *Live.* FBX forge writes FBX 7.4 (binary + ASCII) with no SDK: readers for OBJ/STL/PLY/`.x` (text + binary)/Collada/glTF, textures as embedded quads, anything else as a metadata capsule. Notepad++ bridge installs UDLs for `media/scripts/*.txt` and `mod.info` into `userDefineLangs`. Remaining work: compressed `.x` (MSZIP framing), ASCII→binary FBX, skeleton/animation tracks |
| **Outpost** | servertest.ini editor: `Mods=`, `WorkshopItems=`, map=, plus per-mod config conventions |
| **Ledger** | Settings UI for `disabledSources`/`customSources`/overrides (already honoured by scanner, no UI yet — see README limitations) |

---

*Last reviewed: 2026-08-25 against repo state `aee6574`.*
