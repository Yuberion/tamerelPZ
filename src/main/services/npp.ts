/**
 * Tools (module 07) — the Notepad++ bridge, tuned for Project Zomboid.
 *
 * Two jobs:
 *
 *  1. **Find Notepad++** — registry first (both the 64-bit and the WOW6432Node
 *     view, plus the per-user install), then the folders installers actually use,
 *     then whatever the user pointed at. The executable path is never accepted
 *     from the renderer: `shell:open` refuses `.exe` for good reason, and this
 *     module would be a trivial way around that if it took a path.
 *
 *  2. **Install a PZ syntax pack** — two User Defined Languages written into
 *     `userDefineLangs`, which Notepad++ 7.6+ loads file-by-file from its own
 *     config directory. That folder is the one place a syntax definition can go
 *     without administrator rights and without overwriting anything Notepad++
 *     ships, so nothing here ever touches the install directory.
 *
 * Why UDLs at all: PZ's `media/scripts/*.txt` and `mod.info` are real languages
 * with real grammars that no editor knows. Notepad++ opens them as plain text,
 * which is why a missing comma three hundred lines up is a twenty-minute hunt.
 * A UDL gives brace folding, keyword colour and comment awareness — the three
 * things that turn that hunt into a glance.
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type { AppSettings, NppInstallResult, NppPackFile, NppPackPreview, NppStatus } from '../../shared/types'
import { exists, isDir, readTextSafe } from './fsx'

const run = promisify(execFile)

/** Bump when a pack file's content changes; drives the "update available" state. */
const PACK_VERSION = '1.0.0'
const MARKER = 'PZM-PACK'

const EXE = 'notepad++.exe'
const UDL_DIR = 'userDefineLangs'

/* ------------------------------------------------------------- detection --- */

async function regValue(key: string, name?: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  try {
    const args = name ? [key, '/v', name] : [key, '/ve']
    const { stdout } = await run('reg', ['query', ...args], { windowsHide: true })
    const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

const REG_ROOTS = [
  'HKLM\\SOFTWARE\\Notepad++',
  'HKLM\\SOFTWARE\\WOW6432Node\\Notepad++',
  'HKCU\\SOFTWARE\\Notepad++'
]

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Notepad++',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Notepad++',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Notepad++'
]

function knownDirs(): string[] {
  return [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Notepad++'),
    join(process.env['ProgramW6432'] ?? 'C:\\Program Files', 'Notepad++'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Notepad++'),
    join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'Notepad++')
  ]
}

interface Found {
  exePath: string
  dir: string
  source: NonNullable<NppStatus['source']>
}

async function locateExe(settings: AppSettings): Promise<Found | undefined> {
  const override = settings.nppPathOverride
  if (override) {
    // The override may name the folder or the executable itself.
    const candidates = override.toLowerCase().endsWith('.exe')
      ? [override]
      : [join(override, EXE), join(override, 'Notepad++', EXE)]
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return { exePath: normalize(candidate), dir: dirname(normalize(candidate)), source: 'override' }
      }
    }
  }

  for (const key of REG_ROOTS) {
    const dir = await regValue(key)
    if (!dir) continue
    const exe = join(dir, EXE)
    if (await exists(exe)) return { exePath: normalize(exe), dir: normalize(dir), source: 'registry' }
  }

  for (const dir of knownDirs()) {
    const exe = join(dir, EXE)
    if (await exists(exe)) return { exePath: normalize(exe), dir: normalize(dir), source: 'known' }
  }
  return undefined
}

async function readVersion(): Promise<string | undefined> {
  for (const key of UNINSTALL_KEYS) {
    const value = await regValue(key, 'DisplayVersion')
    if (value) return value
  }
  return undefined
}

/**
 * Where Notepad++ keeps its own configuration.
 *
 * A portable copy is flagged by `doLocalConf.xml` sitting next to the exe, and
 * then everything — including `userDefineLangs` — lives in the install folder
 * instead of `%APPDATA%`. Getting this wrong installs the pack somewhere
 * Notepad++ will never look.
 */
async function configDir(found: Found | undefined): Promise<{ dir: string; portable: boolean }> {
  if (found && (await exists(join(found.dir, 'doLocalConf.xml')))) {
    return { dir: found.dir, portable: true }
  }
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
  return { dir: join(appData, 'Notepad++'), portable: false }
}

/* -------------------------------------------------------------- the pack --- */

interface PackSpec {
  name: string
  label: string
  build: () => string
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface StyleSpec {
  name: string
  fg: string
  bg?: string
  /** Bitmask: 1 bold, 2 italic, 4 underline. */
  style?: number
}

/** The suite's own palette, so the editor and the app do not fight each other. */
const BG = '0E1013'

function styles(list: StyleSpec[]): string {
  return list
    .map(
      (s) =>
        `        <WordsStyle name="${esc(s.name)}" fgColor="${s.fg}" bgColor="${s.bg ?? BG}" ` +
        `fontName="" fontStyle="${s.style ?? 0}" fontSize="" />`
    )
    .join('\n')
}

/** Every keyword list UDL 2.1 expects, in the order Notepad++ writes them. */
function keywordLists(entries: Record<string, string>): string {
  const order = [
    'Comments',
    'Numbers, prefix1',
    'Numbers, prefix2',
    'Numbers, extras1',
    'Numbers, extras2',
    'Numbers, suffix1',
    'Numbers, suffix2',
    'Numbers, range',
    'Operators1',
    'Operators2',
    'Folders in code1, open',
    'Folders in code1, middle',
    'Folders in code1, close',
    'Folders in code2, open',
    'Folders in code2, middle',
    'Folders in code2, close',
    'Folders in comment, open',
    'Folders in comment, middle',
    'Folders in comment, close',
    'Keywords1',
    'Keywords2',
    'Keywords3',
    'Keywords4',
    'Keywords5',
    'Keywords6',
    'Keywords7',
    'Keywords8',
    'Delimiters'
  ]
  return order
    .map((name) => `            <Keywords name="${esc(name)}">${esc(entries[name] ?? '')}</Keywords>`)
    .join('\n')
}

function wrap(langName: string, ext: string, settings: string, lists: string, styleBlock: string): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- ${MARKER} ${PACK_VERSION} — generated by PZ MANAGEMENT (Tools). Safe to delete. -->
<NotepadPlus>
    <UserLang name="${esc(langName)}" ext="${esc(ext)}" udlVersion="2.1">
        <Settings>
${settings}
        </Settings>
        <KeywordLists>
${lists}
        </KeywordLists>
        <Styles>
${styleBlock}
        </Styles>
    </UserLang>
</NotepadPlus>
`
}

const GLOBAL_SETTINGS =
  '            <Global caseIgnored="yes" allowFoldOfComments="no" foldCompact="no" ' +
  'forcePureLC="0" decimalSeparator="0" />\n' +
  '            <Prefix Keywords1="no" Keywords2="no" Keywords3="no" Keywords4="no" ' +
  'Keywords5="no" Keywords6="no" Keywords7="no" Keywords8="no" />'

/**
 * Block keywords of `media/scripts/*.txt`.
 *
 * Build 41's set plus Build 42's additions. They are folded together on purpose:
 * a mod that supports both builds keeps both dialects side by side, and an editor
 * that greys out half of them is worse than one that knows all of them.
 */
const SCRIPT_BLOCKS = [
  'module', 'imports', 'item', 'recipe', 'evolvedrecipe', 'uniquerecipe', 'fixing',
  'model', 'sound', 'animation', 'animationsMesh', 'vehicle', 'template', 'ragdoll',
  'mannequin', 'multistagebuild', 'entity', 'component', 'craftRecipe', 'fluid',
  'timedAction', 'researchRecipe', 'farming', 'energy', 'roomdef', 'physicsHitReaction'
]

/** Property names on the left of an `=`. Highlighting these catches typos fast. */
const SCRIPT_KEYS = [
  'Type', 'DisplayName', 'DisplayCategory', 'Icon', 'IconsForTexture', 'Weight',
  'WeightReduction', 'Capacity', 'MaxCapacity', 'ItemCount', 'Count', 'CanStoreWater',
  'IsCookable', 'DangerousUncooked', 'FoodType', 'HungerChange', 'ThirstChange',
  'UnhappyChange', 'BoredomChange', 'StressChange', 'EnduranceMod', 'Calories',
  'Carbohydrates', 'Lipids', 'Proteins', 'Packaged', 'DaysFresh', 'DaysTotallyRotten',
  'ReplaceOnUse', 'ReplaceOnDeplete', 'ReplaceOnCooked', 'UseDelta', 'UseWhileEquipped',
  'UseWhileUnequipped', 'StaticModel', 'WorldStaticModel', 'WeaponSprite', 'SwingAnim',
  'MinDamage', 'MaxDamage', 'CritDmgMultiplier', 'CriticalChance', 'MinAngle', 'MinRange',
  'MaxRange', 'MaxHitCount', 'AimingTime', 'ReloadTime', 'RecoilDelay', 'PushBackMod',
  'KnockdownMod', 'SplatNumber', 'SplatBloodOnNoDeath', 'DoorDamage', 'TreeDamage',
  'WeaponWeight', 'ConditionMax', 'ConditionLowerChanceOneIn', 'MetalValue',
  'RunSpeedModifier', 'ClothingItem', 'BodyLocation', 'CanBeEquipped', 'BloodLocation',
  'Insulation', 'WindResistance', 'WaterResistance', 'FabricType', 'ScratchDefense',
  'BiteDefense', 'BulletDefense', 'NeckProtectionModifier', 'CombatSpeedModifier',
  'RemoveOnBroken', 'Tags', 'RequireInHandOrInventory', 'Tooltip', 'EvolvedRecipe',
  'TeachedRecipes', 'SkillTrained', 'NumberOfPages', 'LvlSkillTrained', 'Alcoholic',
  'AlcoholPower', 'CustomEatSound', 'CustomContextMenu', 'CloseKillMove', 'TwoHandWeapon',
  'RequiresEquippedBothHands', 'Ranged', 'AmmoType', 'MaxAmmo', 'ClipSize',
  'ProjectileCount', 'MagazineType', 'JamGunChance', 'HitChance',
  'AimingPerkCritModifier', 'AimingPerkHitChanceModifier', 'AimingPerkRangeModifier',
  'AimingPerkMinAngleModifier', 'SoundGain', 'SoundRadius', 'SoundVolume', 'ImpactSound',
  'HitSound', 'SwingSound', 'EquipSound', 'UnequipSound', 'BreakSound', 'ExplosionSound',
  'Result', 'Time', 'Category', 'NeedToBeLearn', 'OnCreate', 'OnTest', 'OnGiveXP',
  'CanBeDoneFromFloor', 'Sound', 'Prop1', 'Prop2', 'RemoveResultItem', 'SkillRequired',
  'Override', 'Recipe', 'mesh', 'texture', 'scale', 'shader', 'static', 'invertX',
  'model', 'file', 'loop', 'is3D', 'clip', 'engineRPM', 'mechanicType', 'skin'
]

/** Values on the right of an `=`, plus the recipe modifiers. */
const SCRIPT_VALUES = [
  'Weapon', 'Food', 'Clothing', 'Normal', 'Container', 'Drainable', 'Literature',
  'Key', 'KeyRing', 'Map', 'Radio', 'AlarmClock', 'AlarmClockClothing', 'Moveable',
  'WeaponPart', 'Durability', 'true', 'false', 'Hand', 'Torso', 'Legs', 'Feet', 'Head',
  'Axe', 'Blunt', 'SmallBlunt', 'LongBlade', 'SmallBlade', 'Spear', 'Aiming',
  'Reloading', 'Woodwork', 'Cooking', 'Farming', 'Doctor', 'Electricity', 'MetalWelding',
  'Mechanics', 'Tailoring', 'Fishing', 'Trapping', 'PlantScavenging'
]

const RECIPE_MODIFIERS = ['keep', 'destroy', 'mayFail', 'Base', 'Water', 'use', 'Any']

const SCRIPT_STYLES: StyleSpec[] = [
  { name: 'DEFAULT', fg: 'CFC9BD' },
  { name: 'COMMENTS', fg: '6E6B64', style: 2 },
  { name: 'LINE COMMENTS', fg: '6E6B64', style: 2 },
  { name: 'NUMBERS', fg: 'BD9B32' },
  { name: 'KEYWORDS1', fg: 'C87A48', style: 1 },
  { name: 'KEYWORDS2', fg: '607F8F' },
  { name: 'KEYWORDS3', fg: '6F8757' },
  { name: 'KEYWORDS4', fg: 'A08A63' },
  { name: 'KEYWORDS5', fg: 'CFC9BD' },
  { name: 'KEYWORDS6', fg: 'CFC9BD' },
  { name: 'KEYWORDS7', fg: 'CFC9BD' },
  { name: 'KEYWORDS8', fg: 'CFC9BD' },
  { name: 'OPERATORS', fg: '9A958A' },
  { name: 'FOLDER IN CODE1', fg: 'C87A48', style: 1 },
  { name: 'FOLDER IN CODE2', fg: 'C87A48' },
  { name: 'FOLDER IN COMMENT', fg: '6E6B64' },
  { name: 'DELIMITERS1', fg: '8F3A2E' },
  { name: 'DELIMITERS2', fg: '87757F' },
  { name: 'DELIMITERS3', fg: 'CFC9BD' },
  { name: 'DELIMITERS4', fg: 'CFC9BD' },
  { name: 'DELIMITERS5', fg: 'CFC9BD' },
  { name: 'DELIMITERS6', fg: 'CFC9BD' },
  { name: 'DELIMITERS7', fg: 'CFC9BD' },
  { name: 'DELIMITERS8', fg: 'CFC9BD' }
]

function buildScriptUdl(): string {
  const lists = keywordLists({
    // `00` line comment, `03`/`04` block comment. PZ's parser accepts both.
    Comments: '00// 03/* 04*/',
    'Numbers, extras1': '.',
    'Numbers, range': '-',
    Operators1: '= , : ; { } ( ) [ ] / | +',
    'Folders in code1, open': '{',
    'Folders in code1, close': '}',
    Keywords1: SCRIPT_BLOCKS.join(' '),
    Keywords2: SCRIPT_KEYS.join(' '),
    Keywords3: SCRIPT_VALUES.join(' '),
    Keywords4: RECIPE_MODIFIERS.join(' '),
    // A quoted tooltip, and `[…]` around the Lua hooks recipes call.
    Delimiters: '00" 01 02" 03[ 04 05]'
  })
  return wrap('PZ Script', 'txt', GLOBAL_SETTINGS, lists, styles(SCRIPT_STYLES))
}

/** `mod.info` keys, both builds. Everything else in the file is a value. */
const MODINFO_KEYS = [
  'name', 'id', 'description', 'poster', 'icon', 'url', 'author', 'versionMin',
  'versionMax', 'modversion', 'pzversion', 'require', 'tiledef', 'pack', 'category',
  'loadModAfter', 'loadModBefore', 'title', 'tags', 'excludeMap'
]

const MODINFO_STYLES: StyleSpec[] = [
  { name: 'DEFAULT', fg: 'CFC9BD' },
  { name: 'COMMENTS', fg: '6E6B64', style: 2 },
  { name: 'LINE COMMENTS', fg: '6E6B64', style: 2 },
  { name: 'NUMBERS', fg: 'BD9B32' },
  { name: 'KEYWORDS1', fg: 'C87A48', style: 1 },
  { name: 'KEYWORDS2', fg: '607F8F' },
  { name: 'KEYWORDS3', fg: '6F8757' },
  { name: 'KEYWORDS4', fg: 'CFC9BD' },
  { name: 'KEYWORDS5', fg: 'CFC9BD' },
  { name: 'KEYWORDS6', fg: 'CFC9BD' },
  { name: 'KEYWORDS7', fg: 'CFC9BD' },
  { name: 'KEYWORDS8', fg: 'CFC9BD' },
  { name: 'OPERATORS', fg: '9A958A' },
  { name: 'FOLDER IN CODE1', fg: 'C87A48' },
  { name: 'FOLDER IN CODE2', fg: 'C87A48' },
  { name: 'FOLDER IN COMMENT', fg: '6E6B64' },
  { name: 'DELIMITERS1', fg: '8F3A2E' },
  { name: 'DELIMITERS2', fg: 'CFC9BD' },
  { name: 'DELIMITERS3', fg: 'CFC9BD' },
  { name: 'DELIMITERS4', fg: 'CFC9BD' },
  { name: 'DELIMITERS5', fg: 'CFC9BD' },
  { name: 'DELIMITERS6', fg: 'CFC9BD' },
  { name: 'DELIMITERS7', fg: 'CFC9BD' },
  { name: 'DELIMITERS8', fg: 'CFC9BD' }
]

function buildModInfoUdl(): string {
  const lists = keywordLists({
    Comments: '00#',
    'Numbers, extras1': '.',
    Operators1: '= , :',
    Keywords1: MODINFO_KEYS.join(' '),
    // Build folder names, so a B41/B42 layout reads at a glance.
    Keywords2: '41 42 common',
    Keywords3: 'true false',
    Delimiters: '00" 01 02"'
  })
  return wrap('PZ ModInfo', 'info', GLOBAL_SETTINGS, lists, styles(MODINFO_STYLES))
}

const PACK: PackSpec[] = [
  { name: 'PZ Script.xml', label: 'PZ Script', build: buildScriptUdl },
  { name: 'PZ ModInfo.xml', label: 'PZ ModInfo', build: buildModInfoUdl }
]

/* --------------------------------------------------------------- status ---- */

function markerOf(text: string | undefined): string | undefined {
  return text ? new RegExp(`${MARKER}\\s+([\\w.\\-]+)`).exec(text)?.[1] : undefined
}

export async function nppStatus(settings: AppSettings): Promise<NppStatus> {
  const found = await locateExe(settings)
  const { dir: config, portable } = await configDir(found)
  const udlDir = join(config, UDL_DIR)

  const files: NppPackFile[] = []
  let installedVersion: string | undefined
  for (const spec of PACK) {
    const path = join(udlDir, spec.name)
    const text = await readTextSafe(path, 4096)
    const version = markerOf(text)
    if (version && !installedVersion) installedVersion = version
    let bytes = 0
    if (text !== undefined) {
      try {
        bytes = (await fs.stat(path)).size
      } catch {
        bytes = 0
      }
    }
    files.push({
      name: spec.name,
      path,
      label: spec.label,
      installed: text !== undefined,
      current: version === PACK_VERSION,
      bytes
    })
  }

  return {
    installed: Boolean(found),
    exePath: found?.exePath,
    version: found ? await readVersion() : undefined,
    configDir: config,
    udlDir,
    portable,
    source: found?.source,
    packVersion: PACK_VERSION,
    installedVersion,
    files
  }
}

/**
 * Write the pack.
 *
 * The destination is derived here and only here — no caller supplies a path. The
 * directory is created when missing, which is deliberate: installing the pack
 * before Notepad++ has ever run still works, and Notepad++ picks the files up on
 * its next start.
 */
export async function installNppPack(settings: AppSettings): Promise<NppInstallResult> {
  const status = await nppStatus(settings)
  const udlDir = status.udlDir ?? join(process.env['APPDATA'] ?? homedir(), 'Notepad++', UDL_DIR)
  await fs.mkdir(udlDir, { recursive: true })

  const written: string[] = []
  let bytes = 0
  for (const spec of PACK) {
    const path = join(udlDir, spec.name)
    const body = Buffer.from(spec.build(), 'utf8')
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, body)
    await fs.rename(tmp, path)
    written.push(path)
    bytes += body.length
  }
  return { udlDir, written, bytes }
}

/** The pack as text, so it can be read before it is installed. */
export function previewNppPack(): NppPackPreview[] {
  return PACK.map((spec) => ({ name: spec.name, label: spec.label, text: spec.build() }))
}

/* ----------------------------------------------------------------- open ---- */

/**
 * Open one file in Notepad++.
 *
 * The path is checked by the caller against the read allowlist; the executable
 * comes from detection, never from the renderer. `-n<line>` is Notepad++'s own
 * "go to line" switch and has to precede the file name.
 */
export async function openInNpp(settings: AppSettings, path: string, line?: number): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Notepad++ is Windows only')
  const found = await locateExe(settings)
  if (!found) throw new Error('Notepad++ was not found on this machine')
  if (!(await exists(path))) throw new Error(`File no longer exists: ${path}`)
  if (await isDir(path)) throw new Error(`Cannot open a folder in editor: ${path}`)

  const args: string[] = []
  if (line && line > 0) args.push(`-n${Math.trunc(line)}`)
  args.push(path)

  const child = spawn(found.exePath, args, {
    cwd: found.dir,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
}

/** True when `dir` looks like a Notepad++ install; used to validate a pick. */
export async function looksLikeNpp(dir: string): Promise<boolean> {
  if (!(await isDir(dir))) return false
  return exists(join(dir, EXE))
}

/**
 * Resolve one of the two paths this module owns, for revealing in Explorer.
 *
 * `%APPDATA%\Notepad++` and `%ProgramFiles%\Notepad++` are outside every mod
 * root, so the shared `shell:*` guard refuses them — correctly, since it has no
 * business allowing arbitrary paths. The renderer therefore asks by name and
 * gets back a path main derived itself, which is the same contract Loadout and
 * Ledger use for their files.
 */
export async function nppPathFor(settings: AppSettings, target: 'exe' | 'udl'): Promise<string> {
  const status = await nppStatus(settings)
  const path = target === 'exe' ? status.exePath : status.udlDir
  if (!path) throw new Error(target === 'exe' ? 'Notepad++ was not found' : 'No config folder to open')
  return path
}
