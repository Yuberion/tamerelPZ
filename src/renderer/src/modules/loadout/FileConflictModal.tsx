import { useMemo, useState } from 'react'
import type { ModEntry, ModFileOverwrite, ModOverwritesSummary, PatchBuildTarget } from '@shared/types'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { bareId } from './useLoadout'

interface FileConflictModalProps {
  activeModIds: string[]
  byModId: Map<string, ModEntry>
  overwritesSummary?: ModOverwritesSummary
  onPatchApplied?(patchModId: string): void
  onClose(): void
}

type FileCategory = 'all' | 'textures' | 'scripts' | 'lua' | 'models' | 'translations' | 'other'

export function isTranslationFile(relPath: string): boolean {
  const p = relPath.toLowerCase()
  return (
    p.includes('/translate/') ||
    p.includes('/translations/') ||
    p.startsWith('translate/') ||
    /(?:^|\/)[a-z0-9_-]+_(?:ru|en|de|fr|es|it|pl|pt|cn|jp|ko|tr|ua)\.(?:txt|json)$/i.test(p)
  )
}

function categorizeFile(relPath: string): FileCategory {
  if (isTranslationFile(relPath)) {
    return 'translations'
  }
  const p = relPath.toLowerCase()
  if (
    p.endsWith('.png') ||
    p.endsWith('.pack') ||
    p.endsWith('.dds') ||
    p.includes('/textures/') ||
    p.includes('/texturepacks/')
  ) {
    return 'textures'
  }
  if (p.endsWith('.lua') || p.includes('/lua/')) {
    return 'lua'
  }
  if (p.endsWith('.txt') || p.includes('/scripts/')) {
    return 'scripts'
  }
  if (
    p.endsWith('.x') ||
    p.endsWith('.fbx') ||
    p.endsWith('.bmd') ||
    p.endsWith('.anm') ||
    p.includes('/models/') ||
    p.includes('/anims/')
  ) {
    return 'models'
  }
  return 'other'
}

function getFileIcon(cat: FileCategory): IconName {
  switch (cat) {
    case 'translations':
      return 'globe'
    case 'textures':
      return 'palette'
    case 'lua':
      return 'book'
    case 'scripts':
      return 'code'
    case 'models':
      return 'cube'
    default:
      return 'file'
  }
}

export function FileConflictModal({
  byModId,
  overwritesSummary,
  onPatchApplied,
  onClose
}: FileConflictModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()

  const [activeCategory, setActiveCategory] = useState<FileCategory>('all')
  const [search, setSearch] = useState('')
  const [selectedMod, setSelectedMod] = useState('')

  // User chosen winners per collision (overriding default winner)
  const [userWinners, setUserWinners] = useState<Record<string, string>>({})

  // Patch Generation Dialog State
  const [showPatchConfig, setShowPatchConfig] = useState(false)
  const [buildTarget, setBuildTarget] = useState<PatchBuildTarget>('b42')
  const [patchModId, setPatchModId] = useState('Loadout_MergePatch_Port')
  const [patchName, setPatchName] = useState('Loadout Merge Patch [Port]')
  const [addToLoadout, setAddToLoadout] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [excludeTranslations, setExcludeTranslations] = useState(true)

  const collisions = overwritesSummary?.collisions ?? []

  // Resolve Mod Name helper
  const getModTitle = (rawId: string): string => {
    const bare = bareId(rawId)
    const m = byModId.get(bare)
    return m?.name ? `${m.name} (${bare})` : rawId
  }

  const getModShortName = (rawId: string): string => {
    const bare = bareId(rawId)
    const m = byModId.get(bare)
    return m?.name ?? bare
  }

  // Get active winner for a collision
  const getEffectiveWinner = (c: ModFileOverwrite): string => {
    if (userWinners[c.relPath]) return userWinners[c.relPath]
    // For item/recipe scripts: default to __MERGE__
    if (c.relPath.toLowerCase().includes('/scripts/') && c.relPath.toLowerCase().endsWith('.txt')) {
      return '__MERGE__'
    }
    return c.winner
  }

  // Set user winner
  const setWinner = (relPath: string, modId: string): void => {
    setUserWinners((prev) => ({ ...prev, [relPath]: modId }))
  }

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<FileCategory, number> = {
      all: collisions.length,
      textures: 0,
      scripts: 0,
      lua: 0,
      models: 0,
      translations: 0,
      other: 0
    }
    for (const c of collisions) {
      const cat = categorizeFile(c.relPath)
      counts[cat]++
    }
    return counts
  }, [collisions])

  // Mod list for dropdown (mods with overwrites)
  const modsWithCollisions = useMemo(() => {
    const set = new Set<string>()
    for (const c of collisions) {
      for (const p of c.providers) {
        set.add(p)
      }
    }
    return Array.from(set).sort((a, b) => getModShortName(a).localeCompare(getModShortName(b)))
  }, [collisions])

  // Filtered collisions
  const filteredCollisions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return collisions.filter((c) => {
      const cat = categorizeFile(c.relPath)

      // If user enabled excluding translations and is in 'all' view, omit translation files
      if (excludeTranslations && activeCategory === 'all' && cat === 'translations') {
        return false
      }

      // Category filter
      if (activeCategory !== 'all') {
        if (cat !== activeCategory) return false
      }
      // Mod filter
      if (selectedMod && !c.providers.includes(selectedMod)) {
        return false
      }
      // Search filter
      if (q) {
        const pathMatches = c.relPath.toLowerCase().includes(q)
        const modMatches = c.providers.some((p) => {
          const title = getModTitle(p).toLowerCase()
          return title.includes(q)
        })
        if (!pathMatches && !modMatches) return false
      }
      return true
    })
  }, [collisions, activeCategory, selectedMod, search, excludeTranslations])

  // Top overwriting mods stats
  const topOverwriters = useMemo(() => {
    if (!overwritesSummary) return []
    return Object.entries(overwritesSummary.overwritesOthers)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
  }, [overwritesSummary])

  // Handle Generate Merge Patch
  const handleGeneratePatch = async (): Promise<void> => {
    let cleanId = patchModId.trim() || 'Loadout_MergePatch_Port'
    if (!cleanId.includes('_Port')) {
      cleanId = `${cleanId}_Port`
    }

    setGenerating(true)
    try {
      const targetCollisions = excludeTranslations
        ? collisions.filter((c) => categorizeFile(c.relPath) !== 'translations')
        : collisions

      const selections = targetCollisions.map((c) => ({
        relPath: c.relPath,
        winnerModId: getEffectiveWinner(c)
      }))

      const res = await window.pz.loadout.createMergePatch({
        patchModId: cleanId,
        patchName: patchName.trim() || 'Loadout Merge Patch [Port]',
        buildTarget,
        selections,
        addToLoadout
      })

      if (res.errors && res.errors.length > 0) {
        console.warn('Merge patch warnings:', res.errors)
      }

      notify(
        isRu
          ? `Merge-патч успешно создан! Скопировано файлов: ${res.filesCopied}, объединено скриптов: ${res.scriptsMerged}`
          : `Merge patch created! Files copied: ${res.filesCopied}, scripts merged: ${res.scriptsMerged}`,
        'ok'
      )

      if (addToLoadout && onPatchApplied) {
        onPatchApplied(res.patchModId)
      }

      setShowPatchConfig(false)
      onClose()
    } catch (err) {
      notify(isRu ? `Ошибка создания патча: ${String(err)}` : `Failed to create patch: ${String(err)}`, 'warn')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--file-conflict" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 960 }}>
        {/* Header */}
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon name="layers" size={16} color="var(--amber, #f59e0b)" />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Инспектор конфликтов и перезаписи файлов (File Overwrites)' : 'File Overwrite & Collision Inspector'}
            </h3>
            <span className="lomlos-badge-count">{collisions.length}</span>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        {/* Informational banner */}
        <div className="lomodal__note" style={{ margin: '12px 18px 0', borderLeft: '3px solid var(--amber, #f59e0b)' }}>
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: '1.4' }}>
            {isRu ? (
              <>
                <strong>Правило оверлея Project Zomboid:</strong> мод, находящийся <strong>ниже</strong> в порядке загрузки, полностью заменяет совпадающие файлы (текстуры <code>.png</code>, текстурпаки <code>.pack</code>, скрипты предметов и код) у модов выше. Нажмите на плашку любого мода в строке, чтобы выбрать его победителем для Merge-патча.
              </>
            ) : (
              <>
                <strong>Project Zomboid Overlay Rule:</strong> the mod positioned <strong>lower</strong> in load order replaces matching files (textures <code>.png</code>, packs <code>.pack</code>, scripts, code) of mods above it. Click any mod in a row to choose it as the patch winner.
              </>
            )}
          </p>
        </div>

        {/* Top overwriters quick summary */}
        {topOverwriters.length > 0 && (
          <div className="fcol-top-summary">
            <span className="label is-dim">{isRu ? 'Больше всего перезаписывают:' : 'Top overwriting mods:'}</span>
            <div className="fcol-top-chips">
              {topOverwriters.map(([id, count]) => (
                <button
                  key={id}
                  className={`chip ${selectedMod === id ? 'is-on' : ''}`}
                  onClick={() => setSelectedMod(selectedMod === id ? '' : id)}
                  title={getModTitle(id)}
                >
                  <span className="bold">{getModShortName(id)}</span>
                  <span className="chip__n mono">+{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div className="lomodal__tabs" style={{ padding: '0 18px', borderBottom: '1px solid var(--border)' }}>
          <button
            className={`lotab ${activeCategory === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            {isRu ? 'Все конфликты' : 'All Conflicts'} ({categoryCounts.all})
          </button>
          <button
            className={`lotab ${activeCategory === 'textures' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('textures')}
          >
            <Icon name="palette" size={11} color="var(--amber)" />
            {isRu ? 'Текстуры & Паки' : 'Textures & Packs'} ({categoryCounts.textures})
          </button>
          <button
            className={`lotab ${activeCategory === 'scripts' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('scripts')}
          >
            <Icon name="code" size={11} color="var(--blue-light)" />
            {isRu ? 'Скрипты' : 'Scripts'} ({categoryCounts.scripts})
          </button>
          <button
            className={`lotab ${activeCategory === 'lua' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('lua')}
          >
            <Icon name="book" size={11} color="var(--pine)" />
            {isRu ? 'Lua код' : 'Lua Code'} ({categoryCounts.lua})
          </button>
          <button
            className={`lotab ${activeCategory === 'models' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('models')}
          >
            <Icon name="cube" size={11} color="var(--rust)" />
            {isRu ? '3D Модели' : '3D Models'} ({categoryCounts.models})
          </button>
          {categoryCounts.translations > 0 && (
            <button
              className={`lotab ${activeCategory === 'translations' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('translations')}
              title={isRu ? 'Файлы локализации (безопасные оверрайды модов-русификаторов)' : 'Translation files (safe localization overrides)'}
            >
              <Icon name="globe" size={11} color="var(--sky, #38bdf8)" />
              {isRu ? 'Переводы' : 'Translations'} ({categoryCounts.translations})
            </button>
          )}
          {categoryCounts.other > 0 && (
            <button
              className={`lotab ${activeCategory === 'other' ? 'is-active' : ''}`}
              onClick={() => setActiveCategory('other')}
            >
              {isRu ? 'Прочее' : 'Other'} ({categoryCounts.other})
            </button>
          )}
        </div>

        {/* Filters bar */}
        <div className="fcol-filters-bar">
          <div className="minisearch" style={{ flex: 1, minWidth: 200 }}>
            <Icon name="search" size={12} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRu ? 'Поиск по пути к файлу или названию мода…' : 'Search by file path or mod name…'}
              spellCheck={false}
            />
            {search && (
              <button className="minisearch__clear" onClick={() => setSearch('')}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.78rem',
              cursor: 'pointer',
              color: excludeTranslations ? 'var(--pine, #22c55e)' : 'var(--text-muted)',
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: excludeTranslations ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
              userSelect: 'none'
            }}
            title={
              isRu
                ? 'Моды-русификаторы намеренно заменяют файлы оригинальных модов для перевода интерфейса и предметов. Это штатное поведение, безопасное для игры.'
                : 'Localization mods intentionally override files to provide translations. This is safe behavior.'
            }
          >
            <input
              type="checkbox"
              checked={excludeTranslations}
              onChange={(e) => setExcludeTranslations(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>{isRu ? 'Исключить переводы (безопасно)' : 'Exclude translations (safe)'}</span>
          </label>

          <div className="pick" style={{ minWidth: 240 }}>
            <select
              className="select select--tiny"
              value={selectedMod}
              onChange={(e) => setSelectedMod(e.target.value)}
            >
              <option value="">{isRu ? 'Все моды с коллизиями' : 'All colliding mods'} ({modsWithCollisions.length})</option>
              {modsWithCollisions.map((id) => (
                <option key={id} value={id}>
                  {getModShortName(id)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Body / List */}
        <div className="lomodal__body fcol-body" style={{ maxHeight: 460, overflowY: 'auto', padding: '12px 18px' }}>
          {filteredCollisions.length === 0 ? (
            <div className="pane__empty" style={{ padding: '40px 0' }}>
              <Icon name="check" size={28} color="var(--pine, #22c55e)" />
              <span className="label bold">
                {isRu ? 'Конфликтов файлов не обнаружено' : 'No file collisions found'}
              </span>
              <span className="label wbmuted">
                {isRu
                  ? 'В выбранной категории файлы модов не пересекаются между собой.'
                  : 'Mod files in this category do not overlap with each other.'}
              </span>
            </div>
          ) : (
            <div className="fcol-list">
              {filteredCollisions.map((collision: ModFileOverwrite, idx) => {
                const cat = categorizeFile(collision.relPath)
                const icon = getFileIcon(cat)
                const effectiveWinner = getEffectiveWinner(collision)
                const isScript = cat === 'scripts' && collision.relPath.toLowerCase().endsWith('.txt')

                return (
                  <div key={idx} className="fcol-card">
                    <div className="fcol-card__header">
                      <Icon name={icon} size={13} className="fcol-card__icon" />
                      <span className="fcol-card__path mono" title={collision.relPath}>
                        {collision.relPath}
                      </span>

                      {/* Script Merge Toggle Button */}
                      {isScript && (
                        <button
                          className={`btn btn--tiny ${effectiveWinner === '__MERGE__' ? 'btn--active' : 'btn--subtle'}`}
                          onClick={() => setWinner(collision.relPath, effectiveWinner === '__MERGE__' ? collision.winner : '__MERGE__')}
                          title={isRu ? 'Объединить свойства предметов/рецептов из всех модов' : 'Merge properties from all supplying mods'}
                          style={{ fontSize: '0.72rem', padding: '1px 6px' }}
                        >
                          <Icon name="wrench" size={10} color="var(--amber)" />
                          {isRu ? '⚡ Авто-Слияние' : '⚡ Auto-Merge'}
                        </button>
                      )}

                      {cat === 'translations' && (
                        <span
                          className="ledpill mono"
                          style={{
                            fontSize: '0.70rem',
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: 'var(--sky, #38bdf8)',
                            borderColor: 'rgba(56, 189, 248, 0.3)'
                          }}
                          title={isRu ? 'Мод локализации переопределяет перевод. Ошибок не вызывает.' : 'Localization mod override. Safe.'}
                        >
                          {isRu ? 'Локализация (безопасно)' : 'Localization (safe)'}
                        </span>
                      )}

                      <span className="ledpill mono" style={{ fontSize: '0.72rem' }}>
                        {collision.providers.length} {isRu ? 'провайдера' : 'providers'}
                      </span>
                    </div>

                    <div className="fcol-card__chain">
                      {collision.providers.map((p, pIdx) => {
                        const isWinner = p === effectiveWinner
                        const isOriginalWinner = p === collision.winner
                        const isLast = pIdx === collision.providers.length - 1
                        const modName = getModShortName(p)

                        return (
                          <div key={pIdx} className="fcol-chain-item">
                            <button
                              type="button"
                              className={`fcol-provider btn--subtle ${isWinner ? 'is-winner' : 'is-overwritten'}`}
                              onClick={() => setWinner(collision.relPath, p)}
                              title={isRu ? `Кликните, чтобы выбрать этот файл победителем патча` : `Click to choose this file for the merge patch`}
                            >
                              <span className="fcol-provider__pos mono">#{pIdx + 1}</span>
                              <span className="fcol-provider__name bold" title={getModTitle(p)}>
                                {modName}
                              </span>
                              <span className={`fcol-provider__badge ${isWinner ? 'badge-winner' : 'badge-lost'}`}>
                                {isWinner
                                  ? (isRu ? '🏆 В патче' : '🏆 Selected')
                                  : isOriginalWinner
                                    ? (isRu ? 'Побеждал' : 'Engine winner')
                                    : (isRu ? 'Затёрт' : 'Overwritten')}
                              </span>
                            </button>
                            {!isLast && <Icon name="arrow-right" size={12} className="fcol-chain-arrow" />}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="lomodal__foot">
          <span className="wbmuted" style={{ fontSize: '0.8rem' }}>
            {isRu
              ? `Конфликтов: ${filteredCollisions.length} из ${collisions.length}`
              : `Collisions: ${filteredCollisions.length} of ${collisions.length}`}
          </span>
          <div className="toolbar__spacer" />
          <button
            className="btn is-primary"
            onClick={() => setShowPatchConfig(true)}
            disabled={collisions.length === 0}
            title={isRu ? 'Создать изолированный патч совместимости _Port' : 'Generate an isolated _Port compatibility patch'}
          >
            <Icon name="wrench" size={12} />
            {isRu ? '⚡ Создать Merge-патч' : '⚡ Generate Merge Patch'}
          </button>
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
        </div>

        {/* Patch Configuration Modal Overlay */}
        {showPatchConfig && (
          <div className="lomodal-backdrop" style={{ zIndex: 1050 }} onClick={() => setShowPatchConfig(false)}>
            <div
              className="lomodal lomodal--presets"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 520, animation: 'fadeIn 0.15s ease' }}
            >
              <div className="lomodal__head">
                <div className="lomodal__titlebox">
                  <Icon name="wrench" size={15} color="var(--amber, #f59e0b)" />
                  <h3 className="lomodal__title stencil">
                    {isRu ? 'Генератор Merge-патча' : 'Merge Patch Generator'}
                  </h3>
                </div>
                <button className="btn btn-icon" onClick={() => setShowPatchConfig(false)}>
                  <Icon name="close" size={12} />
                </button>
              </div>

              <div className="lomodal__body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="lomodal__note" style={{ margin: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.82rem' }}>
                    {isRu
                      ? 'Мод совместимости сохранит выбранные текстуры от затирания и объединит свойства скриптов предметов. Мод создаётся в папке Zomboid/mods и ставится в самый конец списка загрузки.'
                      : 'The compatibility patch preserves selected textures from being overwritten and merges item script properties. Created in Zomboid/mods and loaded last.'}
                  </p>
                </div>

                <div className="form-group">
                  <label className="label">{isRu ? 'Имя папки и Mod ID (обязателен маркер _Port):' : 'Mod ID (strictly requires _Port):'}</label>
                  <input
                    className="input mono"
                    value={patchModId}
                    onChange={(e) => setPatchModId(e.target.value)}
                    placeholder="Loadout_MergePatch_Port"
                  />
                </div>

                {/* Target Build Selector */}
                <div className="form-group">
                  <label className="label">
                    {isRu ? 'Целевая версия игры (Структура папок мода):' : 'Target Game Build (Folder Layout):'}
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className={`btn ${buildTarget === 'b42' ? 'btn--active' : 'btn--subtle'}`}
                      onClick={() => setBuildTarget('b42')}
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '8px 10px',
                        height: 'auto',
                        textAlign: 'left',
                        border: buildTarget === 'b42' ? '1px solid var(--amber, #f59e0b)' : undefined
                      }}
                    >
                      <span className="bold" style={{ color: buildTarget === 'b42' ? 'var(--amber)' : undefined }}>
                        ★ Build 42
                      </span>
                      <span className="wbmuted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                        {isRu ? 'Каноничный (42/ + common/)' : 'Canonical (42/ & common/)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`btn ${buildTarget === 'b41' ? 'btn--active' : 'btn--subtle'}`}
                      onClick={() => setBuildTarget('b41')}
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '8px 10px',
                        height: 'auto',
                        textAlign: 'left',
                        border: buildTarget === 'b41' ? '1px solid var(--amber, #f59e0b)' : undefined
                      }}
                    >
                      <span className="bold" style={{ color: buildTarget === 'b41' ? 'var(--amber)' : undefined }}>
                        Build 41
                      </span>
                      <span className="wbmuted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                        {isRu ? 'Классический (media/)' : 'Legacy root media/'}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`btn ${buildTarget === 'hybrid' ? 'btn--active' : 'btn--subtle'}`}
                      onClick={() => setBuildTarget('hybrid')}
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '8px 10px',
                        height: 'auto',
                        textAlign: 'left',
                        border: buildTarget === 'hybrid' ? '1px solid var(--amber, #f59e0b)' : undefined
                      }}
                    >
                      <span className="bold" style={{ color: buildTarget === 'hybrid' ? 'var(--amber)' : undefined }}>
                        Гибрид (B42+41)
                      </span>
                      <span className="wbmuted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                        {isRu ? 'Двойной оверлей' : 'Dual Overlay'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="label">{isRu ? 'Отображаемое название мода:' : 'Mod Display Name:'}</label>
                  <input
                    className="input"
                    value={patchName}
                    onChange={(e) => setPatchName(e.target.value)}
                    placeholder="Loadout Merge Patch [Port]"
                  />
                </div>

                <label className="loreport-option" style={{ marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={addToLoadout}
                    onChange={(e) => setAddToLoadout(e.target.checked)}
                  />
                  <span>
                    {isRu
                      ? 'Автоматически дописать патч в самый конец списка загрузки (default.txt)'
                      : 'Automatically append patch to the end of active load order (default.txt)'}
                  </span>
                </label>

                <div className="fcol-patch-preview-stats" style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: 4, border: '1px solid var(--border)' }}>
                  <span className="label is-dim" style={{ marginBottom: 6 }}>{isRu ? 'Будет включено в патч:' : 'Will be included in patch:'}</span>
                  <div style={{ display: 'flex', gap: 14, fontSize: '0.82rem' }}>
                    <span>🎨 <strong>{categoryCounts.textures}</strong> {isRu ? 'текстур' : 'textures'}</span>
                    <span>📜 <strong>{categoryCounts.scripts}</strong> {isRu ? 'скриптов' : 'scripts'}</span>
                    <span>🧩 <strong>{categoryCounts.models + categoryCounts.lua + categoryCounts.other}</strong> {isRu ? 'прочих ассетов' : 'other assets'}</span>
                  </div>
                </div>
              </div>

              <div className="lomodal__foot">
                <button className="btn" onClick={() => setShowPatchConfig(false)} disabled={generating}>
                  {isRu ? 'Отмена' : 'Cancel'}
                </button>
                <div className="toolbar__spacer" />
                <button
                  className="btn is-primary"
                  onClick={() => void handleGeneratePatch()}
                  disabled={generating}
                >
                  <Icon name={generating ? 'refresh' : 'check'} size={12} className={generating ? 'spin' : undefined} />
                  {generating
                    ? (isRu ? 'Генерация патча…' : 'Generating patch…')
                    : (isRu ? 'Сгенерировать и применить' : 'Generate & Apply')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
