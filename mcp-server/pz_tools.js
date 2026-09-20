import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, cpSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';

const GAME_JAR = process.env.PZ_GAME_JAR || 'E:\\SteamLibrary\\steamapps\\common\\ProjectZomboid\\projectzomboid.jar';
const USER_MODS_DIR = process.env.PZ_USER_MODS || 'C:\\Users\\tamer\\Zomboid\\mods';
const CACHE_DIR = join(resolve('.'), '.cache', 'decompile');

// Load canonical events
let CANONICAL_EVENTS = [];
try {
  const evPath = new URL('./events.json', import.meta.url);
  CANONICAL_EVENTS = JSON.parse(readFileSync(evPath, 'utf8'));
} catch {
  CANONICAL_EVENTS = [];
}

/**
 * Tool 1: Decompile Java class from projectzomboid.jar
 */
export function decompileClass({ className, methodFilter }) {
  if (!className || typeof className !== 'string') {
    throw new Error('className is required (e.g. zombie.characters.IsoPlayer)');
  }

  const cleanName = className.trim();
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${cleanName.replace(/[^a-zA-Z0-9_]/g, '_')}.txt`);

  let fullOutput = '';
  if (existsSync(cacheFile)) {
    fullOutput = readFileSync(cacheFile, 'utf8');
  } else {
    try {
      fullOutput = execSync(`javap -cp "${GAME_JAR}" -p -c "${cleanName}"`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      });
      writeFileSync(cacheFile, fullOutput, 'utf8');
    } catch (err) {
      return {
        error: `Failed to decompile class ${cleanName}: ${err.message}`,
        output: err.stdout || err.stderr || ''
      };
    }
  }

  if (!methodFilter) {
    // Truncate to reasonable size if very large
    const lines = fullOutput.split('\n');
    if (lines.length > 300) {
      return {
        className: cleanName,
        totalLines: lines.length,
        notice: 'Output truncated. Use methodFilter to inspect specific methods.',
        preview: lines.slice(0, 250).join('\n')
      };
    }
    return { className: cleanName, decompiled: fullOutput };
  }

  // Filter by method or pattern
  const filterRegex = new RegExp(methodFilter, 'i');
  const lines = fullOutput.split('\n');
  const matchingBlocks = [];
  let currentBlock = [];
  let recording = false;

  for (const line of lines) {
    if (/^\s*(public|protected|private|static|\/\*)/.test(line) && line.includes('(')) {
      if (currentBlock.length && recording) {
        matchingBlocks.push(currentBlock.join('\n'));
      }
      currentBlock = [line];
      recording = filterRegex.test(line);
    } else {
      currentBlock.push(line);
      if (!recording && filterRegex.test(line)) {
        recording = true;
      }
    }
  }
  if (currentBlock.length && recording) {
    matchingBlocks.push(currentBlock.join('\n'));
  }

  return {
    className: cleanName,
    filter: methodFilter,
    matchesCount: matchingBlocks.length,
    results: matchingBlocks.slice(0, 15).join('\n\n---\n\n')
  };
}

/**
 * Tool 2: Lookup Lua Events in canonical engine database
 */
export function lookupEvent({ query }) {
  if (!query) {
    return {
      totalEvents: CANONICAL_EVENTS.length,
      sampleEvents: CANONICAL_EVENTS.slice(0, 25)
    };
  }

  const q = query.toLowerCase();
  const matched = CANONICAL_EVENTS.filter((e) => e.toLowerCase().includes(q));

  return {
    query,
    matchedCount: matched.length,
    events: matched
  };
}

/**
 * Tool 3: Validate item / weapon script for Build 42
 */
export function validateItemScript({ filePath, content }) {
  let text = content;
  if (!text && filePath && existsSync(filePath)) {
    text = readFileSync(filePath, 'utf8');
  }
  if (!text) {
    throw new Error('Either filePath or content must be provided');
  }

  const issues = [];
  const lines = text.split('\n');

  let openBrackets = 0;
  let inItem = false;
  let currentItemName = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    const line = rawLine.trim();

    // Bracket check
    for (const ch of line) {
      if (ch === '{') openBrackets++;
      if (ch === '}') openBrackets--;
    }

    // Detect item start
    const itemMatch = line.match(/^item\s+([A-Za-z0-9_]+)/i);
    if (itemMatch) {
      inItem = true;
      currentItemName = itemMatch[1];
    }

    if (inItem) {
      // Check for B41 legacy Type = Normal
      if (/^\bType\s*=\s*Normal\b/i.test(line)) {
        issues.push({
          line: lineNum,
          item: currentItemName,
          severity: 'warning',
          message: 'B41 legacy "Type = Normal". In Build 42, use "ItemType = base:normal,".'
        });
      }

      // Check missing namespace on ItemType
      const itemTypeMatch = line.match(/^\bItemType\s*=\s*([^,;]+)/i);
      if (itemTypeMatch) {
        const val = itemTypeMatch[1].trim();
        if (!val.includes(':') && !['weapon', 'normal', 'drainable', 'food', 'clothing', 'container'].includes(val.toLowerCase())) {
          issues.push({
            line: lineNum,
            item: currentItemName,
            severity: 'warning',
            message: `ItemType "${val}" lacks namespace. In B42, use "base:${val}".`
          });
        }
      }

      // Check BodyLocation namespace
      const bodyLocMatch = line.match(/^\bBodyLocation\s*=\s*([^,;]+)/i);
      if (bodyLocMatch) {
        const val = bodyLocMatch[1].trim();
        if (!val.includes(':')) {
          issues.push({
            line: lineNum,
            item: currentItemName,
            severity: 'info',
            message: `BodyLocation "${val}" recommended to use B42 namespace "base:${val.toLowerCase()}".`
          });
        }
      }
    }
  }

  if (openBrackets !== 0) {
    issues.push({
      line: lines.length,
      severity: 'error',
      message: `Unbalanced brackets: delta = ${openBrackets}`
    });
  }

  return {
    valid: issues.filter((x) => x.severity === 'error').length === 0,
    issuesCount: issues.length,
    issues
  };
}

/**
 * Tool 4: Validate sandbox-options.txt
 */
export function validateSandboxOptions({ filePath }) {
  if (!filePath || !existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rawBytes = readFileSync(filePath);
  const hasBom = rawBytes.length >= 3 && rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF;
  const text = rawBytes.toString('utf8');

  const issues = [];
  if (hasBom) {
    issues.push({
      severity: 'error',
      message: 'File contains UTF-8 BOM. Project Zomboid ScriptParser crashes on BOM. Save as clean UTF-8 without BOM.'
    });
  }

  const firstNonEmpty = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));
  if (!firstNonEmpty) {
    issues.push({ severity: 'error', message: 'File is empty or contains only comments.' });
  } else if (!/^VERSION\s*=\s*1\s*,/i.test(firstNonEmpty)) {
    issues.push({
      severity: 'error',
      message: `Invalid header "${firstNonEmpty}". Project Zomboid requires "VERSION = 1," (with trailing comma!).`
    });
  }

  return {
    filePath,
    valid: issues.filter((x) => x.severity === 'error').length === 0,
    hasBom,
    issues
  };
}

/**
 * Tool 5: Safely Sync Port Mod to Game mods folder with BOM and Cyrillic audit
 */
export function syncPortMod({ sourceModPath, targetModName }) {
  if (!sourceModPath || !existsSync(sourceModPath)) {
    throw new Error(`sourceModPath does not exist: ${sourceModPath}`);
  }

  const base = basename(resolve(sourceModPath));
  if (!base.includes('_Port')) {
    throw new Error(`Highest priority rule violation: source directory name "${base}" must contain "_Port"!`);
  }

  const modName = targetModName || base;
  const destDir = join(USER_MODS_DIR, modName);

  // Hygiene checks on source before copying
  const audit = auditHygiene({ modPath: sourceModPath });
  if (audit.criticalErrors && audit.criticalErrors.length > 0) {
    return {
      success: false,
      error: 'Hygiene audit failed. Fix critical errors before syncing.',
      criticalErrors: audit.criticalErrors
    };
  }

  mkdirSync(destDir, { recursive: true });
  cpSync(sourceModPath, destDir, { recursive: true, force: true });

  return {
    success: true,
    source: sourceModPath,
    destination: destDir,
    auditSummary: {
      warningsCount: audit.warnings.length,
      bomCount: audit.bomsFound.length,
      cyrillicViolationsCount: audit.cyrillicViolations.length
    }
  };
}

/**
 * Tool 6: Audit Mod Hygiene (Cyrillic outside RU, BOMs, B42 layout, versionMax)
 */
export function auditHygiene({ modPath }) {
  if (!modPath || !existsSync(modPath)) {
    throw new Error(`modPath does not exist: ${modPath}`);
  }

  const warnings = [];
  const criticalErrors = [];
  const bomsFound = [];
  const cyrillicViolations = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (['.git', 'node_modules', '.cache'].includes(ent.name)) continue;
      const fullPath = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(fullPath);
      } else if (ent.isFile()) {
        const ext = ent.name.split('.').pop()?.toLowerCase();
        if (['txt', 'lua', 'xml', 'json', 'info'].includes(ext)) {
          const bytes = readFileSync(fullPath);
          // Check BOM
          if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            bomsFound.push(fullPath);
            criticalErrors.push(`UTF-8 BOM detected in: ${fullPath}`);
          }

          // Check Cyrillic outside RU translation
          const relPosix = relative(modPath, fullPath).replace(/\\/g, '/');
          const isAllowedRu = /(?:^|\/)Translate\/RU\//i.test(relPosix) || /(?:^|\/)translate\/ru\//i.test(relPosix);
          if (!isAllowedRu) {
            const text = bytes.toString('utf8');
            if (/[\u0400-\u04FF]/.test(text)) {
              cyrillicViolations.push(fullPath);
              criticalErrors.push(`Cyrillic characters detected outside Translate/RU in: ${fullPath}`);
            }
          }

          // Check mod.info for versionMax
          if (ent.name === 'mod.info') {
            const text = bytes.toString('utf8');
            if (/versionMax\s*=/i.test(text)) {
              warnings.push(`mod.info contains "versionMax=", which breaks on newer B42 builds. Remove versionMax.`);
            }
          }
        }
      }
    }
  }

  walk(modPath);

  return {
    modPath,
    passed: criticalErrors.length === 0,
    criticalErrors,
    warnings,
    bomsFound,
    cyrillicViolations
  };
}
