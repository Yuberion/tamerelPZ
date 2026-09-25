import { useEffect, useMemo, useRef, useState } from 'react'
import { pzFileUrl } from '@shared/ipc'
import type {
  FilePreview,
  FsNode,
  ModEntry,
  ModSource,
  ModStats,
  ModWarning,
  ScanIssues,
  UserModAnnotation
} from '@shared/types'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { categoryMeta, fileColor, fileIcon, sourceLabel, SOURCE_META } from '@renderer/lib/catmeta'
import { copyText, formatBytes, formatCount, formatDate } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'
import { useAppStore } from '@renderer/state/store'
import { AudioPreview } from './AudioPreview'
import { ItemInspector } from './ItemInspector'

const MAX_PREVIEW_LINES = 1200

/** Warning codes emitted by the scanner, mapped to dictionary entries. */
const WARNING_KEYS: Record<ModWarning, TKey> = {
  'no-modinfo': 'warn.noModInfo',
  'no-id': 'warn.noId',
  'poster-missing': 'warn.posterMissing'
}

interface InfoPanelProps {
  mod: ModEntry | undefined
  node: FsNode | undefined
  tab: 'mod' | 'file'
  onTab: (tab: 'mod' | 'file') => void
  allMods: ModEntry[]
  sources: ModSource[]
  issues: ScanIssues | undefined
  knownIds: Set<string>
  onJumpToMod: (key: string) => void
}

export function InfoPanel({
  mod,
  node,
  tab,
  onTab,
  allMods,
  sources,
  issues,
  knownIds,
  onJumpToMod
}: InfoPanelProps) {
  const { t } = useI18n()
  return (
    <>
      <div className="pane__head pane__head--tabs">
        <button
          className={`ptab stencil ${tab === 'mod' ? 'is-on' : ''}`}
          onClick={() => onTab('mod')}
        >
          {t('ip.tabMod')}
        </button>
        <button
          className={`ptab stencil ${tab === 'file' ? 'is-on' : ''}`}
          onClick={() => onTab('file')}
          disabled={!node}
        >
          {t('ip.tabFile')}
        </button>
        <div className="pane__head-spacer" />
        <Hint title={t('ip.tabMod')} body={t('help.pane.info')} />
        {mod && (
          <button
            className="btn btn-icon"
            title={t('ip.reveal')}
            onClick={() => void window.pz.shell.reveal(mod.path)}
          >
            <Icon name="external" size={13} />
          </button>
        )}
      </div>

      <div className="pane__scroll pane__scroll--pad">
        {tab === 'mod' ? (
          <ModInfo
            mod={mod}
            allMods={allMods}
            sources={sources}
            issues={issues}
            knownIds={knownIds}
            onJumpToMod={onJumpToMod}
          />
        ) : (
          <FileInfo node={node} />
        )}
      </div>
    </>
  )
}

function ModInfo({
  mod,
  allMods,
  sources,
  issues,
  knownIds,
  onJumpToMod
}: Omit<InfoPanelProps, 'node' | 'tab' | 'onTab'>) {
  const { notify } = useToast()
  const { t, p } = useI18n()
  const { settings, saveSettings } = useAppStore()
  const [stats, setStats] = useState<ModStats>()
  const [posterFailed, setPosterFailed] = useState(false)
  const req = useRef(0)

  const annotation = settings?.modAnnotations?.[mod?.key ?? ''] ?? {}
  const isFavorite = Boolean(annotation.favorite)

  const toggleFavorite = () => {
    if (!mod) return
    const current = settings?.modAnnotations ?? {}
    const next = {
      ...current,
      [mod.key]: {
        ...current[mod.key],
        favorite: !isFavorite
      }
    }
    void saveSettings({ modAnnotations: next })
    notify(isFavorite ? 'Удалено из избранного' : 'Добавлено в избранное', 'ok')
  }

  useEffect(() => {
    setStats(undefined)
    setPosterFailed(false)
    if (!mod) return
    const id = ++req.current
    void window.pz.mods.stats(mod.path).then((s) => {
      if (id === req.current) setStats(s)
    })
  }, [mod])

  const dependents = useMemo(() => {
    if (!mod?.modId) return []
    return allMods.filter((m) => m.key !== mod.key && m.requires.includes(mod.modId as string))
  }, [mod, allMods])

  const duplicates = useMemo(() => {
    if (!mod?.modId) return []
    const keys = issues?.duplicateIds[mod.modId] ?? []
    return keys.filter((k) => k !== mod.key)
  }, [mod, issues])

  const topExts = useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.byExt)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 8)
  }, [stats])

  if (!mod) {
    return (
      <div className="pane__empty pane__empty--big">
        <Icon name="info" size={30} strokeWidth={1.2} />
        <span className="label">{t('ip.noModSelected')}</span>
      </div>
    )
  }

  const source = sources.find((s) => s.id === mod.sourceId)
  const artwork = !posterFailed ? (mod.posterPath ?? mod.iconPath) : mod.iconPath
  const copy = (value: string, messageKey: TKey): void => {
    void copyText(value)
    notify(t(messageKey), 'ok')
  }

  return (
    <div className="info">
      <div className="info__poster brackets">
        {artwork ? (
          <img
            src={pzFileUrl(artwork)}
            alt=""
            onError={() => setPosterFailed(true)}
            draggable={false}
          />
        ) : (
          <div className="info__poster-empty">
            <Icon name="image" size={26} />
            <span className="label">{t('ip.noPoster')}</span>
          </div>
        )}
      </div>

      <div className="info__title-row">
        <h2 className="info__name truncate">{mod.name}</h2>
        <button
          type="button"
          className={`btn btn-icon info__fav-btn ${isFavorite ? 'is-fav' : ''}`}
          onClick={toggleFavorite}
          title={isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}
        >
          <Icon name="star" size={16} color={isFavorite ? '#f59e0b' : undefined} />
        </button>
      </div>

      <div className="info__cats">
        {mod.categories.map((c) => {
          const meta = categoryMeta(c)
          return (
            <span key={c} className="catchip" style={{ borderColor: meta.color }}>
              <Icon name={meta.icon} size={11} color={meta.color} />
              {t(meta.labelKey)}
            </span>
          )
        })}
      </div>

      {(duplicates.length > 0 || mod.warnings.length > 0) && (
        <div className="info__alerts">
          {duplicates.length > 0 && (
            <div className="alert alert--bad">
              <Icon name="alert" size={13} />
              <div>
                <strong>{t('ip.duplicateTitle')}</strong>{' '}
                {t('ip.duplicateBody', {
                  copies: `${duplicates.length} ${p('copies', duplicates.length)}`,
                  id: mod.modId ?? '—'
                })}
                <div className="alert__links">
                  {duplicates.map((k) => (
                    <button key={k} className="linkish mono" onClick={() => onJumpToMod(k)}>
                      {k.split('::')[1]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {mod.warnings.map((w) => (
            <div key={w} className="alert alert--warn">
              <Icon name="alert" size={13} />
              <span>{t(WARNING_KEYS[w])}</span>
            </div>
          ))}
        </div>
      )}

      {mod.description && <p className="info__desc">{mod.description}</p>}

      <Section title={t('ip.identity')}>
        <Field label={t('ip.modId')} value={mod.modId ?? '—'} onCopy={mod.modId ? () => copy(mod.modId as string, 'toast.modIdCopied') : undefined} mono />
        {mod.rawModId && mod.rawModId !== mod.modId && (
          <Field label={t('ip.rawId')} value={mod.rawModId} mono />
        )}
        <Field label={t('ip.folder')} value={mod.folderName} mono />
        <Field label={t('ip.author')} value={mod.authors ?? '—'} />
        <Field label={t('ip.version')} value={mod.modVersion ?? '—'} />
        <Field label={t('ip.builds')} value={mod.builds.join(' + ') || t('ip.unknown')} />
        {mod.pzVersion && <Field label={t('ip.pzVersion')} value={mod.pzVersion} />}
        <Field
          label={t('ip.source')}
          value={`${t(SOURCE_META[mod.sourceKind].labelKey)}${
            source ? ` · ${sourceLabel(source, t)}` : ''
          }`}
        />
        {mod.workshopId && (
          <Field
            label={t('ip.workshop')}
            value={mod.workshopId}
            mono
            action={{
              icon: 'link',
              title: t('ip.openWorkshopPage'),
              onClick: () =>
                void window.pz.shell.external(
                  `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`
                )
            }}
          />
        )}
        {mod.url && (
          <Field
            label={t('ip.url')}
            value={mod.url}
            action={{
              icon: 'external',
              title: t('ip.openLink'),
              onClick: () => void window.pz.shell.external(mod.url as string)
            }}
          />
        )}
        <Field label={t('ip.modified')} value={formatDate(mod.mtime)} />
      </Section>

      <Section title={t('ip.onDisk')}>
        <Field
          label={t('ip.path')}
          value={mod.path}
          mono
          wrap
          onCopy={() => copy(mod.path, 'toast.pathCopied')}
          action={{
            icon: 'folder-open',
            title: t('ip.openFolder'),
            onClick: () => void window.pz.shell.open(mod.path)
          }}
        />
        {mod.infoFile && (
          <Field
            label="mod.info"
            value={mod.infoFile.replace(mod.path, '.')}
            mono
            wrap
            action={{
              icon: 'external',
              title: t('ip.revealModInfo'),
              onClick: () => void window.pz.shell.reveal(mod.infoFile as string)
            }}
          />
        )}
        <div className="statgrid">
          <Stat label={t('ip.files')} value={stats ? formatCount(stats.files) : '…'} />
          <Stat label={t('ip.folders')} value={stats ? formatCount(stats.dirs) : '…'} />
          <Stat label={t('ip.size')} value={stats ? formatBytes(stats.bytes) : '…'} />
        </div>
        {topExts.length > 0 && (
          <div className="extbars">
            {topExts.map(([ext, v]) => (
              <div key={ext} className="extbar">
                <Icon name={fileIcon(ext)} size={11} color={fileColor(ext)} />
                <span className="extbar__ext mono">{ext}</span>
                <span className="extbar__track">
                  <span
                    className="extbar__fill"
                    style={{
                      width: `${Math.max(2, (v.bytes / (topExts[0]?.[1].bytes || 1)) * 100)}%`,
                      background: fileColor(ext)
                    }}
                  />
                </span>
                <span className="extbar__n mono">{formatCount(v.n)}</span>
                <span className="extbar__b mono">{formatBytes(v.bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {mod.versionFolders.length > 0 && (
        <Section title={t('ip.buildFolders')}>
          <div className="pillrow">
            {mod.versionFolders.map((v) => (
              <button
                key={v.path}
                className="pill"
                title={t('ip.openTarget', { path: v.path })}
                onClick={() => void window.pz.shell.open(v.path)}
              >
                <Icon name="folder" size={11} />
                {v.name}
                {v.hasModInfo && <Icon name="check" size={10} color="var(--moss)" />}
              </button>
            ))}
          </div>
        </Section>
      )}

      {(mod.requires.length > 0 || dependents.length > 0) && (
        <Section title={t('ip.dependencies')}>
          {mod.requires.length > 0 && (
            <div className="deps">
              <div className="deps__head label">{t('ip.requires')}</div>
              {mod.requires.map((r) => {
                const ok = knownIds.has(r)
                const target = allMods.find((m) => m.modId === r)
                return (
                  <button
                    key={r}
                    className={`dep ${ok ? 'is-ok' : 'is-bad'}`}
                    disabled={!target}
                    onClick={() => target && onJumpToMod(target.key)}
                  >
                    <Icon name={ok ? 'check' : 'close'} size={11} />
                    <span className="mono truncate">{r}</span>
                    <span className="dep__note label">
                      {ok ? (target?.name ?? '') : t('ip.depMissing')}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {dependents.length > 0 && (
            <div className="deps">
              <div className="deps__head label">
                {t('ip.requiredBy', { n: dependents.length })}
              </div>
              {dependents.slice(0, 12).map((d) => (
                <button key={d.key} className="dep is-neutral" onClick={() => onJumpToMod(d.key)}>
                  <Icon name="link" size={11} />
                  <span className="truncate">{d.name}</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {mod.tags.length > 0 && (
        <Section title={t('ip.tags')}>
          <div className="pillrow">
            {mod.tags.map((t2) => (
              <span key={t2} className="tag">
                {t2}
              </span>
            ))}
          </div>
        </Section>
      )}

      {mod.mediaDirs.length > 0 && (
        <Section title={t('ip.media', { n: mod.mediaDirs.length })}>
          <div className="pillrow">
            {mod.mediaDirs.map((d) => (
              <span key={d} className="pill pill--flat mono">
                {d}
              </span>
            ))}
          </div>
        </Section>
      )}

      <ModAnnotationsSection modKey={mod.key} />
    </div>
  )
}

function ModAnnotationsSection({ modKey }: { modKey: string }) {
  const { settings, saveSettings } = useAppStore()
  const annotation = settings?.modAnnotations?.[modKey] ?? {}
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState(annotation.notes ?? '')
  const [savedFeedback, setSavedFeedback] = useState(false)
  const saveTimeout = useRef<number | undefined>(undefined)

  useEffect(() => {
    setNotes(annotation.notes ?? '')
  }, [annotation.notes, modKey])

  const update = (patch: Partial<UserModAnnotation>) => {
    const current = settings?.modAnnotations ?? {}
    const next = {
      ...current,
      [modKey]: {
        ...current[modKey],
        ...patch
      }
    }
    void saveSettings({ modAnnotations: next })
    setSavedFeedback(true)
    window.clearTimeout(saveTimeout.current)
    saveTimeout.current = window.setTimeout(() => setSavedFeedback(false), 1500)
  }

  const addTag = (tagToAdd: string) => {
    const clean = tagToAdd.trim().replace(/^#/, '')
    if (!clean) return
    const currentTags = annotation.tags ?? []
    if (!currentTags.includes(clean)) {
      update({ tags: [...currentTags, clean] })
    }
    setTagInput('')
  }

  const removeTag = (tagToRemove: string) => {
    const currentTags = annotation.tags ?? []
    update({ tags: currentTags.filter((t) => t !== tagToRemove) })
  }

  const onNotesBlur = () => {
    if (notes !== (annotation.notes ?? '')) {
      update({ notes })
    }
  }

  const QUICK_TAGS = ['B42 Port', 'Verified', 'Glitchy', 'Server', 'Testing', 'Custom']

  return (
    <Section title="Метки и заметки">
      <div className="user-annotations">
        <div className="user-tags">
          <div className="user-tags__list">
            {(annotation.tags ?? []).map((t) => (
              <span key={t} className="user-tag-chip mono">
                #{t}
                <button
                  type="button"
                  className="user-tag-chip__del"
                  onClick={() => removeTag(t)}
                  title="Удалить тег"
                >
                  ×
                </button>
              </span>
            ))}
            {(!annotation.tags || annotation.tags.length === 0) && (
              <span className="is-dim" style={{ fontSize: 11 }}>
                Нет пользовательских меток
              </span>
            )}
          </div>

          <div className="user-tags__input-row">
            <input
              type="text"
              className="user-tags__input mono"
              placeholder="+ Новый тег..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag(tagInput)
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => addTag(tagInput)}
              disabled={!tagInput.trim()}
            >
              <Icon name="plus" size={12} />
              Добавить
            </button>
          </div>

          <div className="user-tags__suggestions">
            <span className="label is-dim" style={{ fontSize: 10, alignSelf: 'center' }}>
              Быстрые:
            </span>
            {QUICK_TAGS.filter((qt) => !(annotation.tags ?? []).includes(qt)).slice(0, 4).map((qt) => (
              <button
                key={qt}
                type="button"
                className="chip chip--sm"
                onClick={() => addTag(qt)}
              >
                +{qt}
              </button>
            ))}
          </div>
        </div>

        <div className="user-notes">
          <div className="user-notes__head">
            <span className="label">Личные заметки</span>
            {savedFeedback && <span className="user-notes__saved mono">✓ Сохранено</span>}
          </div>
          <textarea
            className="user-notes__textarea mono"
            placeholder="Заметки разработчика, статус адаптации, баги, ID предметов, настройки..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={onNotesBlur}
            rows={3}
          />
        </div>
      </div>
    </Section>
  )
}

function FileInfo({ node }: { node: FsNode | undefined }) {
  const [preview, setPreview] = useState<FilePreview>()
  const [error, setError] = useState<string>()
  const [textViewMode, setTextViewMode] = useState<'cards' | 'code'>('cards')
  const req = useRef(0)
  const { notify } = useToast()
  const { t } = useI18n()

  useEffect(() => {
    setPreview(undefined)
    setError(undefined)
    setTextViewMode('cards')
    if (!node || node.dir) return
    const id = ++req.current
    void window.pz.fs
      .preview(node.path)
      .then((p) => {
        if (id === req.current) setPreview(p)
      })
      .catch((e: unknown) => {
        if (id === req.current) setError(e instanceof Error ? e.message : String(e))
      })
  }, [node])

  const isPzScript = useMemo(() => {
    if (preview?.kind !== 'text' || !preview.text) return false
    return /\bitem\s+[\w-]+\s*\{|\brecipe\s+[\w\s-]+\s*\{|\bcraftRecipe\s+[\w\s-]+\s*\{/i.test(
      preview.text
    )
  }, [preview])

  const tokens = useMemo(() => {
    if (preview?.kind !== 'text' || !preview.text) return []
    const lines = preview.text.split('\n')
    const clipped = lines.length > MAX_PREVIEW_LINES
    const text = clipped ? lines.slice(0, MAX_PREVIEW_LINES).join('\n') : preview.text
    return highlight(text, preview.lang)
  }, [preview])

  const lineCount = useMemo(() => {
    if (preview?.kind !== 'text' || !preview.text) return 0
    return Math.min(preview.text.split('\n').length, MAX_PREVIEW_LINES)
  }, [preview])

  if (!node) {
    return (
      <div className="pane__empty pane__empty--big">
        <Icon name="file" size={30} strokeWidth={1.2} />
        <span className="label">{t('ip.selectFile')}</span>
      </div>
    )
  }

  return (
    <div className="info">
      <div className="fileheader">
        <Icon
          name={node.dir ? 'folder' : fileIcon(node.ext)}
          size={18}
          color={node.dir ? 'var(--ash)' : fileColor(node.ext)}
        />
        <span className="fileheader__name truncate">{node.name}</span>
      </div>

      <div className="btnrow">
        <button className="btn" onClick={() => void window.pz.shell.reveal(node.path)}>
          <Icon name="external" size={12} />
          {t('ip.explorer')}
        </button>
        <button className="btn" onClick={() => void window.pz.shell.open(node.path)}>
          <Icon name="eye" size={12} />
          {t('ip.open')}
        </button>
        <button
          className="btn"
          onClick={() => {
            void copyText(node.path)
            notify(t('toast.pathCopied'), 'ok')
          }}
        >
          <Icon name="copy" size={12} />
          {t('ip.pathShort')}
        </button>
      </div>

      <Section title={t('ip.file')}>
        <Field
          label={t('ip.type')}
          value={node.dir ? t('ip.typeFolder') : node.ext ? `.${node.ext}` : t('ip.typeFile')}
        />
        <Field
          label={node.dir ? t('ip.entries') : t('ip.size')}
          value={node.dir ? formatCount(node.childCount) : formatBytes(node.size)}
        />
        <Field label={t('ip.modified')} value={formatDate(node.mtime)} />
        <Field label={t('ip.path')} value={node.path} mono wrap />
      </Section>

      {error && (
        <div className="alert alert--warn">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </div>
      )}

      {preview?.kind === 'image' && (
        <Section
          title={`${t('ip.preview')}${
            preview.width ? ` · ${preview.width}×${preview.height}` : ''
          }`}
        >
          <div className="imgpreview brackets">
            <img src={pzFileUrl(preview.path)} alt="" draggable={false} />
          </div>
        </Section>
      )}

      {preview?.kind === 'audio' && (
        <Section title="Аудио · Воспроизведение">
          <AudioPreview path={preview.path} size={preview.size} />
        </Section>
      )}

      {preview?.kind === 'text' && (
        <Section
          title={`${t('ip.preview')}${preview.truncated ? ` · ${t('ip.truncated')}` : ''}`}
          extra={
            isPzScript ? (
              <div className="view-mode-toggle">
                <button
                  type="button"
                  className={`btn btn-sm ${textViewMode === 'cards' ? 'is-active' : ''}`}
                  onClick={() => setTextViewMode('cards')}
                >
                  <Icon name="package" size={12} />
                  Карточки
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${textViewMode === 'code' ? 'is-active' : ''}`}
                  onClick={() => setTextViewMode('code')}
                >
                  <Icon name="code" size={12} />
                  Код
                </button>
              </div>
            ) : undefined
          }
        >
          {isPzScript && textViewMode === 'cards' ? (
            <ItemInspector text={preview.text ?? ''} />
          ) : (
            <div className="code">
              <div className="code__gutter mono">
                {Array.from({ length: lineCount }).map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <pre className="code__body mono">
                {tokens.map((t, i) =>
                  t.cls ? (
                    <span key={i} className={`tk-${t.cls}`}>
                      {t.text}
                    </span>
                  ) : (
                    <span key={i}>{t.text}</span>
                  )
                )}
              </pre>
            </div>
          )}
        </Section>
      )}

      {preview?.kind === 'binary' && (
        <Section title={t('ip.preview')}>
          <div className="binary">
            <Icon name="hard-drive" size={20} />
            <span className="label">
              {t('ip.binaryFile')} · {formatBytes(preview.size)}
            </span>
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  extra,
  children
}: {
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="isect">
      <div className="isect__head">
        <span className="label">{title}</span>
        {extra}
        <span className="isect__rule" />
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  value,
  mono,
  wrap,
  onCopy,
  action
}: {
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
  onCopy?: () => void
  action?: { icon: Parameters<typeof Icon>[0]['name']; title: string; onClick: () => void }
}) {
  const { t } = useI18n()
  return (
    <div className="field">
      <span className="field__label label">{label}</span>
      <span className={`field__value ${mono ? 'mono' : ''} ${wrap ? 'is-wrap' : 'truncate'}`}>
        {value}
      </span>
      {onCopy && (
        <button className="field__btn" title={t('ip.copy')} onClick={onCopy}>
          <Icon name="copy" size={12} />
        </button>
      )}
      {action && (
        <button className="field__btn" title={action.title} onClick={action.onClick}>
          <Icon name={action.icon} size={12} />
        </button>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value mono">{value}</span>
      <span className="stat__label label">{label}</span>
    </div>
  )
}
