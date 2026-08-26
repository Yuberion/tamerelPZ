import { useMemo, useState } from 'react'
import type { AuthoringTarget, ScaffoldFolder, ScaffoldLayout, ScaffoldOptions } from '@shared/types'
import {
  Alert,
  CheckField,
  Group,
  ListField,
  OptionCard,
  Panel,
  Readout,
  SelectField,
  TextAreaField,
  TextField
} from '@renderer/components/Form'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { sourceLabel } from '@renderer/lib/catmeta'
import { formatCount } from '@renderer/lib/format'

const FOLDER_OPTIONS: Array<{ id: ScaffoldFolder; labelKey: TKey }> = [
  { id: 'lua-client', labelKey: 'wb.sc.folderLuaClient' },
  { id: 'lua-server', labelKey: 'wb.sc.folderLuaServer' },
  { id: 'lua-shared', labelKey: 'wb.sc.folderLuaShared' },
  { id: 'scripts', labelKey: 'wb.sc.folderScripts' },
  { id: 'textures', labelKey: 'wb.sc.folderTextures' },
  { id: 'sounds', labelKey: 'wb.sc.folderSounds' },
  { id: 'models', labelKey: 'wb.sc.folderModels' },
  { id: 'translate', labelKey: 'wb.sc.folderTranslate' },
  { id: 'maps', labelKey: 'wb.sc.folderMaps' },
  { id: 'ui', labelKey: 'wb.sc.folderUi' }
]

const LAYOUTS: Array<{ id: ScaffoldLayout; labelKey: TKey; hintKey: TKey }> = [
  { id: 'b42', labelKey: 'wb.sc.layoutB42', hintKey: 'wb.sc.layoutB42Hint' },
  { id: 'b41', labelKey: 'wb.sc.layoutB41', hintKey: 'wb.sc.layoutB41Hint' },
  { id: 'both', labelKey: 'wb.sc.layoutBoth', hintKey: 'wb.sc.layoutBothHint' }
]

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/

interface ScaffoldToolProps {
  targets: AuthoringTarget[]
  onCreated: (modPath: string) => void
}

export function ScaffoldTool({ targets, onCreated }: ScaffoldToolProps) {
  const { t, p } = useI18n()
  const { notify } = useToast()

  const [folderName, setFolderName] = useState('')
  const [modId, setModId] = useState('')
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [modVersion, setModVersion] = useState('1.0.0')
  const [pzVersion, setPzVersion] = useState('42.0.0')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState('')
  const [requires, setRequires] = useState<string[]>([])
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [layout, setLayout] = useState<ScaffoldLayout>('b42')
  const [folders, setFolders] = useState<Set<ScaffoldFolder>>(
    () => new Set<ScaffoldFolder>(['lua-shared', 'scripts'])
  )
  const [examples, setExamples] = useState(true)
  const [poster, setPoster] = useState(true)
  const [busy, setBusy] = useState(false)

  // Keep the mod id and folder name in step with the display name until the
  // author edits them directly, so the common case needs one field.
  const [idTouched, setIdTouched] = useState(false)
  const [folderTouched, setFolderTouched] = useState(false)

  const slug = (value: string): string =>
    value
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._+-]+/g, '')
      .slice(0, 64)

  const onName = (value: string): void => {
    setName(value)
    if (!idTouched) setModId(slug(value))
    if (!folderTouched) setFolderName(slug(value))
  }

  const target = targets.find((tg) => tg.id === targetId)
  const folderValid = NAME_RE.test(folderName)
  const idValid = NAME_RE.test(modId)
  const canCreate = folderValid && idValid && Boolean(target) && !busy

  const preview = useMemo(() => {
    const base = target ? `${target.path}\\${folderName || '…'}` : (folderName || '…')
    if (layout === 'b41') return `${base}\\media, ${base}\\mod.info`
    if (layout === 'b42') return `${base}\\common\\media, ${base}\\common\\mod.info`
    return `${base}\\common\\…, ${base}\\41\\…`
  }, [target, folderName, layout])

  const toggleFolder = (id: ScaffoldFolder): void => {
    setFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    const opts: ScaffoldOptions = {
      targetId: target.id,
      folderName,
      modId,
      name: name || folderName,
      author,
      description,
      modVersion,
      pzVersion,
      url,
      layout,
      tags: tags.split(';').map((s) => s.trim()).filter(Boolean),
      requires: requires.map((r) => r.trim()).filter(Boolean),
      folders: [...folders],
      examples,
      poster
    }
    try {
      const result = await window.pz.workbench.scaffold(opts)
      notify(
        `${t('wb.sc.created', { name: name || folderName })} · ${t('wb.sc.createdFiles', {
          n: formatCount(result.created.length),
          entries: p('entries', result.created.length)
        })}`,
        'ok'
      )
      onCreated(result.modPath)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (targets.length === 0) {
    return (
      <Panel title={t('wb.sc.title')} lede={t('wb.sc.lede')} icon="folder-plus">
        <Alert kind="warn" title={t('wb.sc.noTarget')}>
          {t('wb.noModsHint')}
        </Alert>
      </Panel>
    )
  }

  return (
    <Panel
      title={t('wb.sc.title')}
      lede={t('wb.sc.lede')}
      icon="folder-plus"
      help={t('help.wb.sc.panel')}
      actions={
        <button className="btn is-primary" disabled={!canCreate} onClick={() => void create()}>
          <Icon name={busy ? 'refresh' : 'folder-plus'} size={13} className={busy ? 'spin' : undefined} />
          {t('wb.sc.create')}
        </button>
      }
    >
      <Group title={t('wb.sc.identity')} cols>
        <TextField
          label={t('wb.sc.name')}
          help={t('help.wb.sc.name')}
          value={name}
          onChange={onName}
          placeholder="My Mod"
        />
        <TextField
          label={t('wb.sc.author')}
          help={t('help.wb.sc.author')}
          value={author}
          onChange={setAuthor}
        />
        <TextField
          label={t('wb.sc.folderName')}
          hint={t('wb.sc.folderHint')}
          help={t('help.wb.sc.folderName')}
          value={folderName}
          mono
          invalid={folderName.length > 0 && !folderValid}
          onChange={(v) => {
            setFolderTouched(true)
            setFolderName(v)
          }}
        />
        <TextField
          label={t('wb.sc.modId')}
          hint={t('wb.sc.modIdHint')}
          help={t('help.wb.sc.modId')}
          value={modId}
          mono
          invalid={modId.length > 0 && !idValid}
          onChange={(v) => {
            setIdTouched(true)
            setModId(v)
          }}
        />
        <TextField
          label={t('wb.sc.modVersion')}
          help={t('help.wb.sc.modVersion')}
          value={modVersion}
          onChange={setModVersion}
          mono
        />
        <TextField
          label={t('wb.sc.pzVersion')}
          help={t('help.wb.sc.pzVersion')}
          value={pzVersion}
          onChange={setPzVersion}
          mono
        />
        <TextAreaField
          label={t('wb.sc.description')}
          help={t('help.wb.sc.description')}
          value={description}
          onChange={setDescription}
          rows={2}
        />
        <TextField
          label={t('wb.sc.url')}
          help={t('help.wb.sc.url')}
          value={url}
          onChange={setUrl}
          mono
          wide
        />
        <TextField
          label={t('wb.sc.tags')}
          hint={t('wb.sc.tagsHint')}
          help={t('help.wb.sc.tags')}
          value={tags}
          onChange={setTags}
        />
        <ListField
          label={t('wb.sc.requires')}
          hint={t('wb.sc.requiresHint')}
          help={t('help.wb.sc.requires')}
          values={requires}
          onChange={setRequires}
          addLabel={t('wb.info.addRequire')}
          removeLabel={t('wb.info.remove')}
        />
      </Group>

      <Group title={t('wb.sc.destination')}>
        <SelectField
          label={t('wb.sc.destination')}
          help={t('help.wb.sc.destination')}
          value={targetId}
          onChange={setTargetId}
          options={targets.map((tg) => ({
            value: tg.id,
            label: `${sourceLabel(tg, t)}${tg.exists ? '' : ` (${t('wb.sc.targetMissing')})`}`
          }))}
        />
      </Group>

      <Group title={t('wb.sc.layout')} help={t('help.wb.sc.layout')}>
        <div className="wboptrow">
          {LAYOUTS.map((l) => (
            <OptionCard
              key={l.id}
              on={layout === l.id}
              onClick={() => setLayout(l.id)}
              label={t(l.labelKey)}
              hint={t(l.hintKey)}
            />
          ))}
        </div>
      </Group>

      <Group title={t('wb.sc.contents')} help={t('help.wb.sc.contents')}>
        <div className="wbchips">
          {FOLDER_OPTIONS.map((f) => {
            const on = folders.has(f.id)
            return (
              <button
                key={f.id}
                type="button"
                className={`chip ${on ? 'is-on' : ''}`}
                onClick={() => toggleFolder(f.id)}
              >
                {on && <Icon name="check" size={11} />}
                {t(f.labelKey)}
              </button>
            )
          })}
        </div>
        <div className="wbstack">
          <CheckField
            label={t('wb.sc.examples')}
            hint={t('wb.sc.examplesHint')}
            help={t('help.wb.sc.examples')}
            checked={examples}
            onChange={setExamples}
          />
          <CheckField
            label={t('wb.sc.poster')}
            hint={t('wb.sc.posterHint')}
            help={t('help.wb.sc.poster')}
            checked={poster}
            onChange={setPoster}
          />
        </div>
        <Readout label={t('wb.sc.willCreate')} value={preview} />
      </Group>
    </Panel>
  )
}
