import { Alert, Group, Panel, Readout } from '@renderer/components/Form'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatBytes } from '@renderer/lib/format'
import type { NppStatus } from '@shared/types'
import type { NppStore } from './useNpp'

const SOURCE_KEY: Record<NonNullable<NppStatus['source']>, TKey> = {
  registry: 'tl.nppSrc.registry',
  known: 'tl.nppSrc.known',
  override: 'tl.nppSrc.override'
}

/**
 * The Notepad++ panel.
 *
 * Three states worth distinguishing, because the useful action differs in each:
 * Notepad++ missing (find it), pack missing (install it), pack stale (update it).
 * The install target is printed in full — it is a folder outside every mod root,
 * and a tool that writes there should say exactly where before it does.
 */
export function NppTool({ store }: { store: NppStore }) {
  const { t } = useI18n()
  const { notify } = useToast()
  const status = store.status

  const installLabel = store.missing ? t('tl.install') : store.stale ? t('tl.update') : t('tl.reinstall')

  // Both paths sit outside every mod root, so main resolves them by name; a
  // refusal is surfaced rather than swallowed as an unhandled rejection.
  const reveal = async (target: 'exe' | 'udl'): Promise<void> => {
    try {
      await window.pz.npp.reveal(target)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'warn')
    }
  }

  return (
    <Panel
      title={t('tl.nppTitle')}
      lede={t('tl.nppLede')}
      icon="edit"
      help={t('help.tl.npp')}
      actions={
        <>
          <button className="btn" onClick={() => void store.locate()} disabled={store.busy} title={t('tl.locateTitle')}>
            <Icon name="search" size={13} />
            {t('tl.locate')}
          </button>
          <button
            className={`btn ${store.missing || store.stale ? 'is-primary' : ''}`}
            onClick={() => {
              void store.install().then((done) => {
                if (!done) return
                notify(t('tl.installedToast', { n: done.written, bytes: formatBytes(done.bytes) }), 'ok')
              })
            }}
            disabled={store.busy}
            title={t('tl.installTitle')}
          >
            <Icon name="download" size={13} />
            {installLabel}
          </button>
          <button
            className="btn btn-icon"
            onClick={() => void store.refresh()}
            disabled={store.loading}
            title={t('tl.nppRefresh')}
          >
            <Icon name="refresh" size={13} className={store.loading ? 'spin' : undefined} />
          </button>
        </>
      }
    >
      {store.error && <Alert kind="bad">{store.error}</Alert>}

      <Group title={t('tl.nppEditor')} help={t('help.tl.nppEditor')}>
        {status && !status.installed && (
          <Alert kind="warn" title={t('tl.nppMissing')}>
            {t('tl.nppMissingBody')}
          </Alert>
        )}
        {status?.installed && (
          <div className="tlok">
            <Icon name="check-circle" size={13} />
            <span>{t('tl.nppFound')}</span>
          </div>
        )}
        <Readout label={t('tl.nppExe')} value={status?.exePath ?? '—'} />
        <Readout label={t('tl.nppVersion')} value={status?.version ?? t('tl.nppUnknownVersion')} />
        <Readout
          label={t('tl.nppSource')}
          value={status?.source ? t(SOURCE_KEY[status.source]) : '—'}
          mono={false}
        />
        <Readout
          label={t('tl.nppLayout')}
          value={status?.portable ? t('tl.nppPortable') : t('tl.nppStandard')}
          mono={false}
        />
        {status?.exePath && (
          <div className="btnrow">
            <button className="btn btn--tiny" onClick={() => void reveal('exe')}>
              <Icon name="external" size={11} />
              {t('tl.nppReveal')}
            </button>
          </div>
        )}
      </Group>

      <Group title={t('tl.packTitle')} hint={t('tl.packHint')} help={t('help.tl.pack')}>
        <div className="tlpack">
          {(status?.files ?? []).map((file) => (
            <div key={file.name} className="tlrow">
              <Icon
                name={file.installed && file.current ? 'check-circle' : file.installed ? 'alert-circle' : 'minus'}
                size={13}
                className="tlrow__kind"
              />
              <span className="tlrow__name">{file.label}</span>
              <span className="tlrow__format mono">{file.name}</span>
              <span className="tlrow__size mono">{file.installed ? formatBytes(file.bytes) : '—'}</span>
              <span className={`tlpill ${file.installed && file.current ? 'tlpill--ok' : 'tlpill--warn'}`}>
                {file.installed
                  ? file.current
                    ? t('tl.packCurrent')
                    : t('tl.packStale')
                  : t('tl.packAbsent')}
              </span>
            </div>
          ))}
        </div>
        <Readout label={t('tl.packVersion')} value={status?.packVersion ?? '—'} />
        <Readout label={t('tl.packInstalledVersion')} value={status?.installedVersion ?? '—'} />
        <Readout label={t('tl.nppUdl')} value={status?.udlDir ?? '—'} />
        <div className="btnrow">
          <button
            className="btn btn--tiny"
            onClick={() => void reveal('udl')}
            disabled={!status?.udlDir}
          >
            <Icon name="folder-open" size={11} />
            {t('tl.revealUdl')}
          </button>
          <button className="btn btn--tiny" onClick={() => void store.loadPreview()}>
            <Icon name="code" size={11} />
            {store.preview.length > 0 ? t('tl.hideXml') : t('tl.showXml')}
          </button>
        </div>
        {(store.missing || store.stale) && <Alert kind="info">{t('tl.nppAfterInstall')}</Alert>}
      </Group>

      <Group title={t('tl.packCovers')} help={t('help.tl.covers')}>
        <Readout label="PZ Script" value={t('tl.coversScript')} mono={false} />
        <Readout label="PZ ModInfo" value={t('tl.coversModInfo')} mono={false} />
        <div className="tlnote">
          <Icon name="info" size={12} />
          <span className="label">{t('tl.nppLangHint')}</span>
        </div>
      </Group>

      {store.preview.map((file) => (
        <Group key={file.name} title={file.name}>
          <pre className="tlxml">{file.text}</pre>
        </Group>
      ))}
    </Panel>
  )
}
