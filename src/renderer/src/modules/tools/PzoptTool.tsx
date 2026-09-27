import { useState } from 'react'
import { Alert, Group, Panel, Readout, TextAreaField } from '@renderer/components/Form'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import type { PzoptStore } from './usePzopt'

export function PzoptTool({ store }: { store: PzoptStore }) {
  const { t } = useI18n()
  const { notify } = useToast()
  const status = store.status
  const staged = status?.staged
  const [showConfig, setShowConfig] = useState(false)

  const handleCheckUpdate = async () => {
    const res = await store.checkUpdate()
    if (res?.hasNewerVersion) {
      notify(
        t('tl.pzoptNewerOnGithubBody', {
          tag: res.latestRelease?.tag ?? '?',
          rev: res.gameRevision ?? '?'
        }),
        'info'
      )
    } else {
      notify(t('tl.pzoptUpToDateToast'), 'ok')
    }
  }

  const handleDownloadToApp = async () => {
    const ok = await store.downloadToProgram()
    if (ok) {
      notify(t('tl.pzoptDownloadToAppToast'), 'ok')
    } else if (store.error) {
      notify(store.error, 'warn')
    }
  }

  const handleApplyToGame = async () => {
    const ok = await store.applyToGame()
    if (ok) {
      notify(t('tl.pzoptAppliedToast'), 'ok')
    } else if (store.error) {
      notify(store.error, 'warn')
    }
  }

  const handleRemoveFromGame = async () => {
    const ok = await store.removeFromGame()
    if (ok) {
      notify(t('tl.pzoptRemovedToast'), 'ok')
    } else if (store.error) {
      notify(store.error, 'warn')
    }
  }

  const handleSaveConfig = async () => {
    const ok = await store.saveConfig()
    if (ok) {
      notify(t('tl.pzoptConfigSaved'), 'ok')
    } else if (store.error) {
      notify(store.error, 'warn')
    }
  }

  const stateClass =
    status?.state === 'ok'
      ? 'tlpill--ok'
      : status?.state === 'mismatch'
        ? 'tlpill--warn'
        : status?.state === 'corrupt'
          ? 'tlpill--bad'
          : 'tlpill--idle'

  return (
    <Panel
      title={t('tl.pzoptTitle')}
      lede={t('tl.pzoptLede')}
      icon="pulse"
      help={t('help.tl.pzopt')}
      actions={
        <>
          <button
            className="btn"
            onClick={handleCheckUpdate}
            disabled={store.busy || store.loading}
            title={t('tl.pzoptCheckUpdateTitle')}
          >
            <Icon name="refresh" size={13} className={store.busy ? 'spin' : undefined} />
            {t('tl.pzoptCheckUpdate')}
          </button>

          {store.updateInfo?.hasNewerVersion && (
            <button
              className="btn is-primary"
              onClick={handleDownloadToApp}
              disabled={store.busy}
              title={t('tl.pzoptDownloadToAppTitle')}
            >
              <Icon
                name={store.busy ? 'refresh' : 'download'}
                size={13}
                className={store.busy ? 'spin' : undefined}
              />
              {store.busy ? t('tl.pzoptDownloading') : t('tl.pzoptDownloadToApp')}
            </button>
          )}

          <button
            className={`btn ${!status?.installed || !status?.isGameUpToDateWithStaged ? 'is-primary' : ''}`}
            onClick={handleApplyToGame}
            disabled={store.busy || status?.gameRunning || !staged?.available}
            title={t('tl.pzoptApplyToGameTitle')}
          >
            <Icon name="check" size={13} />
            {t('tl.pzoptApplyToGame')}
          </button>

          {status?.installed && (
            <button
              className="btn btn--danger"
              onClick={handleRemoveFromGame}
              disabled={store.busy || status?.gameRunning}
              title={t('tl.pzoptRemoveFromGameTitle')}
            >
              <Icon name="trash" size={13} />
              {t('tl.pzoptRemoveFromGame')}
            </button>
          )}
        </>
      }
    >
      {store.error && <Alert kind="bad">{store.error}</Alert>}

      {status?.gameRunning && (
        <Alert kind="warn" title={t('tl.pzoptGameRunningTitle')}>
          {t('tl.pzoptGameRunningBody')}
        </Alert>
      )}

      {status?.state === 'mismatch' && (
        <Alert kind="warn" title={t('tl.pzoptMismatchTitle')}>
          {t('tl.pzoptMismatchBody', {
            gameRev: status.gameRevision ?? '?',
            modRev: status.installedRevision ?? '?'
          })}
        </Alert>
      )}

      {store.updateInfo?.hasNewerVersion && store.updateInfo.latestRelease && (
        <Alert kind="info" title={t('tl.pzoptNewerOnGithubTitle')}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              marginTop: '0.35rem'
            }}
          >
            <span>
              {t('tl.pzoptNewerOnGithubBody', {
                tag: store.updateInfo.latestRelease.tag,
                rev: store.updateInfo.latestRelease.revision
              })}
            </span>
            <button
              className="btn btn--tiny is-primary"
              onClick={handleDownloadToApp}
              disabled={store.busy}
            >
              <Icon
                name={store.busy ? 'refresh' : 'download'}
                size={12}
                className={store.busy ? 'spin' : undefined}
              />
              {store.busy ? t('tl.pzoptDownloading') : t('tl.pzoptDownloadToApp')}
            </button>
          </div>
        </Alert>
      )}

      {store.updateInfo && !store.updateInfo.hasNewerVersion && staged?.available && (
        <Alert kind="info" title={t('tl.pzoptUpToDateTitle')}>
          {t('tl.pzoptUpToDateBody', {
            tag: staged.tag ?? staged.revision ?? '?',
            rev: status?.gameRevision ?? '?'
          })}
        </Alert>
      )}

      {status?.installed && !status?.isGameUpToDateWithStaged && staged?.available && (
        <Alert kind="warn">
          {t('tl.pzoptGameOutdated')}
        </Alert>
      )}

      {/* Stage 1: PZ Management Application Storage */}
      <Group title={t('tl.pzoptStageGroup')} help={t('help.tl.pzoptStage')}>
        <div className="tlrow" style={{ alignItems: 'center', marginBottom: '0.75rem' }}>
          <span
            className={`tlpill ${staged?.available ? 'tlpill--ok' : 'tlpill--idle'}`}
            style={{ fontSize: '0.85rem', padding: '0.3rem 0.7rem' }}
          >
            <Icon name={staged?.available ? 'check-circle' : 'minus'} size={13} />
            {staged?.available ? t('tl.pzoptStagedReady') : t('tl.pzoptStagedMissing')}
          </span>
          {staged?.filesCount ? (
            <span className="mono is-dim" style={{ marginLeft: '0.75rem' }}>
              ({staged.filesCount} {t('tl.pzoptFilesCount')})
            </span>
          ) : null}
        </div>

        <Readout label={t('tl.pzoptStagedRev')} value={staged?.revision ?? '—'} />
        <Readout label={t('tl.pzoptStagedTag')} value={staged?.tag ?? '—'} />
        {staged?.commit && <Readout label={t('tl.pzoptStagedCommit')} value={staged.commit} />}
        <Readout
          label={t('tl.pzoptStagedSource')}
          value={
            staged?.source === 'workshop'
              ? t('tl.pzoptStagedSourceWs')
              : t('tl.pzoptStagedSourceGh')
          }
          mono={false}
        />
        {staged?.downloadedAt && (
          <Readout label={t('tl.pzoptInstalledDate')} value={staged.downloadedAt} />
        )}

        <div className="btnrow" style={{ marginTop: '0.5rem' }}>
          <button
            className="btn btn--tiny"
            onClick={handleDownloadToApp}
            disabled={store.busy}
            title={t('tl.pzoptDownloadToAppTitle')}
          >
            <Icon name="download" size={11} />
            {t('tl.pzoptDownloadToApp')}
          </button>
        </div>
      </Group>

      {/* Stage 2: Project Zomboid Game Integration */}
      <Group title={t('tl.pzoptGameGroup')} help={t('help.tl.pzoptGame')}>
        <div className="tlrow" style={{ alignItems: 'center', marginBottom: '0.75rem' }}>
          <span className={`tlpill ${stateClass}`} style={{ fontSize: '0.85rem', padding: '0.3rem 0.7rem' }}>
            <Icon
              name={
                status?.state === 'ok'
                  ? 'check-circle'
                  : status?.state === 'mismatch'
                    ? 'alert-circle'
                    : status?.state === 'corrupt'
                      ? 'x-circle'
                      : 'minus'
              }
              size={13}
            />
            {status?.state === 'ok'
              ? t('tl.pzoptStateOk')
              : status?.state === 'mismatch'
                ? t('tl.pzoptStateMismatch')
                : status?.state === 'corrupt'
                  ? t('tl.pzoptStateCorrupt')
                  : t('tl.pzoptStateNotInstalled')}
          </span>
          {status?.installed && status.isGameUpToDateWithStaged && (
            <span className="mono is-dim" style={{ marginLeft: '0.75rem', color: 'var(--rust-bright)' }}>
              ({t('tl.pzoptGameSynced')})
            </span>
          )}
        </div>

        <Readout label={t('tl.pzoptGameDir')} value={status?.gameDir ?? t('tl.pzoptNotFound')} />
        <Readout
          label={t('tl.pzoptGameRev')}
          value={status?.gameRevision ? `${status.gameRevision} (Build 42)` : t('tl.pzoptUnknownRev')}
        />
        <Readout
          label={t('tl.pzoptInstalledRev')}
          value={
            status?.installedRevision
              ? `${status.installedRevision}${status.installedCommit ? ` (${status.installedCommit})` : ''}`
              : t('tl.pzoptNotInstalledRev')
          }
        />
        {status?.installedDate && (
          <Readout label={t('tl.pzoptInstalledDate')} value={status.installedDate} />
        )}

        <div className="btnrow" style={{ marginTop: '0.5rem' }}>
          <button
            className={`btn btn--tiny ${!status?.installed || !status?.isGameUpToDateWithStaged ? 'is-primary' : ''}`}
            onClick={handleApplyToGame}
            disabled={store.busy || status?.gameRunning || !staged?.available}
          >
            <Icon name="check" size={11} />
            {t('tl.pzoptApplyToGame')}
          </button>
          {status?.installed && (
            <button
              className="btn btn--tiny btn--danger"
              onClick={handleRemoveFromGame}
              disabled={store.busy || status?.gameRunning}
            >
              <Icon name="trash" size={11} />
              {t('tl.pzoptRemoveFromGame')}
            </button>
          )}
        </div>
      </Group>

      {/* Configuration Group */}
      <Group
        title={t('tl.pzoptConfigGroup')}
        hint={t('tl.pzoptConfigHint')}
        help={t('help.tl.pzoptConfig')}
      >
        <div className="btnrow" style={{ marginBottom: '0.5rem' }}>
          <button
            className="btn btn--tiny"
            onClick={() => setShowConfig(!showConfig)}
            title={t('tl.pzoptToggleConfig')}
          >
            <Icon name={showConfig ? 'chevron-down' : 'chevron-right'} size={12} />
            {showConfig ? t('tl.pzoptHideProperties') : t('tl.pzoptEditProperties')}
          </button>
          {showConfig && store.configDirty && (
            <button
              className="btn btn--tiny is-primary"
              onClick={handleSaveConfig}
              disabled={store.busy}
            >
              <Icon name="save" size={12} />
              {t('tl.pzoptSaveProperties')}
            </button>
          )}
        </div>

        {showConfig && (
          <div style={{ marginTop: '0.5rem' }}>
            <TextAreaField
              label="pzopt.properties"
              value={store.configText}
              onChange={store.setConfigText}
              rows={8}
              mono
              placeholder="# key=value overrides (e.g. enabled=true)"
              hint={t('tl.pzoptPropertiesHint')}
            />
          </div>
        )}
      </Group>
    </Panel>
  )
}
