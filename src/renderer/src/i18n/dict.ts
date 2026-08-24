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
  'bytes.TB': 'TB'
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
  'bytes.TB': 'ТБ'
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
  brokenRequires: ['broken require', 'broken requires', 'broken requires']
} as const

export type PluralKey = keyof typeof EN_PLURALS

export const RU_PLURALS: Record<PluralKey, readonly [string, string, string]> = {
  mods: ['мод', 'мода', 'модов'],
  sources: ['источник', 'источника', 'источников'],
  folders: ['папка', 'папки', 'папок'],
  copies: ['копия', 'копии', 'копий'],
  duplicateIds: ['дубль id', 'дубля id', 'дублей id'],
  brokenRequires: ['битая зависимость', 'битые зависимости', 'битых зависимостей']
}
