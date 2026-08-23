import { useEffect, useMemo, useRef, useState } from 'react'
import { pzFileUrl } from '@shared/ipc'
import type { FilePreview, FsNode, ModEntry, ModSource, ModStats, ScanIssues } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { categoryMeta, fileColor, fileIcon, SOURCE_META } from '@renderer/lib/catmeta'
import { copyText, formatBytes, formatCount, formatDate } from '@renderer/lib/format'
import { highlight } from '@renderer/lib/highlight'

const MAX_PREVIEW_LINES = 1200

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
  return (
    <>
      <div className="pane__head pane__head--tabs">
        <button
          className={`ptab stencil ${tab === 'mod' ? 'is-on' : ''}`}
          onClick={() => onTab('mod')}
        >
          Mod
        </button>
        <button
          className={`ptab stencil ${tab === 'file' ? 'is-on' : ''}`}
          onClick={() => onTab('file')}
          disabled={!node}
        >
          File
        </button>
        <div className="pane__head-spacer" />
        {mod && (
          <button
            className="btn btn-icon"
            title="Reveal in Explorer"
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
  const [stats, setStats] = useState<ModStats>()
  const [posterFailed, setPosterFailed] = useState(false)
  const req = useRef(0)

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
        <span className="label">No mod selected</span>
      </div>
    )
  }

  const source = sources.find((s) => s.id === mod.sourceId)
  const artwork = !posterFailed ? (mod.posterPath ?? mod.iconPath) : mod.iconPath
  const copy = (value: string, what: string): void => {
    void copyText(value)
    notify(`${what} copied`, 'ok')
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
            <span className="label">No poster</span>
          </div>
        )}
      </div>

      <h2 className="info__name">{mod.name}</h2>

      <div className="info__cats">
        {mod.categories.map((c) => {
          const meta = categoryMeta(c)
          return (
            <span key={c} className="catchip" style={{ borderColor: meta.color }}>
              <Icon name={meta.icon} size={11} color={meta.color} />
              {meta.label}
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
                <strong>Duplicate mod id.</strong> {duplicates.length} other cop
                {duplicates.length === 1 ? 'y' : 'ies'} of <code>{mod.modId}</code> installed — the
                game loads only one.
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
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {mod.description && <p className="info__desc">{mod.description}</p>}

      <Section title="Identity">
        <Field label="Mod id" value={mod.modId ?? '—'} onCopy={mod.modId ? () => copy(mod.modId as string, 'Mod id') : undefined} mono />
        {mod.rawModId && mod.rawModId !== mod.modId && (
          <Field label="Raw id" value={mod.rawModId} mono />
        )}
        <Field label="Folder" value={mod.folderName} mono />
        <Field label="Author" value={mod.authors ?? '—'} />
        <Field label="Version" value={mod.modVersion ?? '—'} />
        <Field label="Builds" value={mod.builds.join(' + ') || 'unknown'} />
        {mod.pzVersion && <Field label="PZ version" value={mod.pzVersion} />}
        <Field
          label="Source"
          value={`${SOURCE_META[mod.sourceKind].label}${source?.label ? ` · ${source.label}` : ''}`}
        />
        {mod.workshopId && (
          <Field
            label="Workshop"
            value={mod.workshopId}
            mono
            action={{
              icon: 'link',
              title: 'Open Workshop page',
              onClick: () =>
                void window.pz.shell.external(
                  `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`
                )
            }}
          />
        )}
        {mod.url && (
          <Field
            label="Url"
            value={mod.url}
            action={{
              icon: 'external',
              title: 'Open link',
              onClick: () => void window.pz.shell.external(mod.url as string)
            }}
          />
        )}
        <Field label="Modified" value={formatDate(mod.mtime)} />
      </Section>

      <Section title="On disk">
        <Field
          label="Path"
          value={mod.path}
          mono
          wrap
          onCopy={() => copy(mod.path, 'Path')}
          action={{
            icon: 'folder-open',
            title: 'Open folder',
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
              title: 'Reveal mod.info',
              onClick: () => void window.pz.shell.reveal(mod.infoFile as string)
            }}
          />
        )}
        <div className="statgrid">
          <Stat label="Files" value={stats ? formatCount(stats.files) : '…'} />
          <Stat label="Folders" value={stats ? formatCount(stats.dirs) : '…'} />
          <Stat label="Size" value={stats ? formatBytes(stats.bytes) : '…'} />
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
        <Section title="Build folders">
          <div className="pillrow">
            {mod.versionFolders.map((v) => (
              <button
                key={v.path}
                className="pill"
                title={`Open ${v.path}`}
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
        <Section title="Dependencies">
          {mod.requires.length > 0 && (
            <div className="deps">
              <div className="deps__head label">Requires</div>
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
                    <span className="dep__note label">{ok ? (target?.name ?? '') : 'missing'}</span>
                  </button>
                )
              })}
            </div>
          )}
          {dependents.length > 0 && (
            <div className="deps">
              <div className="deps__head label">Required by {dependents.length}</div>
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
        <Section title="Tags">
          <div className="pillrow">
            {mod.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}

      {mod.mediaDirs.length > 0 && (
        <Section title={`Media (${mod.mediaDirs.length})`}>
          <div className="pillrow">
            {mod.mediaDirs.map((d) => (
              <span key={d} className="pill pill--flat mono">
                {d}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function FileInfo({ node }: { node: FsNode | undefined }) {
  const [preview, setPreview] = useState<FilePreview>()
  const [error, setError] = useState<string>()
  const req = useRef(0)
  const { notify } = useToast()

  useEffect(() => {
    setPreview(undefined)
    setError(undefined)
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
        <span className="label">Select a file in the skeleton</span>
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
          Explorer
        </button>
        <button className="btn" onClick={() => void window.pz.shell.open(node.path)}>
          <Icon name="eye" size={12} />
          Open
        </button>
        <button
          className="btn"
          onClick={() => {
            void copyText(node.path)
            notify('Path copied', 'ok')
          }}
        >
          <Icon name="copy" size={12} />
          Path
        </button>
      </div>

      <Section title="File">
        <Field label="Type" value={node.dir ? 'Folder' : node.ext ? `.${node.ext}` : 'file'} />
        <Field
          label={node.dir ? 'Entries' : 'Size'}
          value={node.dir ? formatCount(node.childCount) : formatBytes(node.size)}
        />
        <Field label="Modified" value={formatDate(node.mtime)} />
        <Field label="Path" value={node.path} mono wrap />
      </Section>

      {error && (
        <div className="alert alert--warn">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </div>
      )}

      {preview?.kind === 'image' && (
        <Section
          title={`Preview${preview.width ? ` · ${preview.width}×${preview.height}` : ''}`}
        >
          <div className="imgpreview brackets">
            <img src={pzFileUrl(preview.path)} alt="" draggable={false} />
          </div>
        </Section>
      )}

      {preview?.kind === 'text' && (
        <Section title={`Preview${preview.truncated ? ' · truncated' : ''}`}>
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
        </Section>
      )}

      {preview?.kind === 'binary' && (
        <Section title="Preview">
          <div className="binary">
            <Icon name="hard-drive" size={20} />
            <span className="label">Binary file · {formatBytes(preview.size)}</span>
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="isect">
      <div className="isect__head">
        <span className="label">{title}</span>
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
  return (
    <div className="field">
      <span className="field__label label">{label}</span>
      <span className={`field__value ${mono ? 'mono' : ''} ${wrap ? 'is-wrap' : 'truncate'}`}>
        {value}
      </span>
      {onCopy && (
        <button className="field__btn" title="Copy" onClick={onCopy}>
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
