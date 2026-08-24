import { useMemo, useState } from 'react'
import type {
  ModEntry,
  PackBuilds,
  PackMode,
  PackOptions,
  PackResult,
  PackVisibility
} from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatBytes, formatCount, formatDuration } from '@renderer/lib/format'
import { useAppStore } from '@renderer/state/store'
import {
  Alert,
  CheckField,
  Group,
  OptionCard,
  Panel,
  Readout,
  SelectField,
  TextAreaField,
  TextField
} from './Form'

interface PackToolProps {
  mod: ModEntry
}

const BUILD_OPTIONS: Array<{ value: PackBuilds; labelKey: TKey }> = [
  { value: 'all', labelKey: 'wb.pack.buildsAll' },
  { value: 'b41', labelKey: 'wb.pack.buildsB41' },
  { value: 'b42', labelKey: 'wb.pack.buildsB42' }
]

const VISIBILITY: Array<{ value: PackVisibility; labelKey: TKey }> = [
  { value: 'public', labelKey: 'wb.pack.visPublic' },
  { value: 'friendsOnly', labelKey: 'wb.pack.visFriends' },
  { value: 'private', labelKey: 'wb.pack.visPrivate' },
  { value: 'unlisted', labelKey: 'wb.pack.visUnlisted' }
]

/** Default project/archive name derived from the mod folder. */
function defaultName(mod: ModEntry): string {
  const base = (mod.modId ?? mod.folderName).replace(/[^A-Za-z0-9._+-]+/g, '')
  return base || 'Mod'
}

export function PackTool({ mod }: PackToolProps) {
  const { t, p } = useI18n()
  const { notify } = useToast()
  const { paths } = useAppStore()

  /** The main process defaults packs to `<Zomboid>\Workshop`; mirror it here. */
  const defaultDir = paths?.zomboidDir ? `${paths.zomboidDir}\\Workshop` : t('wb.pack.noZomboid')

  const [mode, setMode] = useState<PackMode>('workshop')
  const [builds, setBuilds] = useState<PackBuilds>('all')
  const [outputName, setOutputName] = useState(() => defaultName(mod))
  const [outputDir, setOutputDir] = useState<string>()
  const [exclude, setExclude] = useState('')
  const [preview, setPreview] = useState(true)

  const [title, setTitle] = useState(mod.name)
  const [description, setDescription] = useState(mod.description ?? '')
  const [tags, setTags] = useState((mod.tags ?? []).join(';'))
  const [visibility, setVisibility] = useState<PackVisibility>('public')
  const [workshopId, setWorkshopId] = useState(mod.workshopId ?? '')

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PackResult>()
  const [error, setError] = useState<string>()

  const nameValid = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(outputName)

  const pick = async (): Promise<void> => {
    const chosen = await window.pz.paths.pickFolder(t('wb.pack.outputDir'))
    if (chosen) setOutputDir(chosen)
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    const opts: PackOptions = {
      modPath: mod.path,
      mode,
      builds,
      outputName,
      outputDir,
      exclude: exclude.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      preview,
      workshop:
        mode === 'workshop'
          ? {
              title: title || mod.name,
              description,
              tags: tags.split(';').map((s) => s.trim()).filter(Boolean),
              visibility,
              id: workshopId.trim()
            }
          : undefined
    }
    try {
      const packed = await window.pz.workbench.pack(opts)
      setResult(packed)
      notify(
        `${t('wb.pack.result')} · ${formatCount(packed.files)} ${p('files', packed.files)}`,
        'ok'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const destination = useMemo(() => {
    const dir = outputDir ?? defaultDir
    return mode === 'zip' ? `${dir}\\${outputName || '…'}.zip` : `${dir}\\${outputName || '…'}`
  }, [outputDir, outputName, mode, defaultDir])

  return (
    <Panel
      title={t('wb.pack.title')}
      lede={t('wb.pack.lede')}
      icon="package"
      actions={
        <button className="btn is-primary" disabled={!nameValid || busy} onClick={() => void run()}>
          <Icon name={busy ? 'refresh' : 'package'} size={13} className={busy ? 'spin' : undefined} />
          {busy ? t('wb.pack.running') : t('wb.pack.run')}
        </button>
      }
    >
      {error && <Alert kind="bad">{error}</Alert>}

      <Group title={t('wb.pack.mode')}>
        <div className="wboptrow">
          <OptionCard
            on={mode === 'workshop'}
            onClick={() => setMode('workshop')}
            label={t('wb.pack.modeWorkshop')}
            hint={t('wb.pack.modeWorkshopHint')}
            icon="server"
          />
          <OptionCard
            on={mode === 'zip'}
            onClick={() => setMode('zip')}
            label={t('wb.pack.modeZip')}
            hint={t('wb.pack.modeZipHint')}
            icon="archive"
          />
        </div>
      </Group>

      <Group title={t('wb.pack.destination')} cols>
        <TextField
          label={mode === 'zip' ? t('wb.pack.outputNameZip') : t('wb.pack.outputName')}
          value={outputName}
          onChange={setOutputName}
          mono
          invalid={outputName.length > 0 && !nameValid}
        />
        <SelectField
          label={t('wb.pack.builds')}
          hint={t('wb.pack.buildsHint')}
          value={builds}
          onChange={setBuilds}
          options={BUILD_OPTIONS.map((b) => ({ value: b.value, label: t(b.labelKey) }))}
        />
        <div className="wbfield wbfield--wide">
          <span className="wbfield__label label">{t('wb.pack.outputDir')}</span>
          <div className="wbpick">
            <input className="wbfield__input mono" value={outputDir ?? ''} readOnly placeholder={defaultDir} />
            <button className="btn" onClick={() => void pick()}>
              <Icon name="folder-open" size={12} />
              {t('wb.pack.pickDir')}
            </button>
            {outputDir && (
              <button className="btn btn-icon" title={t('wb.pack.resetDir')} onClick={() => setOutputDir(undefined)}>
                <Icon name="rotate" size={12} />
              </button>
            )}
          </div>
        </div>
        <Readout label={t('wb.pack.destination')} value={destination} />
      </Group>

      {mode === 'workshop' && (
        <Group title={t('wb.pack.meta')}>
          <div className="wbgrid">
            <TextField label={t('wb.pack.metaTitle')} value={title} onChange={setTitle} wide />
            <TextField
              label={t('wb.pack.metaTags')}
              hint={t('wb.pack.metaTagsHint')}
              value={tags}
              onChange={setTags}
            />
            <SelectField
              label={t('wb.pack.metaVisibility')}
              value={visibility}
              onChange={setVisibility}
              options={VISIBILITY.map((v) => ({ value: v.value, label: t(v.labelKey) }))}
            />
            <TextField
              label={t('wb.pack.metaId')}
              hint={t('wb.pack.metaIdHint')}
              value={workshopId}
              onChange={setWorkshopId}
              mono
            />
            <TextAreaField
              label={t('wb.pack.metaDescription')}
              value={description}
              onChange={setDescription}
              rows={3}
            />
          </div>
          <CheckField label={t('wb.pack.preview')} checked={preview} onChange={setPreview} />
        </Group>
      )}

      <Group title={t('wb.pack.exclude')} hint={t('wb.pack.excludeDefault')}>
        <TextAreaField
          label={t('wb.pack.exclude')}
          hint={t('wb.pack.excludeHint')}
          value={exclude}
          onChange={setExclude}
          rows={2}
          mono
          placeholder={'*.psd\ndocs'}
        />
      </Group>

      {result && (
        <Group title={t('wb.pack.result')}>
          <div className="statgrid">
            <Stat label={t('wb.pack.resultFiles')} value={formatCount(result.files)} />
            <Stat label={t('wb.pack.resultSize')} value={formatBytes(result.bytes)} />
            <Stat
              label={t('wb.pack.resultWritten')}
              value={formatBytes(result.writtenBytes)}
            />
            <Stat label={t('wb.pack.resultSkipped')} value={formatCount(result.skipped)} />
          </div>
          <Readout label={t('wb.pack.resultOutput')} value={result.output} />
          <div className="btnrow">
            <button className="btn" onClick={() => void window.pz.shell.reveal(result.output)}>
              <Icon name="external" size={12} />
              {t('wb.pack.reveal')}
            </button>
          </div>
          {result.mode === 'workshop' && (
            <Alert kind="info">
              <span>
                {t('wb.pack.uploadHint')} · {formatDuration(result.durationMs)}
              </span>
            </Alert>
          )}
        </Group>
      )}
    </Panel>
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
