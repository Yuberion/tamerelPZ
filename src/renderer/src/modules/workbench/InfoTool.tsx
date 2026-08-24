import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModEntry, ModInfoDraft } from '@shared/types'
import { Hint } from '@renderer/components/Hint'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { highlight } from '@renderer/lib/highlight'
import { serializeDraft, parseDraft } from './serializeDraft'
import {
  Alert,
  CheckField,
  Group,
  ListField,
  Panel,
  Readout,
  TextAreaField,
  TextField
} from './Form'

interface InfoToolProps {
  mod: ModEntry
  writable: boolean
}

type Mode = 'form' | 'raw'

/** Deep-ish equality for the editable projection, to drive the dirty flag. */
function sameDraft(a: ModInfoDraft, b: ModInfoDraft): boolean {
  return (
    a.name === b.name &&
    a.id === b.id &&
    a.description === b.description &&
    a.authors === b.authors &&
    a.modVersion === b.modVersion &&
    a.pzVersion === b.pzVersion &&
    a.url === b.url &&
    a.poster === b.poster &&
    a.icon === b.icon &&
    a.requires.join('\u0001') === b.requires.join('\u0001') &&
    a.tags.join('\u0001') === b.tags.join('\u0001') &&
    a.extra.map((e) => `${e.key}=${e.value}`).join('\u0001') ===
      b.extra.map((e) => `${e.key}=${e.value}`).join('\u0001')
  )
}

export function InfoTool({ mod, writable }: InfoToolProps) {
  const { t } = useI18n()
  const { notify } = useToast()

  const [original, setOriginal] = useState<ModInfoDraft>()
  const [draft, setDraft] = useState<ModInfoDraft>()
  const [raw, setRaw] = useState('')
  const [mode, setMode] = useState<Mode>('form')
  const [backup, setBackup] = useState(true)
  const [busy, setBusy] = useState(false)
  const req = useRef(0)

  const load = useCallback(() => {
    const id = ++req.current
    setDraft(undefined)
    setOriginal(undefined)
    void window.pz.workbench.readInfo(mod.path).then((info) => {
      if (id !== req.current) return
      setOriginal(info)
      setDraft(info)
      setRaw(info.raw || serializeDraft(info))
    })
  }, [mod.path])

  useEffect(load, [load])

  const patch = (p: Partial<ModInfoDraft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev))
  }

  const dirtyForm = Boolean(draft && original && !sameDraft(draft, original))
  const dirtyRaw = Boolean(original && mode === 'raw' && raw !== (original.raw || serializeDraft(original)))
  const dirty = mode === 'raw' ? dirtyRaw : dirtyForm

  const save = useCallback(async () => {
    if (!draft || !writable) return
    setBusy(true)
    try {
      const result = await window.pz.workbench.writeInfo(
        mode === 'raw'
          ? { file: draft.file, raw, backup }
          : { file: draft.file, draft, backup }
      )
      notify(result.backupFile ? t('wb.info.savedBackup') : t('wb.info.saved'), 'ok')
      // Reload so the dirty baseline and the raw/form views reconcile.
      const fresh = await window.pz.workbench.readInfo(mod.path)
      setOriginal(fresh)
      setDraft(fresh)
      setRaw(fresh.raw || serializeDraft(fresh))
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    } finally {
      setBusy(false)
    }
  }, [draft, writable, mode, raw, backup, notify, t, mod.path])

  // Ctrl+S saves, matching the tab's title hint.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && writable && !busy) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, writable, busy, save])

  // Switching form → raw serialises the current fields so the text reflects
  // unsaved edits; raw → form reparses the buffer so the fields do the same.
  // Neither direction touches the disk, so no edit is lost by toggling.
  const switchMode = (next: Mode): void => {
    if (next === mode) return
    if (next === 'raw' && draft) setRaw(serializeDraft(draft))
    if (next === 'form' && draft) setDraft(parseDraft(raw, draft))
    setMode(next)
  }

  if (!draft || !original) {
    return <Panel title={t('wb.info.title')} icon="edit"><div className="wbpanel__loading label">…</div></Panel>
  }

  const tokens = highlight(raw, 'ini')

  return (
    <Panel
      title={t('wb.info.title')}
      lede={draft.file}
      icon="edit"
      help={t('help.wb.info.panel')}
      actions={
        <>
          <div className="wbseg">
            <button
              className={`wbseg__opt ${mode === 'form' ? 'is-on' : ''}`}
              onClick={() => switchMode('form')}
            >
              {t('wb.info.form')}
            </button>
            <button
              className={`wbseg__opt ${mode === 'raw' ? 'is-on' : ''}`}
              onClick={() => switchMode('raw')}
            >
              {t('wb.info.raw')}
            </button>
          </div>
          <Hint title={t('wb.info.form')} body={t('help.wb.info.mode')} />
          <button className="btn" disabled={!dirty || busy} onClick={load} title={t('wb.info.revertTitle')}>
            <Icon name="rotate" size={13} />
            {t('wb.info.revert')}
          </button>
          <button
            className="btn is-primary"
            disabled={!dirty || !writable || busy}
            onClick={() => void save()}
            title={t('wb.info.saveTitle')}
          >
            <Icon name={busy ? 'refresh' : 'save'} size={13} className={busy ? 'spin' : undefined} />
            {t('wb.info.save')}
          </button>
        </>
      }
    >
      {!writable && (
        <Alert kind="warn" title={t('wb.readOnly')}>
          {t('wb.readOnlyBody', { roots: t('wb.writeRoots') })}
        </Alert>
      )}
      {!original.exists && (
        <Alert kind="info" title={t('wb.info.missing')}>
          {t('wb.info.missingBody', { file: draft.file })}
        </Alert>
      )}
      {dirty && (
        <div className="wbdirty label">
          <span className="wbdirty__dot" />
          {t('wb.info.dirty')}
        </div>
      )}

      {mode === 'form' ? (
        <>
          <Group title={t('wb.info.form')} cols>
            <TextField
              label={t('wb.sc.name')}
              help={t('help.wb.sc.name')}
              value={draft.name}
              onChange={(v) => patch({ name: v })}
              disabled={!writable}
            />
            <TextField
              label={t('wb.sc.modId')}
              help={t('help.wb.info.id')}
              value={draft.id}
              mono
              onChange={(v) => patch({ id: v })}
              disabled={!writable}
            />
            <TextField
              label={t('wb.sc.author')}
              help={t('help.wb.sc.author')}
              value={draft.authors}
              onChange={(v) => patch({ authors: v })}
              disabled={!writable}
            />
            <TextField
              label={t('wb.sc.modVersion')}
              help={t('help.wb.sc.modVersion')}
              value={draft.modVersion}
              mono
              onChange={(v) => patch({ modVersion: v })}
              disabled={!writable}
            />
            <TextField
              label={t('wb.sc.pzVersion')}
              help={t('help.wb.sc.pzVersion')}
              value={draft.pzVersion}
              mono
              onChange={(v) => patch({ pzVersion: v })}
              disabled={!writable}
            />
            <TextField
              label={t('wb.sc.url')}
              help={t('help.wb.sc.url')}
              value={draft.url}
              mono
              onChange={(v) => patch({ url: v })}
              disabled={!writable}
            />
            <TextField
              label="poster"
              help={t('help.wb.info.poster')}
              value={draft.poster}
              mono
              onChange={(v) => patch({ poster: v })}
              disabled={!writable}
            />
            <TextField
              label="icon"
              help={t('help.wb.info.icon')}
              value={draft.icon}
              mono
              onChange={(v) => patch({ icon: v })}
              disabled={!writable}
            />
            <TextAreaField
              label={t('wb.sc.description')}
              help={t('help.wb.sc.description')}
              value={draft.description}
              onChange={(v) => patch({ description: v })}
              rows={3}
              disabled={!writable}
            />
          </Group>

          <Group title={t('wb.sc.requires')}>
            <ListField
              label={t('wb.sc.requires')}
              hint={t('wb.sc.requiresHint')}
              help={t('help.wb.sc.requires')}
              values={draft.requires}
              onChange={(requires) => patch({ requires })}
              addLabel={t('wb.info.addRequire')}
              removeLabel={t('wb.info.remove')}
              disabled={!writable}
            />
          </Group>

          <Group title={t('wb.sc.tags')}>
            <ListField
              label={t('wb.sc.tags')}
              help={t('help.wb.sc.tags')}
              values={draft.tags}
              onChange={(tags) => patch({ tags })}
              addLabel={t('wb.info.addTag')}
              removeLabel={t('wb.info.remove')}
              disabled={!writable}
            />
          </Group>

          {draft.extra.length > 0 && (
            <Group
              title={t('wb.info.extra')}
              hint={t('wb.info.extraHint')}
              help={t('help.wb.info.extra')}
            >
              {draft.extra.map((e, i) => (
                <Readout key={`${e.key}-${i}`} label={e.key} value={e.value} />
              ))}
            </Group>
          )}

          <Group title="">
            <CheckField
              label={t('wb.info.backup')}
              help={t('help.wb.info.backup')}
              checked={backup}
              onChange={setBackup}
              disabled={!writable}
            />
          </Group>
        </>
      ) : (
        <Group title={t('wb.info.raw')} hint={t('wb.info.rawHint')} help={t('help.wb.info.raw')}>
          <div className="wbraw">
            <textarea
              className="wbraw__input mono"
              value={raw}
              spellCheck={false}
              disabled={!writable}
              onChange={(e) => setRaw(e.target.value)}
            />
            <pre className="wbraw__preview mono" aria-hidden="true">
              {tokens.map((tk, i) =>
                tk.cls ? (
                  <span key={i} className={`tk-${tk.cls}`}>
                    {tk.text}
                  </span>
                ) : (
                  <span key={i}>{tk.text}</span>
                )
              )}
            </pre>
          </div>
          <CheckField
            label={t('wb.info.backup')}
            help={t('help.wb.info.backup')}
            checked={backup}
            onChange={setBackup}
            disabled={!writable}
          />
        </Group>
      )}
    </Panel>
  )
}
