import { useMemo } from 'react'
import type {
  AssimpStatus,
  ConvertItemResult,
  ConvertProgress,
  ForgeEngineUsed,
  ForgeInput,
  ForgeKind
} from '@shared/types'
import { Alert, CheckField, Group, OptionCard, Panel, Readout, SelectField, TextField } from '@renderer/components/Form'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { hasKey, useI18n, type TKey } from '@renderer/i18n'
import { copyText, formatBytes, formatCount, formatDuration, shortenPath } from '@renderer/lib/format'
import { parseScale, type ForgeStore } from './useForge'

/** What this app reads on its own; everything else in the list came from assimp. */
const BUILTIN_MESH = new Set(['obj', 'stl', 'ply', 'x', 'dae', 'gltf', 'glb'])

const KIND_ICON: Record<ForgeKind, IconName> = {
  mesh: 'cube',
  image: 'image',
  transcode: 'layers',
  capsule: 'package'
}

const KIND_KEY: Record<ForgeKind, TKey> = {
  mesh: 'tl.kind.mesh',
  image: 'tl.kind.image',
  transcode: 'tl.kind.transcode',
  capsule: 'tl.kind.capsule'
}

const PHASE_KEY: Record<ConvertProgress['phase'], TKey> = {
  read: 'tl.phase.read',
  build: 'tl.phase.build',
  write: 'tl.phase.write',
  verify: 'tl.phase.verify',
  done: 'tl.phase.done'
}

const ENGINE_KEY: Record<ForgeEngineUsed, TKey> = {
  builtin: 'tl.engineUsed.builtin',
  assimp: 'tl.engineUsed.assimp'
}

const ENGINE_TITLE_KEY: Record<ForgeEngineUsed, TKey> = {
  builtin: 'tl.engineUsed.builtinTitle',
  assimp: 'tl.engineUsed.assimpTitle'
}

/**
 * Localise a code main sent back.
 *
 * Main emits stable codes (`exists`, `readOnlyTarget`, …) rather than sentences,
 * so the same result reads correctly in either language. Anything without a
 * dictionary entry is printed verbatim — that is the escape hatch for the raw
 * exception text a new failure mode arrives as.
 */
function useMessage(): (code: string | undefined) => string | undefined {
  const { t } = useI18n()
  return (code) => {
    if (!code) return undefined
    const key = `tl.msg.${code}`
    return hasKey(key) ? t(key) : code
  }
}

export function ForgeTool({ store }: { store: ForgeStore }) {
  const { t, p } = useI18n()
  const { notify } = useToast()
  const message = useMessage()

  const scale = parseScale(store.options.scaleText)
  const canRun = store.inputs.length > 0 && scale !== undefined && !store.busy
  const totalBytes = useMemo(() => store.inputs.reduce((n, i) => n + i.size, 0), [store.inputs])

  // `tools.reveal` rejects a path it cannot vouch for, and an unhandled rejection
  // in a click handler is a silent failure — so it is reported like any other.
  const reveal = async (path: string): Promise<void> => {
    try {
      await window.pz.tools.reveal(path)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    }
  }

  return (
    <Panel
      title={t('tl.forgeTitle')}
      lede={t('tl.forgeLede')}
      icon="cube"
      help={t('help.tl.forge')}
      actions={
        <>
          <button className="btn" onClick={() => void store.add()} title={t('tl.addTitle')}>
            <Icon name="plus" size={13} />
            {t('tl.add')}
          </button>
          <button
            className="btn"
            onClick={() => {
              void store.addFolder().then((added) => {
                if (added === 0) notify(t('tl.folderEmpty'), 'warn')
                else notify(t('tl.folderAdded', { n: formatCount(added) }), 'ok')
              })
            }}
            disabled={store.busy}
            title={t('tl.addFolderTitle')}
          >
            <Icon name="folder-plus" size={13} />
            {t('tl.addFolder')}
          </button>
          <button
            className="btn"
            onClick={store.clear}
            disabled={store.inputs.length === 0 || store.busy}
            title={t('tl.clearTitle')}
          >
            <Icon name="trash" size={13} />
            {t('tl.clear')}
          </button>
          {store.busy ? (
            <button className="btn" onClick={() => void store.cancel()} title={t('tl.cancelTitle')}>
              <Icon name="close" size={13} />
              {t('tl.cancel')}
            </button>
          ) : (
            <button
              className="btn is-primary"
              onClick={() => void store.run()}
              disabled={!canRun}
              title={t('tl.convertTitle')}
            >
              <Icon name="play" size={13} />
              {t('tl.convert')}
            </button>
          )}
        </>
      }
    >
      {store.error && <Alert kind="bad">{store.error}</Alert>}

      <Group
        title={t('tl.queue')}
        hint={t('tl.queueHint')}
        help={t('help.tl.queue')}
      >
        {store.inputs.length === 0 ? (
          <div className="tlempty">
            <Icon name="cube" size={26} strokeWidth={1.2} />
            <span className="stencil">{t('tl.queueEmpty')}</span>
            <span className="label">{t('tl.queueEmptyHint')}</span>
          </div>
        ) : (
          <>
            <div className="tlqueue">
              {store.inputs.map((input) => (
                <QueueRow
                  key={input.path}
                  input={input}
                  disabled={store.busy}
                  onRemove={() => store.remove(input.path)}
                />
              ))}
            </div>
            <div className="tlqueue__foot mono">
              <span>
                {formatCount(store.inputs.length)} {p('files', store.inputs.length)}
              </span>
              <span className="statusbar__sep">·</span>
              <span>{formatBytes(totalBytes)}</span>
              <span className="statusbar__sep">·</span>
              <span className={store.convertible === 0 ? 'is-warn' : ''}>
                {t('tl.geometryCount', { n: formatCount(store.convertible) })}
              </span>
            </div>
          </>
        )}
      </Group>

      <Group title={t('tl.output')} help={t('help.tl.output')} cols>
        <SelectField
          label={t('tl.engine')}
          value={store.options.engine}
          hint={t('tl.engineHint')}
          help={t('help.tl.engine')}
          disabled={store.busy}
          options={[
            { value: 'auto', label: t('tl.engineAuto') },
            { value: 'assimp', label: t('tl.engineAssimp') },
            { value: 'builtin', label: t('tl.engineBuiltin') }
          ]}
          onChange={(engine) => store.setOptions({ engine })}
        />
        <SelectField
          label={t('tl.encoding')}
          value={store.options.encoding}
          hint={t('tl.encodingHint')}
          help={t('help.tl.encoding')}
          disabled={store.busy}
          options={[
            { value: 'binary', label: t('tl.encBinary') },
            { value: 'ascii', label: t('tl.encAscii') }
          ]}
          onChange={(encoding) => store.setOptions({ encoding })}
        />
        <TextField
          label={t('tl.scale')}
          value={store.options.scaleText}
          hint={t('tl.scaleHint')}
          help={t('help.tl.scale')}
          mono
          invalid={scale === undefined}
          disabled={store.busy}
          onChange={(scaleText) => store.setOptions({ scaleText })}
        />
      </Group>

      {store.options.engine === 'assimp' && store.assimp && !store.assimp.ready && (
        <Alert kind="warn">{t('tl.assimpRequired')}</Alert>
      )}

      <Group title={t('tl.dest')} help={t('help.tl.dest')}>
        <div className="wboptrow">
          <OptionCard
            on={store.options.outputMode === 'beside'}
            onClick={() => store.setOptions({ outputMode: 'beside' })}
            label={t('tl.destBeside')}
            hint={t('tl.destBesideHint')}
            icon="folder"
            disabled={store.busy}
          />
          <OptionCard
            on={store.options.outputMode === 'custom'}
            onClick={() => store.setOptions({ outputMode: 'custom' })}
            label={t('tl.destCustom')}
            hint={store.outputDir ? shortenPath(store.outputDir, 3) : t('tl.noFolder')}
            icon="folder-open"
            disabled={store.busy}
          />
        </div>
        <div className="btnrow">
          <button className="btn" onClick={() => void store.pickOutput()} disabled={store.busy}>
            <Icon name="folder-open" size={13} />
            {t('tl.pickFolder')}
          </button>
          {store.outputDir && (
            <button
              className="btn btn-icon"
              onClick={() => void reveal(store.outputDir ?? '')}
              title={t('tl.openOutput')}
            >
              <Icon name="external" size={13} />
            </button>
          )}
        </div>
        {store.options.outputMode === 'custom' && !store.outputDir && (
          <Alert kind="warn">{t('tl.noFolderBody')}</Alert>
        )}
      </Group>

      <Group title={t('tl.geometry')} help={t('help.tl.geometry')} cols>
        <CheckField
          label={t('tl.zUp')}
          hint={t('tl.zUpHint')}
          checked={store.options.yUp}
          disabled={store.busy}
          onChange={(yUp) => store.setOptions({ yUp })}
        />
        <CheckField
          label={t('tl.normals')}
          hint={t('tl.normalsHint')}
          checked={store.options.rebuildNormals}
          disabled={store.busy}
          onChange={(rebuildNormals) => store.setOptions({ rebuildNormals })}
        />
        <CheckField
          label={t('tl.weld')}
          hint={t('tl.weldHint')}
          checked={store.options.weld}
          disabled={store.busy}
          onChange={(weld) => store.setOptions({ weld })}
        />
        <CheckField
          label={t('tl.embed')}
          hint={t('tl.embedHint')}
          checked={store.options.embed}
          disabled={store.busy}
          onChange={(embed) => store.setOptions({ embed })}
        />
        <CheckField
          label={t('tl.verify')}
          hint={t('tl.verifyHint')}
          checked={store.options.verify}
          disabled={store.busy || store.options.encoding === 'ascii'}
          onChange={(verify) => store.setOptions({ verify })}
        />
        <CheckField
          label={t('tl.overwrite')}
          hint={t('tl.overwriteHint')}
          checked={store.options.overwrite}
          disabled={store.busy}
          onChange={(overwrite) => store.setOptions({ overwrite })}
        />
      </Group>

      <FormatsGroup assimp={store.assimp} onLocate={() => void store.locateAssimp()} busy={store.busy} />

      {store.progress && (
        <div className="tlprogress mono">
          <Icon name="refresh" size={12} className="spin" />
          <span>{t(PHASE_KEY[store.progress.phase])}</span>
          <span className="tlprogress__name truncate">{store.progress.name}</span>
          <span className="tlprogress__count">
            {store.progress.index + 1} / {store.progress.total}
          </span>
        </div>
      )}

      {store.result && (
        <Group title={t('tl.results')}>
          <div className="tlsummary mono">
            <span className={store.result.ok > 0 ? 'is-ok' : 'is-dim'}>
              {t('tl.sumOk', { n: formatCount(store.result.ok) })}
            </span>
            <span className="statusbar__sep">·</span>
            <span className={store.result.skipped > 0 ? 'is-warn' : 'is-dim'}>
              {t('tl.sumSkipped', { n: formatCount(store.result.skipped) })}
            </span>
            <span className="statusbar__sep">·</span>
            <span className={store.result.errors > 0 ? 'is-warn' : 'is-dim'}>
              {t('tl.sumErrors', { n: formatCount(store.result.errors) })}
            </span>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">{formatDuration(store.result.durationMs)}</span>
          </div>
          {store.result.cancelled && <Alert kind="warn">{t('tl.cancelled')}</Alert>}
          <div className="tlqueue">
            {store.result.items.map((item) => (
              <ResultRow
                key={item.input}
                item={item}
                message={message(item.message)}
                onReveal={() => void reveal(item.output ?? item.input)}
                onCopy={async () => {
                  const ok = await copyText(item.output ?? item.input)
                  notify(ok ? t('tl.pathCopied') : t('tl.copyFailed'), ok ? 'ok' : 'warn')
                }}
              />
            ))}
          </div>
        </Group>
      )}
    </Panel>
  )
}

function QueueRow({
  input,
  disabled,
  onRemove
}: {
  input: ForgeInput
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useI18n()
  const noteKey = input.note ? `tl.note.${input.note}` : undefined
  return (
    <div className={`tlrow ${input.supported ? '' : 'is-warn-row'}`} title={input.path}>
      <Icon name={KIND_ICON[input.kind]} size={13} className="tlrow__kind" />
      <span className="tlrow__name truncate">{input.name}</span>
      <span className="tlrow__kindlabel label">{t(KIND_KEY[input.kind])}</span>
      <span className="tlrow__format mono">{input.format}</span>
      <span className="tlrow__size mono">{formatBytes(input.size)}</span>
      {noteKey && hasKey(noteKey) && <span className="tlpill tlpill--warn">{t(noteKey)}</span>}
      <button className="btn btn-icon" onClick={onRemove} disabled={disabled} title={t('tl.remove')}>
        <Icon name="close" size={11} />
      </button>
    </div>
  )
}

function ResultRow({
  item,
  message,
  onReveal,
  onCopy
}: {
  item: ConvertItemResult
  message: string | undefined
  onReveal: () => void
  onCopy: () => void
}) {
  const { t } = useI18n()
  const icon: IconName =
    item.status === 'ok' ? 'check-circle' : item.status === 'skip' ? 'alert-circle' : 'x-circle'
  return (
    <div className={`tlrow tlrow--${item.status}`} title={item.output ?? item.input}>
      <Icon name={icon} size={13} className="tlrow__kind" />
      <span className="tlrow__name truncate">{item.name}</span>
      {item.status === 'ok' && (
        <>
          <span className="tlrow__format mono">{item.format}</span>
          {item.engine && (
            // Which reader ran is not trivia: an `assimp` row and a `builtin` row
            // for the same file can differ in materials and hierarchy, and a
            // `builtin` row with the fallback marker is how a refused file shows.
            <span
              className={`tlpill ${item.fellBack ? 'tlpill--warn' : ''}`}
              title={t(item.fellBack ? 'tl.engineFellBackTitle' : ENGINE_TITLE_KEY[item.engine])}
            >
              {t(ENGINE_KEY[item.engine])}
              {item.fellBack ? ` ${t('tl.engineFellBack')}` : ''}
            </span>
          )}
          {(item.vertices ?? 0) > 0 && (
            <span className="tlrow__stats mono">
              {t('tl.rowStats', {
                v: formatCount(item.vertices ?? 0),
                p: formatCount(item.polygons ?? 0)
              })}
            </span>
          )}
          <span className="tlrow__size mono">{formatBytes(item.bytes ?? 0)}</span>
          {item.verified && (
            <span className="tlpill tlpill--ok" title={t('tl.verifiedTitle')}>
              {t('tl.verified')}
            </span>
          )}
        </>
      )}
      {message && <span className="tlrow__msg">{message}</span>}
      {item.output && item.status === 'ok' && (
        <button className="btn btn-icon" onClick={onReveal} title={t('tl.reveal')}>
          <Icon name="external" size={11} />
        </button>
      )}
      <button className="btn btn-icon" onClick={onCopy} title={t('tl.copyPath')}>
        <Icon name="copy" size={11} />
      </button>
    </div>
  )
}

/** Read-only recap of what the forge can read, plus the state of the assimp backend. */
function FormatsGroup({
  assimp,
  onLocate,
  busy
}: {
  assimp: AssimpStatus | undefined
  onLocate: () => void
  busy: boolean
}) {
  const { t } = useI18n()
  // The full list runs to forty entries, which is a wall of text in a panel this
  // wide. The count carries the same information and the tooltip has the rest.
  const extra = useMemo(() => {
    if (!assimp?.ready) return undefined
    return assimp.importExts.filter((e) => !BUILTIN_MESH.has(e))
  }, [assimp])

  return (
    <Group title={t('tl.formats')} help={t('help.tl.formats')}>
      <Readout label={t('tl.fmtMesh')} value="obj · stl · ply · x · dae · gltf · glb" />
      {extra && extra.length > 0 && (
        <div className="field" title={extra.join(' · ')}>
          <span className="field__label label">{t('tl.fmtAssimp')}</span>
          <span className="field__value is-wrap mono">
            {t('tl.fmtAssimpValue', { n: String(extra.length), list: extra.slice(0, 12).join(' · ') })}
          </span>
        </div>
      )}
      <Readout label={t('tl.fmtImage')} value="png · jpg · bmp · gif · tga · dds" />
      <Readout label={t('tl.fmtOther')} value={t('tl.fmtOtherValue')} mono={false} />

      <div className="field">
        <span className="field__label label">{t('tl.assimp')}</span>
        <span className="field__value is-wrap mono">
          {assimp === undefined
            ? t('tl.assimpProbing')
            : assimp.ready
              ? t('tl.assimpReady', { v: assimp.version ?? '?', n: String(assimp.importExts.length) })
              : assimp.installed
                ? t(assimp.problem === 'noFbxExport' ? 'tl.assimpNoFbx' : 'tl.assimpUnusable')
                : t('tl.assimpMissing')}
        </span>
      </div>
      {assimp?.exePath && (
        <Readout label={t('tl.assimpPath')} value={shortenPath(assimp.exePath, 4)} />
      )}
      <div className="btnrow">
        <button className="btn" onClick={onLocate} disabled={busy}>
          <Icon name="search" size={13} />
          {assimp?.ready ? t('tl.assimpRelocate') : t('tl.assimpLocate')}
        </button>
      </div>

      <div className="tlnote">
        <Icon name="info" size={12} />
        <span className="label">{t('tl.formatsNote')}</span>
      </div>
    </Group>
  )
}
