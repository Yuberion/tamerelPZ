import { useState, useMemo } from 'react'
import type { ModEntry, ModOverwritesSummary, SortingRule } from '@shared/types'
import { pzFileUrl } from '@shared/ipc'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { SOURCE_META } from '@renderer/lib/catmeta'
import { copyText } from '@renderer/lib/format'
import { CATEGORY_META, detectMlosCategory } from './mlos'
import { bareId } from './useLoadout'

export interface ModDetailPanelProps {
  mod: ModEntry | undefined
  rule?: SortingRule
  onEditRule?: (modId: string) => void
  onClose: () => void
  activeMods: string[]
  onAddRequirement?: (modId: string) => void
  overwritesSummary?: ModOverwritesSummary
}

export function ModDetailPanel({
  mod,
  rule,
  onEditRule,
  onClose,
  activeMods,
  onAddRequirement,
  overwritesSummary
}: ModDetailPanelProps) {
  const { lang } = useI18n()
  const { notify } = useToast()
  const isRu = lang === 'ru'
  const [posterFailed, setPosterFailed] = useState(false)

  const activeSet = useMemo(() => {
    return new Set(activeMods.map((m) => m.trim().toLowerCase()))
  }, [activeMods])

  const artwork = useMemo(() => {
    if (!mod) return undefined
    if (!posterFailed && mod.posterPath) return mod.posterPath
    return mod.iconPath ?? mod.posterPath
  }, [mod, posterFailed])

  const copyVal = async (text: string, label: string): Promise<void> => {
    await copyText(text)
    notify(isRu ? `${label} скопирован` : `${label} copied`, 'ok')
  }

  const openWorkshop = (id: string): void => {
    void window.pz.shell.external(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`)
  }

  const openFolder = (path: string): void => {
    void window.pz.shell.reveal(path)
  }

  const modId = mod?.modId ?? mod?.folderName
  const mlosCat = mod ? detectMlosCategory(mod, rule?.category) : undefined
  const catMeta = mlosCat ? CATEGORY_META[mlosCat] : undefined
  const src = mod ? SOURCE_META[mod.sourceKind] : undefined

  const overwriteInfo = useMemo(() => {
    if (!mod || !overwritesSummary || !modId) return null
    const id = modId.toLowerCase()
    const overwriting: Array<{ relPath: string; earlier: string[] }> = []
    const overwrittenBy: Array<{ relPath: string; winner: string }> = []

    for (const c of overwritesSummary.collisions) {
      const matchMod = (val: string) => val.toLowerCase() === id || bareId(val) === bareId(id)
      const isWinner = matchMod(c.winner)
      const hasProvider = c.providers.some(matchMod)

      if (isWinner && c.providers.length > 1) {
        const earlier = c.providers.filter((p) => !matchMod(p))
        overwriting.push({ relPath: c.relPath, earlier })
      } else if (hasProvider && !isWinner) {
        overwrittenBy.push({ relPath: c.relPath, winner: c.winner })
      }
    }

    return { overwriting, overwrittenBy }
  }, [mod, overwritesSummary, modId])

  return (
    <div className="lodetail-panel">
      <div className="pane__head">
        <Icon name="image" size={13} color="var(--rust-hot)" />
        <span className="pane__title stencil">{isRu ? 'ИНФО И ПРЕВЬЮ' : 'MOD DETAILS'}</span>

        <div className="pane__head-spacer" />

        {mod && (
          <>
            {mod.workshopId && (
              <button
                className="btn btn-icon"
                onClick={() => openWorkshop(mod.workshopId!)}
                title={isRu ? 'Открыть в Steam Workshop' : 'Open in Steam Workshop'}
              >
                <Icon name="globe" size={12} />
              </button>
            )}
            <button
              className="btn btn-icon"
              onClick={() => openFolder(mod.path)}
              title={isRu ? 'Показать папку в Проводнике' : 'Reveal in Explorer'}
            >
              <Icon name="external" size={12} />
            </button>
          </>
        )}

        <button
          className="btn btn-icon"
          onClick={onClose}
          title={isRu ? 'Закрыть панель' : 'Close panel'}
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="pane__scroll pane__scroll--pad lodetail-body">
        {!mod ? (
          <div className="pane__empty pane__empty--big">
            <Icon name="info" size={30} strokeWidth={1.2} />
            <span className="label">
              {isRu
                ? 'Выберите мод в списке для просмотра превью и деталей'
                : 'Select a mod to inspect preview and details'}
            </span>
          </div>
        ) : (
          <div className="lodetail-content">
            {/* Poster / Artwork */}
            <div className="lodetail-poster brackets">
              {artwork ? (
                <img
                  src={pzFileUrl(artwork)}
                  alt={mod.name}
                  onError={() => setPosterFailed(true)}
                  draggable={false}
                />
              ) : (
                <div className="lodetail-poster-empty">
                  <Icon name="image" size={28} />
                  <span className="label wbmuted">{isRu ? 'Нет превью' : 'No poster'}</span>
                </div>
              )}

              <div className="lodetail-poster-badges">
                {catMeta && (
                  <span
                    className="lomlos-badge"
                    style={{ color: catMeta.color, background: catMeta.bg }}
                    title={`MLOS Category: ${isRu ? catMeta.labelRu : catMeta.labelEn}`}
                  >
                    {isRu ? catMeta.labelRu : catMeta.labelEn}
                  </span>
                )}
                {mod.builds?.length > 0 && (
                  <span className="bbadge bbadge--b42">{mod.builds.join(' · ')}</span>
                )}
              </div>
            </div>

            {/* Mod Header */}
            <div className="lodetail-header">
              <h2 className="lodetail-title" title={mod.name}>
                {mod.name}
              </h2>
              {mod.authors && (
                <span className="label wbmuted">
                  {isRu ? 'Автор:' : 'Author:'}{' '}
                  <span className="lodetail-author">{mod.authors}</span>
                </span>
              )}
            </div>

            {/* Quick Metadata Grid */}
            <div className="lodetail-meta-card">
              <div className="lodetail-meta-row">
                <span className="label is-dim">{isRu ? 'ID мода:' : 'Mod ID:'}</span>
                <span className="lodetail-meta-val mono truncate">{modId}</span>
                <button
                  className="btn btn-icon btn--tiny"
                  onClick={() => void copyVal(modId!, 'Mod ID')}
                  title={isRu ? 'Скопировать Mod ID' : 'Copy Mod ID'}
                >
                  <Icon name="copy" size={11} />
                </button>
              </div>

              {mod.workshopId && (
                <div className="lodetail-meta-row">
                  <span className="label is-dim">{isRu ? 'Workshop ID:' : 'Workshop ID:'}</span>
                  <span className="lodetail-meta-val mono truncate">{mod.workshopId}</span>
                  <button
                    className="btn btn-icon btn--tiny"
                    onClick={() => void copyVal(mod.workshopId!, 'Workshop ID')}
                    title={isRu ? 'Скопировать Workshop ID' : 'Copy Workshop ID'}
                  >
                    <Icon name="copy" size={11} />
                  </button>
                  <button
                    className="btn btn-icon btn--tiny"
                    onClick={() => openWorkshop(mod.workshopId!)}
                    title={isRu ? 'Открыть в Steam' : 'Open in Steam'}
                  >
                    <Icon name="globe" size={11} />
                  </button>
                </div>
              )}

              <div className="lodetail-meta-row">
                <span className="label is-dim">{isRu ? 'Источник:' : 'Source:'}</span>
                <span
                  className="lodetail-meta-val"
                  style={src ? { color: src.color } : undefined}
                >
                  {src?.glyph} {mod.sourceKind}
                </span>
                <span className="toolbar__spacer" />
                <button
                  className="btn btn-icon btn--tiny"
                  onClick={() => openFolder(mod.path)}
                  title={isRu ? 'Открыть папку' : 'Open folder'}
                >
                  <Icon name="folder" size={11} />
                </button>
              </div>

              {(mod.pzVersion || mod.modVersion) && (
                <div className="lodetail-meta-row">
                  <span className="label is-dim">{isRu ? 'Версия:' : 'Version:'}</span>
                  <span className="lodetail-meta-val mono">
                    {mod.modVersion ?? '—'}
                    {mod.pzVersion ? ` (PZ ${mod.pzVersion})` : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Requirements / Dependencies */}
            <div className="lodetail-section">
              <div className="lodetail-sec-head">
                <span className="label stencil">
                  {isRu ? 'Зависимости (require):' : 'Requirements (require):'}
                </span>
                <span className="mono label is-dim">({mod.requires.length})</span>
              </div>

              {mod.requires.length === 0 ? (
                <span className="label wbmuted is-italic">
                  {isRu ? 'Не требует других модов' : 'No requirements declared'}
                </span>
              ) : (
                <div className="lodetail-reqs-list">
                  {mod.requires.map((reqId) => {
                    const isLoaded = activeSet.has(reqId.trim().toLowerCase())
                    return (
                      <div key={reqId} className="lodetail-req-item">
                        <Icon
                          name={isLoaded ? 'check' : 'alert'}
                          size={12}
                          color={isLoaded ? 'var(--moss)' : 'var(--ember)'}
                        />
                        <span className="lodetail-req-name mono truncate">{reqId}</span>
                        <span className={`lodetail-req-status ${isLoaded ? 'is-ok' : 'is-warn'}`}>
                          {isLoaded
                            ? isRu
                              ? 'В списке'
                              : 'In order'
                            : isRu
                              ? 'Не в списке'
                              : 'Not in order'}
                        </span>
                        {!isLoaded && onAddRequirement && (
                          <button
                            className="btn btn--tiny"
                            onClick={() => onAddRequirement(reqId)}
                            title={
                              isRu
                                ? 'Добавить эту зависимость в порядок'
                                : 'Add requirement to load order'
                            }
                          >
                            <Icon name="plus" size={10} />
                            {isRu ? 'Добавить' : 'Add'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* MLOS Sorting Rules */}
            <div className="lodetail-section">
              <div className="lodetail-sec-head">
                <span className="label stencil">{isRu ? 'Правило MLOS:' : 'MLOS Rule:'}</span>
                {onEditRule && modId && (
                  <button
                    className="btn btn--tiny"
                    onClick={() => onEditRule(modId)}
                    title={isRu ? 'Настроить правила' : 'Edit rules'}
                  >
                    <Icon name="wrench" size={10} color="var(--rust-hot)" />
                    {rule
                      ? isRu
                        ? 'Изменить правило'
                        : 'Edit Rule'
                      : isRu
                        ? 'Задать правило'
                        : 'Set Rule'}
                  </button>
                )}
              </div>

              {rule ? (
                <div className="lodetail-rule-card">
                  {rule.loadAfter?.length ? (
                    <div className="lodetail-rule-line">
                      <span className="label is-dim">loadAfter:</span>
                      <span className="mono truncate">{rule.loadAfter.join(', ')}</span>
                    </div>
                  ) : null}
                  {rule.loadBefore?.length ? (
                    <div className="lodetail-rule-line">
                      <span className="label is-dim">loadBefore:</span>
                      <span className="mono truncate">{rule.loadBefore.join(', ')}</span>
                    </div>
                  ) : null}
                  {rule.incompatibleMods?.length ? (
                    <div className="lodetail-rule-line is-danger">
                      <span className="label is-dim">incompatible:</span>
                      <span className="mono truncate">{rule.incompatibleMods.join(', ')}</span>
                    </div>
                  ) : null}
                  {rule.loadFirst && rule.loadFirst !== 'off' && (
                    <div className="lodetail-rule-line">
                      <span className="label is-dim">loadFirst:</span>
                      <span className="mono">{rule.loadFirst}</span>
                    </div>
                  )}
                  {rule.loadLast && rule.loadLast !== 'off' && (
                    <div className="lodetail-rule-line">
                      <span className="label is-dim">loadLast:</span>
                      <span className="mono">{rule.loadLast}</span>
                    </div>
                  )}
                  {rule.category && (
                    <div className="lodetail-rule-line">
                      <span className="label is-dim">category:</span>
                      <span className="mono">{rule.category}</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="label wbmuted is-italic">
                  {isRu
                    ? 'Индивидуальное правило не задано (используется авто-ранг)'
                    : 'No custom rule defined (uses auto-category rank)'}
                </span>
              )}
            </div>

            {/* File Overwrites (Point 7) */}
            {overwriteInfo && (overwriteInfo.overwriting.length > 0 || overwriteInfo.overwrittenBy.length > 0) && (
              <div className="lodetail-section">
                <div className="lodetail-sec-head">
                  <span className="label stencil">{isRu ? 'Коллизии файлов:' : 'File Collisions:'}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {overwriteInfo.overwriting.length > 0 && (
                      <span className="lopill lopill--overwrite">
                        +{overwriteInfo.overwriting.length} {isRu ? 'переопределяет' : 'overwriting'}
                      </span>
                    )}
                    {overwriteInfo.overwrittenBy.length > 0 && (
                      <span className="lopill lopill--overwritten">
                        -{overwriteInfo.overwrittenBy.length} {isRu ? 'перекрыто' : 'overwritten'}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {overwriteInfo.overwriting.map((item, idx) => (
                    <div
                      key={`ow:${idx}`}
                      style={{
                        background: '#0d1e2b',
                        border: '1px solid #164e63',
                        borderRadius: '4px',
                        padding: '6px 8px',
                        fontSize: '11px'
                      }}
                    >
                      <div className="mono truncate" style={{ color: '#67e8f9', fontWeight: 600 }}>
                        {item.relPath}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--ash-faint)', marginTop: 2 }}>
                        {isRu ? 'Переопределяет файл из:' : 'Overrides file from:'}{' '}
                        <span className="mono" style={{ color: 'var(--bone)' }}>{item.earlier.join(', ')}</span>
                      </div>
                    </div>
                  ))}

                  {overwriteInfo.overwrittenBy.map((item, idx) => (
                    <div
                      key={`ob:${idx}`}
                      style={{
                        background: '#2b1510',
                        border: '1px solid #7c2d12',
                        borderRadius: '4px',
                        padding: '6px 8px',
                        fontSize: '11px'
                      }}
                    >
                      <div className="mono truncate" style={{ color: '#fdba74', fontWeight: 600 }}>
                        {item.relPath}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--ash-faint)', marginTop: 2 }}>
                        {isRu ? 'Перекрыт более поздним модом:' : 'Overwritten by later mod:'}{' '}
                        <span className="mono" style={{ color: 'var(--bone)' }}>{item.winner}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {mod.description && (
              <div className="lodetail-section">
                <span className="label stencil">{isRu ? 'Описание:' : 'Description:'}</span>
                <div className="lodetail-desc mono">{mod.description}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
