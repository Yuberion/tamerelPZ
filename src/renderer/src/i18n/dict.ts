/**
 * Translation dictionaries.
 *
 * `EN` is the source of truth: `TKey` is derived from it, and `RU` is typed as
 * `Record<TKey, string>`, so a missing or misspelled Russian key is a compile error
 * rather than a silent English fallback at runtime.
 *
 * Module codenames (Stalker, Loadout, Signal, ...) are deliberately NOT translated —
 * they are product identifiers, like the "PZ MANAGEMENT" wordmark. Their taglines and
 * descriptions are.
 */

export type Lang = 'en' | 'ru'

export const EN = {
  // ---- language switch ----------------------------------------------------
  'lang.toRu': 'Switch interface to Russian',
  'lang.toEn': 'Switch interface to English',

  // ---- title bar ----------------------------------------------------------
  'title.backToHub': 'Back to hub',
  'title.minimise': 'Minimise',
  'title.restore': 'Restore',
  'title.maximise': 'Maximise',
  'title.close': 'Close',

  // ---- hub ----------------------------------------------------------------
  'hub.eyebrow': 'Project Zomboid · management suite',
  'hub.lede': 'Nine modules. One drive. Everything you installed, finally accounted for.',
  'hub.status': 'Site status',
  'hub.build': 'Build',
  'hub.modsFound': 'Mods found',
  'hub.local': 'Local',
  'hub.workshop': 'Workshop',
  'hub.duplicateIds': 'Duplicate ids',
  'hub.brokenRequires': 'Broken requires',
  'hub.scanning': 'Scanning',
  'hub.scanningShort': 'scanning',
  'hub.unknown': 'unknown',
  'hub.rescanDrive': 'Rescan drive',
  'hub.online': 'Online',
  'hub.sealed': 'Sealed',
  'hub.sealedToast': '{name} is sealed in this build',
  'hub.noGameDir': 'game directory not found',
  'hub.noUserDir': 'user directory not found',

  // ---- module taglines / descriptions -------------------------------------
  'module.stalker.tagline': 'Mod explorer',
  'module.stalker.desc':
    'Walk every mod on the drive. Structure, metadata, artwork and files — straight to Explorer.',
  'module.loadout.tagline': 'Load order & profiles',
  'module.loadout.desc':
    'Order mods, build named profiles and push them into the game config.',
  'module.signal.tagline': 'Workshop sync',
  'module.signal.desc':
    'Track Workshop updates, spot stale downloads and re-subscribe broken items.',
  'module.workbench.tagline': 'Authoring tools',
  'module.workbench.desc':
    'Scaffold mods, edit mod.info, validate scripts and pack builds for upload.',
  'module.triage.tagline': 'Conflict doctor',
  'module.triage.desc':
    'Duplicate ids, missing requirements, overwritten scripts and item collisions.',
  'module.cartograph.tagline': 'Map manager',
  'module.cartograph.desc':
    'Map cell overlaps, spawn regions and the map load order that actually works.',
  'module.bunker.tagline': 'Backups & vault',
  'module.bunker.desc': 'Snapshot mods and saves before an update wipes a 300 hour run.',
  'module.outpost.tagline': 'Server & collections',
  'module.outpost.desc':
    'Generate server ini mod lines, Workshop id lists and shareable collections.',
  'module.ledger.tagline': 'Logs & settings',
  'module.ledger.desc': 'Crash logs, console noise, lua errors and the suite configuration.',

  // ---- toolbar ------------------------------------------------------------
  'tb.backToHub': 'Back to hub (Esc)',
  'tb.hub': 'Hub',
  'tb.sourceMissing': '{label}: not found on this machine',
  'tb.hideSource': 'Hide {label}',
  'tb.showOnlySource': 'Show only {label}',
  'tb.openContainer': 'Open container folder',
  'tb.rescanTitle': 'Rescan drive (F5)',
  'tb.scanning': 'Scanning',
  'tb.rescan': 'Rescan',
  'tb.searchPlaceholder': 'Search name, id, author, workshop id…',
  'tb.group': 'Group',
  'tb.sort': 'Sort',
  'tb.groupType': 'Type',
  'tb.groupSource': 'Source',
  'tb.groupBuild': 'Build',
  'tb.groupFlat': 'Flat',
  'tb.sortNameAsc': 'Name A→Z',
  'tb.sortNameDesc': 'Name Z→A',
  'tb.sortType': 'Type',
  'tb.sortRecent': 'Newest',
  'tb.sortId': 'Mod id',
  'tb.sortSource': 'Source',
  'tb.filters': 'Filters',
  'tb.legendType': 'Type',
  'tb.legendBuild': 'Build',
  'tb.legendIssues': 'Issues',
  'tb.duplicateIds': 'Duplicate ids',
  'tb.brokenRequires': 'Broken requires',
  'tb.noModInfo': 'No mod.info',
  'tb.clear': 'Clear {n}',
  'tb.srcProjects': 'Projects',

  // ---- mods pane ----------------------------------------------------------
  'pane.mods': 'Mods',
  'pane.collapseGroups': 'Collapse all groups',
  'pane.expandGroups': 'Expand all groups',
  'list.nothingMatches': 'Nothing matches',
  'group.unknownBuild': 'Unknown build',

  // ---- context menus ------------------------------------------------------
  'menu.openFolder': 'Open folder',
  'menu.openFolderExplorer': 'Open folder in Explorer',
  'menu.reveal': 'Reveal in Explorer',
  'menu.openDefaultApp': 'Open with default app',
  'menu.openTerminal': 'Open terminal here',
  'menu.copyModId': 'Copy mod id',
  'menu.copyPath': 'Copy path',
  'menu.copyFullPath': 'Copy full path',
  'menu.copyName': 'Copy name',
  'menu.openWorkshop': 'Open Workshop page',
  'menu.hintDblClick': 'dbl-click',

  // ---- row glyph tooltips -------------------------------------------------
  'glyph.warnings': 'Has warnings',
  'glyph.unresolved': 'Unresolved requires',
  'glyph.duplicate': 'Duplicate mod id',

  // ---- toasts -------------------------------------------------------------
  'toast.pathCopied': 'Path copied',
  'toast.nameCopied': 'Name copied',
  'toast.modIdCopied': 'Mod id copied',
  'toast.copiedValue': 'Copied {value}',
  'toast.loadedFolders': 'Loaded {n} {folders}',
  'toast.jumpedTo': 'Jumped to {name}',

  // ---- skeleton pane ------------------------------------------------------
  'sk.pickMod': 'Pick a mod',
  'sk.skeletonHere': 'Its skeleton opens here',
  'sk.filterFiles': 'filter files',
  'sk.loadFullTree': 'Load full tree (depth {n})',
  'sk.collapseAll': 'Collapse all',
  'sk.openModFolder': 'Open mod folder in Explorer',
  'sk.noFilesMatch': 'No files match',
  'sk.emptyFolder': 'Empty mod folder',

  // ---- info panel ---------------------------------------------------------
  'ip.tabMod': 'Mod',
  'ip.tabFile': 'File',
  'ip.reveal': 'Reveal in Explorer',
  'ip.noModSelected': 'No mod selected',
  'ip.noPoster': 'No poster',
  'ip.duplicateTitle': 'Duplicate mod id.',
  'ip.duplicateBody': '{copies} of {id} installed — the game loads only one.',
  'ip.identity': 'Identity',
  'ip.modId': 'Mod id',
  'ip.rawId': 'Raw id',
  'ip.folder': 'Folder',
  'ip.author': 'Author',
  'ip.version': 'Version',
  'ip.builds': 'Builds',
  'ip.unknown': 'unknown',
  'ip.pzVersion': 'PZ version',
  'ip.source': 'Source',
  'ip.workshop': 'Workshop',
  'ip.url': 'Url',
  'ip.modified': 'Modified',
  'ip.openWorkshopPage': 'Open Workshop page',
  'ip.openLink': 'Open link',
  'ip.onDisk': 'On disk',
  'ip.path': 'Path',
  'ip.openFolder': 'Open folder',
  'ip.revealModInfo': 'Reveal mod.info',
  'ip.files': 'Files',
  'ip.folders': 'Folders',
  'ip.size': 'Size',
  'ip.buildFolders': 'Build folders',
  'ip.openTarget': 'Open {path}',
  'ip.dependencies': 'Dependencies',
  'ip.requires': 'Requires',
  'ip.requiredBy': 'Required by {n}',
  'ip.depMissing': 'missing',
  'ip.tags': 'Tags',
  'ip.media': 'Media ({n})',
  'ip.selectFile': 'Select a file in the skeleton',
  'ip.explorer': 'Explorer',
  'ip.open': 'Open',
  'ip.pathShort': 'Path',
  'ip.file': 'File',
  'ip.type': 'Type',
  'ip.typeFolder': 'Folder',
  'ip.typeFile': 'file',
  'ip.entries': 'Entries',
  'ip.preview': 'Preview',
  'ip.truncated': 'truncated',
  'ip.binaryFile': 'Binary file',
  'ip.copy': 'Copy',

  // ---- scanner warnings (codes emitted by the main process) ---------------
  'warn.noModInfo': 'No readable mod.info — the game may ignore this folder',
  'warn.noId': 'mod.info has no `id=` — dependencies cannot resolve this mod',
  'warn.posterMissing': 'Declared poster file is missing on disk',

  // ---- scan progress phases ----------------------------------------------
  'progress.sources': 'Locating mod containers',
  'progress.enumerate': 'Enumerating mod folders',
  'progress.analyze': 'Reading mod metadata',
  'progress.done': 'Scan complete',

  // ---- categories ---------------------------------------------------------
  'cat.map': 'Maps',
  'cat.vehicle': 'Vehicles',
  'cat.weapon': 'Weapons',
  'cat.clothing': 'Clothing',
  'cat.item': 'Items',
  'cat.build': 'Crafting',
  'cat.translation': 'Translations',
  'cat.library': 'Libraries',
  'cat.ui': 'Interface',
  'cat.texture': 'Textures & Tiles',
  'cat.sound': 'Audio',
  'cat.model': 'Models & Anims',
  'cat.balance': 'Balance',
  'cat.server': 'Server',
  'cat.misc': 'Unclassified',

  // ---- source kinds -------------------------------------------------------
  'src.local': 'Local',
  'src.workshop': 'Workshop',
  'src.game': 'Game',
  'src.project': 'Project',
  'src.custom': 'Custom',

  // ---- built-in source labels (ModSource.labelKey) ------------------------
  'srcLabel.local': 'Local mods',
  'srcLabel.workshop': 'Workshop',
  'srcLabel.gameMods': 'Game mods',
  'srcLabel.gameMediaMods': 'Game media mods',
  'srcLabel.workshopProjects': 'Workshop projects',

  // ---- status bar ---------------------------------------------------------
  'sb.scan': 'scan {d}',
  'sb.cached': '({n} cached)',
  'sb.withoutInfo': '{n} without mod.info',

  // ---- units --------------------------------------------------------------
  'unit.ms': 'ms',
  'unit.s': 's',
  'bytes.B': 'B',
  'bytes.KB': 'KB',
  'bytes.MB': 'MB',
  'bytes.GB': 'GB',
  'bytes.TB': 'TB',

  // =========================================================================
  // Inline help — the text behind every `?` badge.
  //
  // These are the only strings in the dictionary written as prose. A hint has to
  // answer three things: what the control does, what it writes, and what goes
  // wrong if it is left alone. Anything shorter belongs in a `*Hint` label.
  // =========================================================================

  'help.close': 'Close',
  'help.aria': 'What is “{name}”?',
  'help.toggleOn': 'Explain the interface (F1)',
  'help.toggleOff': 'Stop highlighting the help badges (F1)',
  'help.app':
    'Every ? badge explains one control: what it does and what it writes. This button lights all of them at once, so they are easy to find. The suite only reads your drive — the Workbench is the one module that writes, and only inside your local mods and Workshop project folders.',
  'help.hotkeys':
    'F1 help · Esc back to the hub · F5 rescan · Ctrl+F search · Ctrl+S save mod.info · Ctrl+Shift+E reveal in Explorer',

  // ---- hub ----------------------------------------------------------------
  'help.hub.status':
    'The result of the last drive scan: the detected game build, how many mods were found, and how many of them collide. Duplicate ids and broken requires are counted separately because they are the two faults that actually stop a mod from loading.',
  'help.hub.modules':
    'Nine modules, two of them finished. Stalker inspects what is already installed; Workbench creates, edits, checks and packs mods of your own. The sealed tiles are placeholders and open nothing.',

  // ---- stalker ------------------------------------------------------------
  'help.tb.sources':
    'One button per mod container found on this machine. Pressing one narrows the list to that source, pressing it again releases it, and several can be lit at once. The small folder button opens the container itself in Explorer.',
  'help.tb.rescan':
    'Re-reads every container from disk. Nothing here watches the filesystem, so do this after installing, deleting or editing mods outside the app.',
  'help.tb.search':
    'Matches the name, mod id, folder name, author and Workshop id. The letters only have to appear in order, so “blkops” finds “Black Ops”. Grouping is dropped while you search and results are ranked by how well they match.',
  'help.tb.group':
    'Splits the list into collapsible groups. Type uses the category guessed from the mod contents, Source the container it came from, Build the pzversion in its mod.info. Flat turns grouping off. The choice is remembered between sessions.',
  'help.tb.sort':
    'Order inside each group. Newest sorts by the folder timestamp, the closest thing to “recently updated” that exists on disk. Ignored while a search is active, where relevance wins.',
  'help.tb.filters':
    'Opens the second toolbar row: category chips, build chips and the three fault filters. They combine, so “Maps + B42 + duplicate ids” is one click each. The button stays lit while any filter is active.',
  'help.pane.mods':
    'Every mod that survives the current filters, counted as matched over total. The coloured letter on the left is the guessed category; the glyphs on the right mark warnings, requires that resolve to nothing, and ids installed more than once.',
  'help.pane.skeleton':
    'The selected mod exactly as it sits on disk, read two levels deep and then on demand. Click a folder to expand it, double-click to open it in Explorer, right-click for copy and terminal actions. The + button loads six levels in one go.',
  'help.pane.info':
    'Everything read out of mod.info, plus what was counted on disk: size, file and folder totals, and dependencies in both directions. The File tab describes whatever is selected in the middle pane and previews it when it is text.',

  // ---- workbench: shell ---------------------------------------------------
  'help.wb.tabs':
    'Four tools over one mod. Scaffold creates a new mod, mod.info edits its manifest, Validate reports the mistakes the game ignores in silence, Pack stages it for upload. The last three need a mod selected on the left.',
  'help.wb.mods':
    'Every mod on the machine, editable ones first. The count is how many can be written; the rest carry a padlock because they live in the game install or in subscribed Workshop content, where Steam reverts edits on its next validation.',
  'help.wb.search':
    'Filters the list by name, mod id and folder name, letters in order rather than exact substrings. Locked mods stay listed so they can still be read.',
  'help.wb.newMod':
    'Drops the current selection and opens the Scaffold tool with empty fields.',
  'help.wb.rescan':
    'Re-reads the drive. Use it when you have added or removed a mod folder outside the app and it is missing from the list.',

  // ---- workbench: scaffold ------------------------------------------------
  'help.wb.sc.panel':
    'Creates the folder, one mod.info per build layout and the media sub-trees you tick. It refuses to touch a folder that already exists, so nothing of yours can be overwritten from here.',
  'help.wb.sc.name':
    'The name shown in the in-game mod list and on the Workshop page. Free text: spaces, punctuation and capitals are all fine. It also seeds the folder name and the mod id until you edit those directly.',
  'help.wb.sc.author':
    'Written to author= and shown next to the mod. Cosmetic — nothing in the game resolves against it.',
  'help.wb.sc.folderName':
    'The folder created on disk. Keep it to letters, digits, dot, underscore and hyphen: this string ends up inside file paths, and a Linux server treats their case as significant.',
  'help.wb.sc.modId':
    'The identity other mods point at with require=, and what a save file records. It has to be unique on the machine, and changing it later breaks every mod that depends on you. Convention is to match the folder name.',
  'help.wb.sc.modVersion':
    'Your own version string, e.g. 1.0.0. The game never compares it — it exists so players and changelogs can.',
  'help.wb.sc.pzVersion':
    'The game build this mod is written for, e.g. 42.0.0. Project Zomboid uses it to warn players that a mod is out of date, so an honest value here prevents bug reports that are really version mismatches.',
  'help.wb.sc.description':
    'The blurb under the mod in the in-game list and the opening text of the Workshop page. One or two sentences on what actually changes are worth more than a feature list: for most players this is the only thing they read before enabling it. mod.info keeps it on a single line, so pasted line breaks collapse into spaces.',
  'help.wb.sc.url':
    'A link shown with the mod — the Workshop page, a forum thread or a repository. It has no effect on loading; it is how players find the source, report bugs and check for a newer version. Write the full address, https:// included.',
  'help.wb.sc.tags':
    'Free-text labels for browsing and filtering. The loader ignores them entirely. Separate them with a semicolon: Build 42;Items;Balance. Reusing labels players already search for beats inventing new ones.',
  'help.wb.sc.requires':
    'Mod ids this mod cannot run without, one per line. The game refuses to enable your mod until each one is present, so list hard dependencies only — a stale or misspelled id here reads to a player as a broken mod.',
  'help.wb.sc.destination':
    'Which container the new folder is created in. Only writable locations are offered, and a folder that does not exist yet is created.',
  'help.wb.sc.layout':
    'Where media/ goes. Build 42 expects common/media, Build 41 expects media at the mod root. Both writes common/ plus a 41/ override, which is how one folder supports two game versions.',
  'help.wb.sc.contents':
    'The empty sub-trees to create under media. None of them is mandatory — tick what you know you need, the rest is one folder away.',
  'help.wb.sc.examples':
    'Writes a working lua entry point, one example item and a translation stub, so the mod loads and does something visible on the first launch instead of nothing at all.',
  'help.wb.sc.poster':
    'Generates a 512×256 placeholder so poster= resolves from the first launch and the mod list shows a tile instead of a gap. Replace it with real artwork before publishing.',

  // ---- workbench: mod.info ------------------------------------------------
  'help.wb.info.panel':
    'mod.info is the manifest the game reads before anything else: it decides the name in the mod list, the id other mods depend on, and which build the mod claims to support. Nothing is written until Save.',
  'help.wb.info.mode':
    'Fields is a form over the keys this app models. Raw text is the file itself, saved verbatim, for keys the form does not know. Switching between them converts what you have in place, so neither direction loses an edit and neither touches the disk.',
  'help.wb.info.id':
    'Changing the id of a mod that is already out breaks every mod that requires it and every save that recorded the old one. Rename while the mod is still only yours.',
  'help.wb.info.poster':
    'Path to the image shown in the mod list, relative to the mod folder — usually poster.png, 512×256. A path pointing at nothing shows up as a warning in Validate.',
  'help.wb.info.icon':
    'Optional small icon, relative to the mod folder. The mod list falls back to the poster when this is empty.',
  'help.wb.info.extra':
    'Keys found in the file that this form does not model. They are written back exactly as they were, in the same order, so nothing is lost by editing here.',
  'help.wb.info.backup':
    'Copies the current file to mod.info.bak before writing. Cheap insurance — leave it on unless you version the mod folder yourself.',
  'help.wb.info.raw':
    'The file as text, saved character for character. Comment lines and unknown keys survive; the form fields are ignored while this tab is the one you save from.',

  // ---- workbench: validate ------------------------------------------------
  'help.wb.val.panel':
    'Static checks only: nothing is executed and nothing is modified. It reads mod.info, lua, scripts and translation files and reports what the game would quietly ignore — unbalanced blocks, missing textures, dead requires, folders in the wrong case.',
  'help.wb.val.severity':
    'Errors stop the mod or the file from loading. Warnings load but silently discard part of your work. Notes are hygiene. A static check cannot see runtime state, so it errs on the side of reporting.',

  // ---- workbench: pack ----------------------------------------------------
  'help.wb.pack.panel':
    'Copies the mod into the shape an upload expects. It never uploads anything itself — publishing still happens in the game, or by handing the archive to someone.',
  'help.wb.pack.mode':
    'Workshop project lays out Contents/mods/… with workshop.txt and preview.png, which is what the in-game uploader reads. Zip archive writes one file with the mod folder inside it, for manual distribution.',
  'help.wb.pack.builds':
    'Which build folders to copy. Everything takes both; a single-build option drops the folders the other build would use, which keeps an upload aimed at one game version clean.',
  'help.wb.pack.outputName':
    'Name of the project folder, or of the .zip, that gets written. Same character rules as a mod folder: letters, digits, dot, underscore, hyphen.',
  'help.wb.pack.outputDir':
    'Where the result is written. Left empty it goes to Workshop in your Zomboid user folder, which is where the in-game uploader looks for projects.',
  'help.wb.pack.meta':
    'The contents of workshop.txt. The in-game uploader reads this file to fill in the Workshop page, so these fields are the page — not a copy of mod.info.',
  'help.wb.pack.metaTitle':
    'The Workshop item title, which is free to differ from the mod name. Defaults to the mod name.',
  'help.wb.pack.metaTags':
    'Workshop tags, semicolon separated, e.g. Build 42;Items. Workshop only accepts labels it already knows, so invented ones are dropped during upload.',
  'help.wb.pack.metaVisibility':
    'Who can see the item once it is published. Private and Friends only are the safe way to rehearse an upload before it is public.',
  'help.wb.pack.metaId':
    'The id of an existing Workshop item to update. Leave it blank to publish a new one; a wrong id here points the update at the wrong item.',
  'help.wb.pack.metaDescription':
    'The body of the Workshop page. Plain text — unlike mod.info this one is not squeezed onto a single line.',
  'help.wb.pack.preview':
    'Copies the mod poster to preview.png, the thumbnail Workshop shows in search results. Without it the item appears with a blank image.',
  'help.wb.pack.exclude':
    'Extra patterns to leave out, one per line, with * as the only wildcard. Version control folders, editor state, backups and logs are dropped whether you list them or not.',

  // =========================================================================
  // Workbench (module 04) — authoring tools
  // =========================================================================

  // ---- shell / toolbar ----------------------------------------------------
  'wb.newMod': 'New mod',
  'wb.newModTitle': 'Scaffold a new mod',
  'wb.searchPlaceholder': 'Search mods you can edit…',
  'wb.tabScaffold': 'Scaffold',
  'wb.tabInfo': 'mod.info',
  'wb.tabValidate': 'Validate',
  'wb.tabPack': 'Pack',
  'wb.paneMods': 'Editable mods',
  'wb.noMods': 'No editable mods found',
  'wb.noModsHint': 'Scaffold one, or add a container in settings.json',
  'wb.pickMod': 'Pick a mod',
  'wb.pickModHint': 'Choose a mod on the left, or scaffold a new one',
  'wb.readOnly': 'Read-only location',
  'wb.readOnlyBody':
    'This mod lives outside {roots}. The game install and Steam Workshop content are never written to, because updates and Steam validation would revert the change.',
  'wb.writeRoots': 'your local mods and Workshop project folders',
  'wb.revealMod': 'Reveal mod folder',
  'wb.openMod': 'Open mod folder',
  'wb.busy': 'Working',
  'wb.sourceLocal': 'Local',
  'wb.sourceProject': 'Project',
  'wb.sourceCustom': 'Custom',
  'wb.locked': 'Locked',
  'wb.lockedTitle': 'Outside the write allowlist — read-only',

  // ---- scaffold -----------------------------------------------------------
  'wb.sc.title': 'Scaffold a mod',
  'wb.sc.lede':
    'Lays down a mod folder, a mod.info per build and the media sub-trees you tick. Never touches an existing folder.',
  'wb.sc.identity': 'Identity',
  'wb.sc.destination': 'Destination',
  'wb.sc.layout': 'Build layout',
  'wb.sc.contents': 'Contents',
  'wb.sc.folderName': 'Folder name',
  'wb.sc.folderHint': 'A-Z, 0-9, dot, underscore, hyphen',
  'wb.sc.modId': 'Mod id',
  'wb.sc.modIdHint': 'What other mods put in require=',
  'wb.sc.name': 'Display name',
  'wb.sc.author': 'Author',
  'wb.sc.description': 'Description',
  'wb.sc.modVersion': 'Mod version',
  'wb.sc.pzVersion': 'PZ version',
  'wb.sc.url': 'Url',
  'wb.sc.tags': 'Tags',
  'wb.sc.tagsHint': 'Semicolon separated',
  'wb.sc.requires': 'Requires',
  'wb.sc.requiresHint': 'One mod id per line',
  'wb.sc.layoutB41': 'Build 41',
  'wb.sc.layoutB41Hint': 'media/ at the mod root',
  'wb.sc.layoutB42': 'Build 42',
  'wb.sc.layoutB42Hint': 'common/media/',
  'wb.sc.layoutBoth': 'Both',
  'wb.sc.layoutBothHint': 'common/ plus a 41/ override',
  'wb.sc.folderLuaClient': 'lua/client',
  'wb.sc.folderLuaServer': 'lua/server',
  'wb.sc.folderLuaShared': 'lua/shared',
  'wb.sc.folderScripts': 'scripts',
  'wb.sc.folderTextures': 'textures',
  'wb.sc.folderSounds': 'sound',
  'wb.sc.folderModels': 'models_x',
  'wb.sc.folderTranslate': 'Translate/EN',
  'wb.sc.folderMaps': 'maps',
  'wb.sc.folderUi': 'ui',
  'wb.sc.examples': 'Write starter files',
  'wb.sc.examplesHint': 'A working lua entry point, an example item and a translation stub',
  'wb.sc.poster': 'Generate placeholder poster.png',
  'wb.sc.posterHint': '512×256, so poster= resolves from the first launch',
  'wb.sc.create': 'Create mod',
  'wb.sc.created': 'Created {name}',
  'wb.sc.createdFiles': '{n} {entries} written',
  'wb.sc.noTarget': 'No writable container found',
  'wb.sc.targetMissing': 'will be created',
  'wb.sc.willCreate': 'Creates',

  // ---- mod.info editor ----------------------------------------------------
  'wb.info.title': 'mod.info',
  'wb.info.form': 'Fields',
  'wb.info.raw': 'Raw text',
  'wb.info.save': 'Save',
  'wb.info.saveTitle': 'Write mod.info (Ctrl+S)',
  'wb.info.revert': 'Revert',
  'wb.info.revertTitle': 'Discard changes and reload from disk',
  'wb.info.saved': 'mod.info saved',
  'wb.info.savedBackup': 'mod.info saved · previous kept as mod.info.bak',
  'wb.info.dirty': 'Unsaved changes',
  'wb.info.missing': 'This mod has no mod.info',
  'wb.info.missingBody': 'Saving creates one at {file}.',
  'wb.info.backup': 'Keep a mod.info.bak',
  'wb.info.extra': 'Other keys',
  'wb.info.extraHint': 'Preserved exactly as written',
  'wb.info.rawHint': 'Saved verbatim. The form fields are ignored while this tab is open.',
  'wb.info.addRequire': 'Add require',
  'wb.info.addTag': 'Add tag',
  'wb.info.remove': 'Remove',
  'wb.info.file': 'File',

  // ---- validate -----------------------------------------------------------
  'wb.val.title': 'Validation',
  'wb.val.lede':
    'Static checks over mod.info, lua, scripts and translations. Warnings are evidence, not proof.',
  'wb.val.run': 'Run checks',
  'wb.val.rerun': 'Run again',
  'wb.val.running': 'Checking',
  'wb.val.clean': 'No problems found',
  'wb.val.cleanBody': '{files} {filesWord} checked in {duration}.',
  'wb.val.summary': '{files} {filesWord} · {bytes} · {duration}',
  'wb.val.errors': 'Errors',
  'wb.val.warnings': 'Warnings',
  'wb.val.infos': 'Notes',
  'wb.val.truncated': 'Scan limit reached — this report is incomplete',
  'wb.val.copyReport': 'Copy report',
  'wb.val.reportCopied': 'Report copied',
  'wb.val.modScope': 'Mod',
  'wb.val.line': 'line {n}',
  'wb.val.openFile': 'Reveal in Explorer',
  'wb.val.filterAll': 'All',
  'wb.val.neverRun': 'Not checked yet',
  'wb.val.neverRunBody': 'Run the checks to see what this mod would trip over.',

  // ---- validator rules ----------------------------------------------------
  'wbrule.modinfo.missing': 'No mod.info anywhere in the mod — the game will ignore this folder',
  'wbrule.modinfo.no-name': 'mod.info has no name= — the mod list will show the folder name',
  'wbrule.modinfo.no-id': 'mod.info has no id= — no other mod can require this one',
  'wbrule.modinfo.id-folder-mismatch': 'id= is {id} but the folder is {folder}',
  'wbrule.modinfo.duplicate-key': '{key}= appears {n} times — only the first is read',
  'wbrule.modinfo.no-description': 'No description= — the Workshop page will be blank',
  'wbrule.modinfo.no-pzversion': 'No pzversion= — the game cannot warn about build mismatches',
  'wbrule.modinfo.no-poster': 'No poster= — the mod list shows a blank tile',
  'wbrule.modinfo.poster-missing': 'poster= points at {file}, which is not on disk',
  'wbrule.modinfo.icon-missing': 'icon= points at {file}, which is not on disk',
  'wbrule.modinfo.require-missing': 'require={id} is not installed on this machine',
  'wbrule.modinfo.self-require': 'The mod requires its own id {id}',
  'wbrule.modinfo.unknown-key': 'Unknown key {key}= — the game ignores it',
  'wbrule.modinfo.bom': 'File starts with a byte order mark, which can break the first key',
  'wbrule.layout.no-media': 'No media/ folder — the game loads nothing from this mod',
  'wbrule.layout.media-case': '{dir} is not lowercase — a Linux server will not find it',
  'wbrule.layout.non-ascii-name': '{file} has non-ASCII characters in its name',
  'wbrule.layout.empty-dir': '{dir} is empty',
  'wbrule.lua.empty': 'File is empty',
  'wbrule.lua.unterminated-string': 'Unterminated string literal',
  'wbrule.lua.unterminated-comment': 'Unterminated long comment',
  'wbrule.lua.bracket-unbalanced': '{bracket} out of balance by {delta}',
  'wbrule.lua.block-unclosed': '{n} block(s) never closed with end',
  'wbrule.lua.block-extra-end': 'end without a matching block',
  'wbrule.script.brace-unbalanced': 'Braces out of balance by {delta}',
  'wbrule.script.no-module': 'No module block — the game reads nothing from this file',
  'wbrule.script.duplicate-item': '{name} is defined more than once',
  'wbrule.script.item-no-display-name': '{name} has no DisplayName',
  'wbrule.script.item-no-type': '{name} has no Type',
  'wbrule.script.icon-missing': '{name} wants {texture}, which is not in media/textures',
  'wbrule.script.unknown-block': 'Unrecognised block {block}',
  'wbrule.translate.unknown-language': '{dir} is not a language code the game knows',
  'wbrule.translate.brace-unbalanced': 'Braces out of balance by {delta}',
  'wbrule.translate.header-mismatch':
    'Table name ends in _{found} but the folder is {expected} — every entry is discarded',
  'wbrule.translate.empty': 'Translation file is empty',
  'wbrule.translate.json-invalid': 'Not valid JSON — the game loads no entry from this file',
  'wbrule.translate.json-not-object':
    'JSON translations must be one object of key/text pairs',
  'wbrule.translate.json-non-string':
    '{key} is not a text value ({n} in total) — those keys never resolve',

  // ---- pack ---------------------------------------------------------------
  'wb.pack.title': 'Pack for upload',
  'wb.pack.lede':
    'Stages the layout the in-game Workshop uploader expects, or writes one archive for manual distribution.',
  'wb.pack.mode': 'Output',
  'wb.pack.modeWorkshop': 'Workshop project',
  'wb.pack.modeWorkshopHint': 'Contents/mods/… plus workshop.txt and preview.png',
  'wb.pack.modeZip': 'Zip archive',
  'wb.pack.modeZipHint': 'One .zip, the mod folder inside it',
  'wb.pack.builds': 'Builds',
  'wb.pack.buildsAll': 'Everything',
  'wb.pack.buildsB41': 'Build 41 only',
  'wb.pack.buildsB42': 'Build 42 only',
  'wb.pack.buildsHint': 'Filters the common/ and 4x.x/ folders at the mod root',
  'wb.pack.outputName': 'Project name',
  'wb.pack.outputNameZip': 'Archive name',
  'wb.pack.outputDir': 'Output folder',
  'wb.pack.pickDir': 'Choose…',
  'wb.pack.resetDir': 'Use the default',
  'wb.pack.exclude': 'Also exclude',
  'wb.pack.excludeHint': 'One pattern per line. * is the only wildcard.',
  'wb.pack.excludeDefault': 'Version control, editor state, backups and logs are always skipped.',
  'wb.pack.meta': 'workshop.txt',
  'wb.pack.metaTitle': 'Title',
  'wb.pack.metaDescription': 'Description',
  'wb.pack.metaTags': 'Tags',
  'wb.pack.metaTagsHint': 'Semicolon separated, e.g. Build 42;Items',
  'wb.pack.metaVisibility': 'Visibility',
  'wb.pack.visPublic': 'Public',
  'wb.pack.visFriends': 'Friends only',
  'wb.pack.visPrivate': 'Private',
  'wb.pack.visUnlisted': 'Unlisted',
  'wb.pack.metaId': 'Workshop id',
  'wb.pack.metaIdHint': 'Leave blank to publish a new item',
  'wb.pack.preview': 'Copy the poster as preview.png',
  'wb.pack.run': 'Pack',
  'wb.pack.running': 'Packing',
  'wb.pack.result': 'Packed',
  'wb.pack.resultFiles': 'Files',
  'wb.pack.resultSize': 'Size',
  'wb.pack.resultWritten': 'Written',
  'wb.pack.resultSkipped': 'Skipped',
  'wb.pack.resultOutput': 'Output',
  'wb.pack.reveal': 'Reveal output',
  'wb.pack.destination': 'Destination',
  'wb.pack.noZomboid': 'Zomboid user folder not found — choose an output folder',
  'wb.pack.uploadHint':
    'Launch Project Zomboid and use Workshop → Create/Update to publish the staged project.',

  // ---- progress phases ----------------------------------------------------
  'wb.phase.collect': 'Collecting files',
  'wb.phase.read': 'Reading',
  'wb.phase.write': 'Writing',
  'wb.phase.done': 'Done'
} as const

export type TKey = keyof typeof EN

export const RU: Record<TKey, string> = {
  'lang.toRu': 'Переключить интерфейс на русский',
  'lang.toEn': 'Switch interface to English',

  'title.backToHub': 'На главную',
  'title.minimise': 'Свернуть',
  'title.restore': 'Восстановить',
  'title.maximise': 'Развернуть',
  'title.close': 'Закрыть',

  'hub.eyebrow': 'Project Zomboid · комплекс управления',
  'hub.lede': 'Девять модулей. Один диск. Всё установленное — наконец под учётом.',
  'hub.status': 'Состояние',
  'hub.build': 'Сборка',
  'hub.modsFound': 'Найдено модов',
  'hub.local': 'Локальные',
  'hub.workshop': 'Workshop',
  'hub.duplicateIds': 'Дубли id',
  'hub.brokenRequires': 'Битые зависимости',
  'hub.scanning': 'Сканирование',
  'hub.scanningShort': 'сканирую',
  'hub.unknown': 'неизвестно',
  'hub.rescanDrive': 'Пересканировать диск',
  'hub.online': 'В работе',
  'hub.sealed': 'Закрыт',
  'hub.sealedToast': '{name} закрыт в этой сборке',
  'hub.noGameDir': 'каталог игры не найден',
  'hub.noUserDir': 'каталог пользователя не найден',

  'module.stalker.tagline': 'Обозреватель модов',
  'module.stalker.desc':
    'Пройти по каждому моду на диске. Структура, метаданные, обложки и файлы — сразу в Проводник.',
  'module.loadout.tagline': 'Порядок загрузки и профили',
  'module.loadout.desc':
    'Упорядочить моды, собрать именованные профили и записать их в конфиг игры.',
  'module.signal.tagline': 'Синхронизация с Workshop',
  'module.signal.desc':
    'Отслеживать обновления Workshop, находить устаревшие загрузки и переподписывать битые items.',
  'module.workbench.tagline': 'Инструменты автора',
  'module.workbench.desc':
    'Создать каркас мода, править mod.info, проверять скрипты и упаковывать сборки для загрузки.',
  'module.triage.tagline': 'Диагностика конфликтов',
  'module.triage.desc':
    'Дубли id, отсутствующие зависимости, перекрытые скрипты и коллизии предметов.',
  'module.cartograph.tagline': 'Менеджер карт',
  'module.cartograph.desc':
    'Пересечения ячеек карт, зоны спавна и порядок загрузки карт, который действительно работает.',
  'module.bunker.tagline': 'Резервные копии и хранилище',
  'module.bunker.desc': 'Снимки модов и сохранений, пока обновление не стёрло 300 часов игры.',
  'module.outpost.tagline': 'Сервер и коллекции',
  'module.outpost.desc':
    'Сгенерировать строки модов для server ini, списки id Workshop и коллекции для обмена.',
  'module.ledger.tagline': 'Логи и настройки',
  'module.ledger.desc': 'Логи крашей, шум консоли, ошибки lua и конфигурация комплекса.',

  'tb.backToHub': 'На главную (Esc)',
  'tb.hub': 'Главная',
  'tb.sourceMissing': '{label}: не найдено на этом компьютере',
  'tb.hideSource': 'Скрыть: {label}',
  'tb.showOnlySource': 'Показать только: {label}',
  'tb.openContainer': 'Открыть каталог-контейнер',
  'tb.rescanTitle': 'Пересканировать диск (F5)',
  'tb.scanning': 'Сканирую',
  'tb.rescan': 'Пересканировать',
  'tb.searchPlaceholder': 'Поиск по названию, id, автору, workshop id…',
  'tb.group': 'Группировка',
  'tb.sort': 'Сортировка',
  'tb.groupType': 'Тип',
  'tb.groupSource': 'Источник',
  'tb.groupBuild': 'Сборка',
  'tb.groupFlat': 'Без групп',
  'tb.sortNameAsc': 'Имя А→Я',
  'tb.sortNameDesc': 'Имя Я→А',
  'tb.sortType': 'Тип',
  'tb.sortRecent': 'Новые',
  'tb.sortId': 'Id мода',
  'tb.sortSource': 'Источник',
  'tb.filters': 'Фильтры',
  'tb.legendType': 'Тип',
  'tb.legendBuild': 'Сборка',
  'tb.legendIssues': 'Проблемы',
  'tb.duplicateIds': 'Дубли id',
  'tb.brokenRequires': 'Битые зависимости',
  'tb.noModInfo': 'Без mod.info',
  'tb.clear': 'Сбросить: {n}',
  'tb.srcProjects': 'Проекты',

  'pane.mods': 'Моды',
  'pane.collapseGroups': 'Свернуть все группы',
  'pane.expandGroups': 'Развернуть все группы',
  'list.nothingMatches': 'Ничего не найдено',
  'group.unknownBuild': 'Сборка неизвестна',

  'menu.openFolder': 'Открыть папку',
  'menu.openFolderExplorer': 'Открыть папку в Проводнике',
  'menu.reveal': 'Показать в Проводнике',
  'menu.openDefaultApp': 'Открыть приложением по умолчанию',
  'menu.openTerminal': 'Открыть терминал здесь',
  'menu.copyModId': 'Скопировать id мода',
  'menu.copyPath': 'Скопировать путь',
  'menu.copyFullPath': 'Скопировать полный путь',
  'menu.copyName': 'Скопировать имя',
  'menu.openWorkshop': 'Открыть страницу Workshop',
  'menu.hintDblClick': '2 клика',

  'glyph.warnings': 'Есть предупреждения',
  'glyph.unresolved': 'Нерешённые зависимости',
  'glyph.duplicate': 'Дубль id мода',

  'toast.pathCopied': 'Путь скопирован',
  'toast.nameCopied': 'Имя скопировано',
  'toast.modIdCopied': 'Id мода скопирован',
  'toast.copiedValue': 'Скопировано: {value}',
  'toast.loadedFolders': 'Загружено {n} {folders}',
  'toast.jumpedTo': 'Переход к {name}',

  'sk.pickMod': 'Выберите мод',
  'sk.skeletonHere': 'Его структура откроется здесь',
  'sk.filterFiles': 'фильтр файлов',
  'sk.loadFullTree': 'Загрузить всё дерево (глубина {n})',
  'sk.collapseAll': 'Свернуть всё',
  'sk.openModFolder': 'Открыть папку мода в Проводнике',
  'sk.noFilesMatch': 'Нет совпадений',
  'sk.emptyFolder': 'Папка мода пуста',

  'ip.tabMod': 'Мод',
  'ip.tabFile': 'Файл',
  'ip.reveal': 'Показать в Проводнике',
  'ip.noModSelected': 'Мод не выбран',
  'ip.noPoster': 'Нет обложки',
  'ip.duplicateTitle': 'Дубль id мода.',
  'ip.duplicateBody': 'Установлено ещё {copies} с id {id} — игра загрузит только один.',
  'ip.identity': 'Идентификация',
  'ip.modId': 'Id мода',
  'ip.rawId': 'Исходный id',
  'ip.folder': 'Папка',
  'ip.author': 'Автор',
  'ip.version': 'Версия',
  'ip.builds': 'Сборки',
  'ip.unknown': 'неизвестно',
  'ip.pzVersion': 'Версия PZ',
  'ip.source': 'Источник',
  'ip.workshop': 'Workshop',
  'ip.url': 'Ссылка',
  'ip.modified': 'Изменён',
  'ip.openWorkshopPage': 'Открыть страницу Workshop',
  'ip.openLink': 'Открыть ссылку',
  'ip.onDisk': 'На диске',
  'ip.path': 'Путь',
  'ip.openFolder': 'Открыть папку',
  'ip.revealModInfo': 'Показать mod.info',
  'ip.files': 'Файлов',
  'ip.folders': 'Папок',
  'ip.size': 'Размер',
  'ip.buildFolders': 'Папки сборок',
  'ip.openTarget': 'Открыть {path}',
  'ip.dependencies': 'Зависимости',
  'ip.requires': 'Требует',
  'ip.requiredBy': 'Нужен для: {n}',
  'ip.depMissing': 'нет',
  'ip.tags': 'Теги',
  'ip.media': 'Media ({n})',
  'ip.selectFile': 'Выберите файл в структуре',
  'ip.explorer': 'Проводник',
  'ip.open': 'Открыть',
  'ip.pathShort': 'Путь',
  'ip.file': 'Файл',
  'ip.type': 'Тип',
  'ip.typeFolder': 'Папка',
  'ip.typeFile': 'файл',
  'ip.entries': 'Элементов',
  'ip.preview': 'Просмотр',
  'ip.truncated': 'обрезано',
  'ip.binaryFile': 'Бинарный файл',
  'ip.copy': 'Скопировать',

  'warn.noModInfo': 'mod.info не читается — игра может проигнорировать эту папку',
  'warn.noId': 'В mod.info нет `id=` — зависимости не смогут сослаться на этот мод',
  'warn.posterMissing': 'Указанный файл обложки отсутствует на диске',

  'progress.sources': 'Поиск каталогов с модами',
  'progress.enumerate': 'Перебор папок модов',
  'progress.analyze': 'Чтение метаданных',
  'progress.done': 'Сканирование завершено',

  'cat.map': 'Карты',
  'cat.vehicle': 'Транспорт',
  'cat.weapon': 'Оружие',
  'cat.clothing': 'Одежда',
  'cat.item': 'Предметы',
  'cat.build': 'Крафт',
  'cat.translation': 'Переводы',
  'cat.library': 'Библиотеки',
  'cat.ui': 'Интерфейс',
  'cat.texture': 'Текстуры и тайлы',
  'cat.sound': 'Звук',
  'cat.model': 'Модели и анимации',
  'cat.balance': 'Баланс',
  'cat.server': 'Сервер',
  'cat.misc': 'Без категории',

  'src.local': 'Локальные',
  'src.workshop': 'Workshop',
  'src.game': 'Игра',
  'src.project': 'Проект',
  'src.custom': 'Свои',

  'srcLabel.local': 'Локальные моды',
  'srcLabel.workshop': 'Workshop',
  'srcLabel.gameMods': 'Моды игры',
  'srcLabel.gameMediaMods': 'Моды в media игры',
  'srcLabel.workshopProjects': 'Проекты Workshop',

  'sb.scan': 'скан {d}',
  'sb.cached': '({n} из кэша)',
  'sb.withoutInfo': '{n} без mod.info',

  'unit.ms': 'мс',
  'unit.s': 'с',
  'bytes.B': 'Б',
  'bytes.KB': 'КБ',
  'bytes.MB': 'МБ',
  'bytes.GB': 'ГБ',
  'bytes.TB': 'ТБ',

  // ---- встроенные подсказки (`?`) -----------------------------------------
  'help.close': 'Закрыть',
  'help.aria': 'Что такое «{name}»?',
  'help.toggleOn': 'Объяснить интерфейс (F1)',
  'help.toggleOff': 'Убрать подсветку подсказок (F1)',
  'help.app':
    'Каждый значок ? объясняет один элемент: что он делает и что записывает. Эта кнопка подсвечивает их все сразу, чтобы их было легко найти. Комплекс только читает диск — писать умеет лишь Workbench, и только в ваши локальные моды и каталоги проектов Workshop.',
  'help.hotkeys':
    'F1 подсказки · Esc на главную · F5 пересканировать · Ctrl+F поиск · Ctrl+S сохранить mod.info · Ctrl+Shift+E показать в Проводнике',

  // ---- главная ------------------------------------------------------------
  'help.hub.status':
    'Итог последнего сканирования диска: определённая сборка игры, сколько модов найдено и сколько из них конфликтует. Дубли id и битые зависимости считаются отдельно: это две неисправности, из-за которых мод действительно не загрузится.',
  'help.hub.modules':
    'Девять модулей, два из них готовы. Stalker показывает то, что уже установлено; Workbench создаёт, правит, проверяет и упаковывает ваши собственные моды. Закрытые плитки — заготовки, они ничего не открывают.',

  // ---- stalker ------------------------------------------------------------
  'help.tb.sources':
    'По кнопке на каждый найденный каталог с модами. Нажатие оставляет в списке только этот источник, повторное — отпускает; включить можно сразу несколько. Маленькая кнопка с папкой открывает сам каталог в Проводнике.',
  'help.tb.rescan':
    'Перечитывает все каталоги с диска. Приложение не следит за файловой системой, поэтому делайте это после установки, удаления или правки модов вне программы.',
  'help.tb.search':
    'Ищет по названию, id мода, имени папки, автору и id в Workshop. Буквы достаточно указать по порядку: «blkops» найдёт «Black Ops». Пока идёт поиск, группировка отключается, а результаты сортируются по точности совпадения.',
  'help.tb.group':
    'Разбивает список на сворачиваемые группы. «Тип» — категория, угаданная по содержимому мода, «Источник» — каталог, откуда он взят, «Сборка» — pzversion из его mod.info. «Без групп» отключает группировку. Выбор запоминается между запусками.',
  'help.tb.sort':
    'Порядок внутри группы. «Новые» сортирует по времени изменения папки — это самое близкое к «недавно обновлённым», что есть на диске. Во время поиска не применяется: там решает релевантность.',
  'help.tb.filters':
    'Открывает второй ряд панели: чипы категорий, чипы сборок и три фильтра неисправностей. Они складываются, так что «Карты + B42 + дубли id» — это три клика. Кнопка горит, пока активен хотя бы один фильтр.',
  'help.pane.mods':
    'Все моды, прошедшие текущие фильтры: показано найденных из общего числа. Цветная буква слева — угаданная категория; значки справа отмечают предупреждения, зависимости, которые никуда не ведут, и id, установленные больше одного раза.',
  'help.pane.skeleton':
    'Выбранный мод так, как он лежит на диске: сначала два уровня, дальше по требованию. Клик по папке раскрывает её, двойной клик открывает в Проводнике, правая кнопка даёт копирование и терминал. Кнопка + загружает сразу шесть уровней.',
  'help.pane.info':
    'Всё, что прочитано из mod.info, плюс подсчитанное на диске: размер, количество файлов и папок, зависимости в обе стороны. Вкладка «Файл» описывает то, что выбрано в средней панели, и показывает содержимое, если это текст.',

  // ---- Workbench: оболочка ------------------------------------------------
  'help.wb.tabs':
    'Четыре инструмента над одним модом. «Каркас» создаёт новый мод, «mod.info» правит его манифест, «Проверка» сообщает об ошибках, которые игра проглатывает молча, «Упаковка» готовит его к загрузке. Последним трём нужен мод, выбранный слева.',
  'help.wb.mods':
    'Все моды на компьютере, редактируемые — первыми. В счётчике те, в которые можно писать; у остальных замок, потому что они лежат в каталоге игры или в подписках Workshop, где Steam откатит правку при следующей проверке.',
  'help.wb.search':
    'Фильтрует список по названию, id мода и имени папки — буквы по порядку, а не точное вхождение. Заблокированные моды остаются в списке, чтобы их можно было прочитать.',
  'help.wb.newMod':
    'Снимает выбор мода и открывает «Каркас» с пустыми полями.',
  'help.wb.rescan':
    'Перечитывает диск. Нужно, если вы добавили или удалили папку мода вне приложения и её нет в списке.',

  // ---- Workbench: каркас --------------------------------------------------
  'help.wb.sc.panel':
    'Создаёт папку, по одному mod.info на каждую раскладку сборок и отмеченные подкаталоги media. Существующую папку инструмент трогать откажется, так что ничего вашего отсюда затереть нельзя.',
  'help.wb.sc.name':
    'Название в списке модов игры и на странице Workshop. Свободный текст: пробелы, знаки и заглавные буквы допустимы. Пока вы не правите имя папки и id вручную, они подставляются отсюда.',
  'help.wb.sc.author':
    'Записывается в author= и показывается рядом с модом. Косметика: игра ни с чем это значение не сверяет.',
  'help.wb.sc.folderName':
    'Папка, которая будет создана на диске. Держитесь букв, цифр, точки, подчёркивания и дефиса: эта строка попадает в пути к файлам, а сервер на Linux различает регистр.',
  'help.wb.sc.modId':
    'То, на что другие моды ссылаются через require=, и то, что запоминает файл сохранения. Должен быть уникальным на компьютере, а его смена позже ломает все зависящие от вас моды. По соглашению совпадает с именем папки.',
  'help.wb.sc.modVersion':
    'Ваша собственная версия, например 1.0.0. Игра её не сравнивает — она нужна игрокам и списку изменений.',
  'help.wb.sc.pzVersion':
    'Сборка игры, под которую написан мод, например 42.0.0. Project Zomboid по ней предупреждает игрока, что мод устарел, поэтому честное значение здесь избавляет от баг-репортов, которые на деле — несовпадение версий.',
  'help.wb.sc.description':
    'Текст под модом в списке игры и начало страницы Workshop. Одна-две фразы о том, что мод действительно меняет, полезнее перечня функций: для большинства игроков это единственное, что они читают перед включением. В mod.info описание хранится одной строкой, поэтому переносы превратятся в пробелы.',
  'help.wb.sc.url':
    'Ссылка, показываемая рядом с модом: страница Workshop, тема на форуме или репозиторий. На загрузку не влияет — по ней игрок находит источник, сообщает об ошибках и проверяет обновления. Пишите полный адрес, вместе с https://.',
  'help.wb.sc.tags':
    'Свободные метки для просмотра и фильтрации; загрузчик их игнорирует. Разделяйте точкой с запятой: Build 42;Items;Balance. Брать метки, которые игроки уже ищут, полезнее, чем придумывать свои.',
  'help.wb.sc.requires':
    'Id модов, без которых этот мод не работает, по одному в строке. Игра не даст включить ваш мод, пока каждого из них нет на месте, поэтому перечисляйте только жёсткие зависимости: устаревший или опечатанный id игрок воспримет как сломанный мод.',
  'help.wb.sc.destination':
    'В каком каталоге создать папку. Предлагаются только каталоги, доступные для записи; отсутствующий каталог будет создан.',
  'help.wb.sc.layout':
    'Где лежит media/. Build 42 ждёт common/media, Build 41 — media в корне мода. «Обе» пишет common/ плюс переопределение 41/: так одна папка поддерживает две версии игры.',
  'help.wb.sc.contents':
    'Какие пустые подкаталоги создать внутри media. Ни один не обязателен — отметьте то, что точно нужно, остальное всегда на одну папку дальше.',
  'help.wb.sc.examples':
    'Создаёт рабочую точку входа lua, один пример предмета и заготовку перевода, чтобы мод загрузился и на первом запуске сделал что-то заметное, а не ничего.',
  'help.wb.sc.poster':
    'Создаёт заглушку 512×256, чтобы poster= работал с первого запуска и в списке модов была плитка, а не пустое место. Перед публикацией замените настоящей обложкой.',

  // ---- Workbench: mod.info ------------------------------------------------
  'help.wb.info.panel':
    'mod.info — манифест, который игра читает раньше всего остального: он определяет имя в списке модов, id, на который ссылаются другие моды, и сборку, которую мод объявляет поддерживаемой. До нажатия «Сохранить» на диск ничего не пишется.',
  'help.wb.info.mode':
    '«Поля» — форма над ключами, которые знает приложение. «Текст» — сам файл, сохраняемый дословно, для ключей, которых форма не знает. Переключение конвертирует то, что набрано, поэтому правки не теряются ни в одну сторону и диск при этом не затрагивается.',
  'help.wb.info.id':
    'Смена id у мода, который уже выпущен, ломает все моды с require= на него и все сохранения, где записан старый. Переименовывайте, пока мод есть только у вас.',
  'help.wb.info.poster':
    'Путь к картинке для списка модов, относительно папки мода — обычно poster.png, 512×256. Путь, ведущий в никуда, попадёт в «Проверку» как предупреждение.',
  'help.wb.info.icon':
    'Необязательная маленькая иконка, путь относительно папки мода. Если пусто, список модов возьмёт обложку.',
  'help.wb.info.extra':
    'Ключи, найденные в файле, которые форма не описывает. Они записываются обратно точно как были и в том же порядке, так что правка здесь ничего не теряет.',
  'help.wb.info.backup':
    'Перед записью копирует текущий файл в mod.info.bak. Дешёвая страховка — оставьте включённой, если не ведёте папку мода в системе контроля версий.',
  'help.wb.info.raw':
    'Файл как текст, сохраняется символ в символ. Комментарии и неизвестные ключи выживают; пока сохранение идёт с этой вкладки, поля формы игнорируются.',

  // ---- Workbench: проверка ------------------------------------------------
  'help.wb.val.panel':
    'Только статические проверки: ничего не выполняется и ничего не меняется. Читаются mod.info, lua, скрипты и файлы переводов, а в отчёт попадает то, что игра проглотит молча: несбалансированные блоки, отсутствующие текстуры, мёртвые зависимости, папки в неверном регистре.',
  'help.wb.val.severity':
    'Ошибки не дают загрузиться моду или файлу. Предупреждения загружаются, но часть вашей работы при этом тихо отбрасывается. Заметки — это гигиена. Статическая проверка не видит состояния во время игры, поэтому судит осторожно и скорее сообщит лишнее.',

  // ---- Workbench: упаковка ------------------------------------------------
  'help.wb.pack.panel':
    'Копирует мод в тот вид, который ждёт загрузка. Сам ничего не выкладывает: публикация по-прежнему происходит в игре или передачей архива.',
  'help.wb.pack.mode':
    '«Проект Workshop» раскладывает Contents/mods/… вместе с workshop.txt и preview.png — именно это читает внутриигровой загрузчик. «Zip-архив» пишет один файл с папкой мода внутри, для раздачи вручную.',
  'help.wb.pack.builds':
    'Какие папки сборок копировать. «Всё» берёт обе; вариант с одной сборкой выбрасывает папки, нужные другой, — так выгрузка под одну версию игры остаётся чистой.',
  'help.wb.pack.outputName':
    'Имя создаваемой папки проекта или файла .zip. Правила те же, что для папки мода: буквы, цифры, точка, подчёркивание, дефис.',
  'help.wb.pack.outputDir':
    'Куда записать результат. Если пусто — в каталог Workshop внутри пользовательской папки Zomboid, где внутриигровой загрузчик и ищет проекты.',
  'help.wb.pack.meta':
    'Содержимое workshop.txt. Внутриигровой загрузчик читает этот файл, чтобы заполнить страницу Workshop, поэтому эти поля и есть страница, а не копия mod.info.',
  'help.wb.pack.metaTitle':
    'Заголовок item в Workshop; он может отличаться от названия мода. По умолчанию берётся название мода.',
  'help.wb.pack.metaTags':
    'Теги Workshop через точку с запятой, например Build 42;Items. Workshop принимает только известные ему метки, придуманные отбрасываются при загрузке.',
  'help.wb.pack.metaVisibility':
    'Кто увидит item после публикации. «Приватный» и «Только друзья» — безопасный способ отрепетировать загрузку до публичного релиза.',
  'help.wb.pack.metaId':
    'Id существующего item в Workshop, который нужно обновить. Оставьте пустым, чтобы опубликовать новый; неверный id направит обновление не туда.',
  'help.wb.pack.metaDescription':
    'Тело страницы Workshop. Обычный текст — в отличие от mod.info его не сжимают в одну строку.',
  'help.wb.pack.preview':
    'Копирует обложку мода в preview.png — миниатюру, которую Workshop показывает в результатах поиска. Без неё item выглядит пустой картинкой.',
  'help.wb.pack.exclude':
    'Дополнительные шаблоны для исключения, по одному в строке, подстановка только через *. Каталоги систем контроля версий, состояние редактора, бэкапы и логи отбрасываются и без вашего участия.',

  // ---- Workbench: оболочка / панель инструментов --------------------------
  'wb.newMod': 'Новый мод',
  'wb.newModTitle': 'Создать каркас нового мода',
  'wb.searchPlaceholder': 'Поиск среди модов, которые можно править…',
  'wb.tabScaffold': 'Каркас',
  'wb.tabInfo': 'mod.info',
  'wb.tabValidate': 'Проверка',
  'wb.tabPack': 'Упаковка',
  'wb.paneMods': 'Редактируемые моды',
  'wb.noMods': 'Редактируемых модов не найдено',
  'wb.noModsHint': 'Создайте каркас или добавьте каталог в settings.json',
  'wb.pickMod': 'Выберите мод',
  'wb.pickModHint': 'Выберите мод слева или создайте новый каркас',
  'wb.readOnly': 'Каталог только для чтения',
  'wb.readOnlyBody':
    'Этот мод находится вне {roots}. В каталог игры и контент Steam Workshop запись не ведётся: обновления и проверка Steam всё равно откатят изменения.',
  'wb.writeRoots': 'ваши локальные моды и каталоги проектов Workshop',
  'wb.revealMod': 'Показать папку мода',
  'wb.openMod': 'Открыть папку мода',
  'wb.busy': 'Выполняется',
  'wb.sourceLocal': 'Локальный',
  'wb.sourceProject': 'Проект',
  'wb.sourceCustom': 'Свой',
  'wb.locked': 'Заблокирован',
  'wb.lockedTitle': 'Вне списка каталогов для записи — только чтение',

  // ---- каркас -------------------------------------------------------------
  'wb.sc.title': 'Каркас мода',
  'wb.sc.lede':
    'Создаёт папку мода, mod.info для каждой сборки и отмеченные подкаталоги media. Существующую папку не трогает.',
  'wb.sc.identity': 'Идентификация',
  'wb.sc.destination': 'Куда',
  'wb.sc.layout': 'Раскладка сборок',
  'wb.sc.contents': 'Содержимое',
  'wb.sc.folderName': 'Имя папки',
  'wb.sc.folderHint': 'A-Z, 0-9, точка, подчёркивание, дефис',
  'wb.sc.modId': 'Id мода',
  'wb.sc.modIdHint': 'То, что другие моды пишут в require=',
  'wb.sc.name': 'Отображаемое имя',
  'wb.sc.author': 'Автор',
  'wb.sc.description': 'Описание',
  'wb.sc.modVersion': 'Версия мода',
  'wb.sc.pzVersion': 'Версия PZ',
  'wb.sc.url': 'Ссылка',
  'wb.sc.tags': 'Теги',
  'wb.sc.tagsHint': 'Через точку с запятой',
  'wb.sc.requires': 'Зависимости',
  'wb.sc.requiresHint': 'По одному id мода в строке',
  'wb.sc.layoutB41': 'Build 41',
  'wb.sc.layoutB41Hint': 'media/ в корне мода',
  'wb.sc.layoutB42': 'Build 42',
  'wb.sc.layoutB42Hint': 'common/media/',
  'wb.sc.layoutBoth': 'Обе',
  'wb.sc.layoutBothHint': 'common/ плюс переопределение 41/',
  'wb.sc.folderLuaClient': 'lua/client',
  'wb.sc.folderLuaServer': 'lua/server',
  'wb.sc.folderLuaShared': 'lua/shared',
  'wb.sc.folderScripts': 'scripts',
  'wb.sc.folderTextures': 'textures',
  'wb.sc.folderSounds': 'sound',
  'wb.sc.folderModels': 'models_x',
  'wb.sc.folderTranslate': 'Translate/EN',
  'wb.sc.folderMaps': 'maps',
  'wb.sc.folderUi': 'ui',
  'wb.sc.examples': 'Создать стартовые файлы',
  'wb.sc.examplesHint': 'Рабочая точка входа lua, пример предмета и заготовка перевода',
  'wb.sc.poster': 'Сгенерировать заглушку poster.png',
  'wb.sc.posterHint': '512×256, чтобы poster= работал с первого запуска',
  'wb.sc.create': 'Создать мод',
  'wb.sc.created': 'Создан {name}',
  'wb.sc.createdFiles': 'Записано {n} {entries}',
  'wb.sc.noTarget': 'Каталог для записи не найден',
  'wb.sc.targetMissing': 'будет создан',
  'wb.sc.willCreate': 'Создаёт',

  // ---- редактор mod.info --------------------------------------------------
  'wb.info.title': 'mod.info',
  'wb.info.form': 'Поля',
  'wb.info.raw': 'Текст',
  'wb.info.save': 'Сохранить',
  'wb.info.saveTitle': 'Записать mod.info (Ctrl+S)',
  'wb.info.revert': 'Откатить',
  'wb.info.revertTitle': 'Отменить изменения и перечитать с диска',
  'wb.info.saved': 'mod.info сохранён',
  'wb.info.savedBackup': 'mod.info сохранён · прежний оставлен как mod.info.bak',
  'wb.info.dirty': 'Несохранённые изменения',
  'wb.info.missing': 'У этого мода нет mod.info',
  'wb.info.missingBody': 'Сохранение создаст его в {file}.',
  'wb.info.backup': 'Оставить mod.info.bak',
  'wb.info.extra': 'Прочие ключи',
  'wb.info.extraHint': 'Сохраняются как есть',
  'wb.info.rawHint': 'Сохраняется дословно. Пока открыта эта вкладка, поля формы игнорируются.',
  'wb.info.addRequire': 'Добавить require',
  'wb.info.addTag': 'Добавить тег',
  'wb.info.remove': 'Удалить',
  'wb.info.file': 'Файл',

  // ---- проверка -----------------------------------------------------------
  'wb.val.title': 'Проверка',
  'wb.val.lede':
    'Статические проверки mod.info, lua, скриптов и переводов. Предупреждения — это повод присмотреться, а не приговор.',
  'wb.val.run': 'Запустить проверки',
  'wb.val.rerun': 'Проверить снова',
  'wb.val.running': 'Проверка',
  'wb.val.clean': 'Проблем не найдено',
  'wb.val.cleanBody': 'Проверено {files} {filesWord} за {duration}.',
  'wb.val.summary': '{files} {filesWord} · {bytes} · {duration}',
  'wb.val.errors': 'Ошибки',
  'wb.val.warnings': 'Предупреждения',
  'wb.val.infos': 'Заметки',
  'wb.val.truncated': 'Достигнут предел сканирования — отчёт неполный',
  'wb.val.copyReport': 'Скопировать отчёт',
  'wb.val.reportCopied': 'Отчёт скопирован',
  'wb.val.modScope': 'Мод',
  'wb.val.line': 'строка {n}',
  'wb.val.openFile': 'Показать в Проводнике',
  'wb.val.filterAll': 'Все',
  'wb.val.neverRun': 'Ещё не проверялся',
  'wb.val.neverRunBody': 'Запустите проверки, чтобы увидеть, на чём споткнётся этот мод.',

  // ---- правила проверки ---------------------------------------------------
  'wbrule.modinfo.missing': 'Нигде в моде нет mod.info — игра проигнорирует эту папку',
  'wbrule.modinfo.no-name': 'В mod.info нет name= — в списке модов будет показано имя папки',
  'wbrule.modinfo.no-id': 'В mod.info нет id= — ни один мод не сможет указать его в require=',
  'wbrule.modinfo.id-folder-mismatch': 'id= равен {id}, но папка называется {folder}',
  'wbrule.modinfo.duplicate-key': '{key}= встречается {n} раз — читается только первый',
  'wbrule.modinfo.no-description': 'Нет description= — страница Workshop будет пустой',
  'wbrule.modinfo.no-pzversion': 'Нет pzversion= — игра не предупредит о несовпадении сборок',
  'wbrule.modinfo.no-poster': 'Нет poster= — в списке модов будет пустая плитка',
  'wbrule.modinfo.poster-missing': 'poster= указывает на {file}, которого нет на диске',
  'wbrule.modinfo.icon-missing': 'icon= указывает на {file}, которого нет на диске',
  'wbrule.modinfo.require-missing': 'require={id} не установлен на этом компьютере',
  'wbrule.modinfo.self-require': 'Мод требует собственный id {id}',
  'wbrule.modinfo.unknown-key': 'Неизвестный ключ {key}= — игра его игнорирует',
  'wbrule.modinfo.bom': 'Файл начинается с BOM, что может сломать первый ключ',
  'wbrule.layout.no-media': 'Нет папки media/ — игра ничего не загрузит из этого мода',
  'wbrule.layout.media-case': '{dir} не в нижнем регистре — сервер на Linux её не найдёт',
  'wbrule.layout.non-ascii-name': 'В имени {file} есть не-ASCII символы',
  'wbrule.layout.empty-dir': '{dir} пуста',
  'wbrule.lua.empty': 'Файл пуст',
  'wbrule.lua.unterminated-string': 'Незакрытая строковая константа',
  'wbrule.lua.unterminated-comment': 'Незакрытый длинный комментарий',
  'wbrule.lua.bracket-unbalanced': '{bracket} не сбалансированы на {delta}',
  'wbrule.lua.block-unclosed': 'Блоков не закрыто через end: {n}',
  'wbrule.lua.block-extra-end': 'end без соответствующего блока',
  'wbrule.script.brace-unbalanced': 'Фигурные скобки не сбалансированы на {delta}',
  'wbrule.script.no-module': 'Нет блока module — игра ничего не прочитает из этого файла',
  'wbrule.script.duplicate-item': '{name} определён более одного раза',
  'wbrule.script.item-no-display-name': 'У {name} нет DisplayName',
  'wbrule.script.item-no-type': 'У {name} нет Type',
  'wbrule.script.icon-missing': '{name} требует {texture}, которого нет в media/textures',
  'wbrule.script.unknown-block': 'Нераспознанный блок {block}',
  'wbrule.translate.unknown-language': '{dir} — не известный игре код языка',
  'wbrule.translate.brace-unbalanced': 'Фигурные скобки не сбалансированы на {delta}',
  'wbrule.translate.header-mismatch':
    'Имя таблицы оканчивается на _{found}, но папка — {expected}: все записи будут отброшены',
  'wbrule.translate.empty': 'Файл перевода пуст',
  'wbrule.translate.json-invalid': 'Некорректный JSON — игра не загрузит ни одной записи',
  'wbrule.translate.json-not-object':
    'JSON-перевод должен быть одним объектом из пар «ключ — текст»',
  'wbrule.translate.json-non-string':
    '{key} — не текстовое значение (всего {n}): такие ключи не будут найдены',

  // ---- упаковка -----------------------------------------------------------
  'wb.pack.title': 'Упаковка для загрузки',
  'wb.pack.lede':
    'Готовит раскладку, которую ждёт внутриигровой загрузчик Workshop, либо пишет один архив для ручной раздачи.',
  'wb.pack.mode': 'Результат',
  'wb.pack.modeWorkshop': 'Проект Workshop',
  'wb.pack.modeWorkshopHint': 'Contents/mods/… плюс workshop.txt и preview.png',
  'wb.pack.modeZip': 'Zip-архив',
  'wb.pack.modeZipHint': 'Один .zip с папкой мода внутри',
  'wb.pack.builds': 'Сборки',
  'wb.pack.buildsAll': 'Всё',
  'wb.pack.buildsB41': 'Только Build 41',
  'wb.pack.buildsB42': 'Только Build 42',
  'wb.pack.buildsHint': 'Фильтрует папки common/ и 4x.x/ в корне мода',
  'wb.pack.outputName': 'Имя проекта',
  'wb.pack.outputNameZip': 'Имя архива',
  'wb.pack.outputDir': 'Каталог вывода',
  'wb.pack.pickDir': 'Выбрать…',
  'wb.pack.resetDir': 'По умолчанию',
  'wb.pack.exclude': 'Также исключить',
  'wb.pack.excludeHint': 'По одному шаблону в строке. Подстановка только через *.',
  'wb.pack.excludeDefault': 'Системы контроля версий, состояние редактора, бэкапы и логи пропускаются всегда.',
  'wb.pack.meta': 'workshop.txt',
  'wb.pack.metaTitle': 'Заголовок',
  'wb.pack.metaDescription': 'Описание',
  'wb.pack.metaTags': 'Теги',
  'wb.pack.metaTagsHint': 'Через точку с запятой, напр. Build 42;Items',
  'wb.pack.metaVisibility': 'Видимость',
  'wb.pack.visPublic': 'Публичный',
  'wb.pack.visFriends': 'Только друзья',
  'wb.pack.visPrivate': 'Приватный',
  'wb.pack.visUnlisted': 'Скрытый из поиска',
  'wb.pack.metaId': 'Id в Workshop',
  'wb.pack.metaIdHint': 'Оставьте пустым, чтобы опубликовать новый item',
  'wb.pack.preview': 'Скопировать обложку как preview.png',
  'wb.pack.run': 'Упаковать',
  'wb.pack.running': 'Упаковка',
  'wb.pack.result': 'Упаковано',
  'wb.pack.resultFiles': 'Файлов',
  'wb.pack.resultSize': 'Размер',
  'wb.pack.resultWritten': 'Записано',
  'wb.pack.resultSkipped': 'Пропущено',
  'wb.pack.resultOutput': 'Вывод',
  'wb.pack.reveal': 'Показать результат',
  'wb.pack.destination': 'Куда',
  'wb.pack.noZomboid': 'Каталог пользователя Zomboid не найден — выберите каталог вывода',
  'wb.pack.uploadHint':
    'Запустите Project Zomboid и через Workshop → Create/Update опубликуйте подготовленный проект.',

  // ---- фазы прогресса -----------------------------------------------------
  'wb.phase.collect': 'Сбор файлов',
  'wb.phase.read': 'Чтение',
  'wb.phase.write': 'Запись',
  'wb.phase.done': 'Готово'
}

/**
 * Plural forms, ordered `[one, few, many]`.
 *
 * English only distinguishes one/other, so slots 1 and 2 are identical there.
 * Russian needs all three (1 мод / 2 мода / 5 модов), and the adjective inflects
 * with the noun, so whole phrases are stored rather than bare nouns.
 */
export const EN_PLURALS = {
  mods: ['mod', 'mods', 'mods'],
  sources: ['source', 'sources', 'sources'],
  folders: ['folder', 'folders', 'folders'],
  copies: ['other copy', 'other copies', 'other copies'],
  duplicateIds: ['duplicate id', 'duplicate ids', 'duplicate ids'],
  brokenRequires: ['broken require', 'broken requires', 'broken requires'],
  entries: ['entry', 'entries', 'entries'],
  files: ['file', 'files', 'files'],
  issues: ['issue', 'issues', 'issues']
} as const

export type PluralKey = keyof typeof EN_PLURALS

export const RU_PLURALS: Record<PluralKey, readonly [string, string, string]> = {
  mods: ['мод', 'мода', 'модов'],
  sources: ['источник', 'источника', 'источников'],
  folders: ['папка', 'папки', 'папок'],
  copies: ['копия', 'копии', 'копий'],
  duplicateIds: ['дубль id', 'дубля id', 'дублей id'],
  brokenRequires: ['битая зависимость', 'битые зависимости', 'битых зависимостей'],
  entries: ['элемент', 'элемента', 'элементов'],
  files: ['файл', 'файла', 'файлов'],
  issues: ['проблема', 'проблемы', 'проблем']
}
