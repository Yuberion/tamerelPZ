import { Alert, CheckField, Group, Panel, Readout } from '@renderer/components/Form'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import type { MemoryStore } from './useMemory'

const PRESETS = [4096, 6144, 8192, 10240, 12288, 16384, 20480, 24576, 32768, 40960, 49152, 61440]

export function MemoryTool({ store }: { store: MemoryStore }) {
  const { t } = useI18n()
  const { notify } = useToast()

  const rep = store.report
  const sys = rep?.system

  const formatGb = (mb: number): string => {
    const gb = mb / 1024
    return gb % 1 === 0 ? `${gb} GB` : `${gb.toFixed(1)} GB`
  }

  const handleApply = async () => {
    const res = await store.apply()
    if (res?.ok) {
      notify(
        t('tl.memAppliedToast', {
          files: res.updatedFiles.join(', '),
          val: `${store.selectedXmxMb} MB`
        }),
        'ok'
      )
    } else if (res?.error) {
      notify(res.error, 'warn')
    }
  }

  const handleToggleReadOnly = async (readOnly: boolean) => {
    const res = await store.toggleReadOnly(readOnly)
    if (res?.ok) {
      notify(t('tl.memReadOnlyChangedToast', { files: res.updatedFiles.join(', ') }), 'ok')
    } else if (res?.error) {
      notify(res.error, 'warn')
    }
  }

  const handleRemoveEnv = async () => {
    const res = await store.setEnv(null)
    if (res?.ok) {
      notify(t('tl.memEnvRemovedToast'), 'ok')
    } else if (res?.error) {
      notify(res.error, 'warn')
    }
  }

  const handleSyncEnv = async () => {
    const gVal = Math.round(store.selectedXmxMb / 1024)
    const res = await store.setEnv(`-Xmx${gVal}G`)
    if (res?.ok) {
      notify(t('tl.memEnvSetToast', { val: `-Xmx${gVal}G` }), 'ok')
    } else if (res?.error) {
      notify(res.error, 'warn')
    }
  }

  const totalMb = sys?.totalMb ?? 16384
  const recommendedMax = sys?.recommendedMaxMb ?? 12288
  const isExceeding = store.selectedXmxMb > totalMb
  const isHigh = !isExceeding && store.selectedXmxMb > totalMb * 0.8

  return (
    <Panel
      title={t('tl.memTitle')}
      lede={t('tl.memLede')}
      icon="hard-drive"
      help={t('help.tl.memory')}
    >
      {store.error && <Alert kind="bad">{store.error}</Alert>}

      {/* 1. System specs & Telemetry */}
      <Group title={t('tl.memGroupSystem')} help={t('help.tl.memSystem')}>
        <div className="wbgrid">
          <Readout
            label={t('tl.memTotalRam')}
            value={`${totalMb.toLocaleString()} MB (${formatGb(totalMb)})`}
          />
          <Readout
            label={t('tl.memFreeRam')}
            value={sys ? `${sys.freeMb.toLocaleString()} MB (${formatGb(sys.freeMb)})` : '—'}
          />
        </div>

        <Readout
          label={t('tl.memRecommendedRange')}
          value={`${sys?.recommendedMinMb ?? 4096} MB (${formatGb(sys?.recommendedMinMb ?? 4096)}) — ${recommendedMax} MB (${formatGb(recommendedMax)})`}
        />

        {rep?.lastSession && (
          <Alert kind="info" title={t('tl.memLastSessionTitle')}>
            {t('tl.memLastSessionBody', {
              jvmMax: `${rep.lastSession.jvmMaxMb} MB (${formatGb(rep.lastSession.jvmMaxMb)})`,
              jvmTotal: `${rep.lastSession.jvmTotalMb} MB`,
              vram: rep.lastSession.vramMb ? `${rep.lastSession.vramMb} MB` : '—',
              ts: rep.lastSession.timestamp ?? '—'
            })}
          </Alert>
        )}
      </Group>

      {/* 2. Allocation configuration */}
      <Group title={t('tl.memGroupAllocation')} help={t('help.tl.memAllocation')}>
        <div className="mem-alloc-box" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '8px' }}>
            <span className="label">{t('tl.memTargetXmx')}:</span>
            <span
              className="mono"
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                color: isExceeding ? 'var(--rust-bad, #e05252)' : 'var(--rust-hot)'
              }}
            >
              {formatGb(store.selectedXmxMb)}
            </span>
            <span className="mono is-dim" style={{ fontSize: '0.9rem' }}>
              ({store.selectedXmxMb} MB)
            </span>
            {isExceeding && (
              <span
                className="badge badge--bad"
                style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Icon name="alert" size={10} />
                &gt; {formatGb(totalMb)} RAM
              </span>
            )}
          </div>

          {/* Quick presets */}
          <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: '12px' }}>
            {PRESETS.map((mb) => {
              const exceeds = mb > totalMb
              const isActive = store.selectedXmxMb === mb
              return (
                <button
                  key={mb}
                  type="button"
                  className={`btn btn--tiny ${isActive ? 'is-active' : ''}`}
                  onClick={() => !exceeds && store.setSelectedXmxMb(mb)}
                  disabled={exceeds || store.busy}
                  title={
                    exceeds
                      ? t('tl.memPresetExceedsTooltip', {
                          preset: formatGb(mb),
                          total: formatGb(totalMb)
                        })
                      : undefined
                  }
                >
                  {formatGb(mb)}
                  {exceeds && <Icon name="lock" size={9} style={{ marginLeft: '4px', opacity: 0.6 }} />}
                </button>
              )
            })}
          </div>

          {/* Range Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="mono is-dim" style={{ fontSize: '0.8rem' }}>2 GB</span>
            <input
              type="range"
              min={2048}
              max={61440}
              step={512}
              value={store.selectedXmxMb}
              onChange={(e) => store.setSelectedXmxMb(parseInt(e.target.value, 10))}
              disabled={store.busy}
              style={{
                flex: 1,
                accentColor: isExceeding ? 'var(--rust-bad, #e05252)' : 'var(--rust-hot)',
                cursor: 'pointer'
              }}
            />
            <span className="mono is-dim" style={{ fontSize: '0.8rem' }}>60 GB</span>
          </div>
        </div>

        {/* Status warnings */}
        {isExceeding ? (
          <Alert kind="bad" title={t('tl.memExceedsRamTitle')}>
            {t('tl.memExceedsRamBody', {
              selected: formatGb(store.selectedXmxMb),
              total: formatGb(totalMb)
            })}
          </Alert>
        ) : isHigh ? (
          <Alert kind="warn" title={t('tl.memWarningHighTitle')}>
            {t('tl.memWarningHighBody')}
          </Alert>
        ) : (
          <Alert kind="info">
            {t('tl.memOptimalNotice', {
              left: formatGb(Math.max(0, totalMb - store.selectedXmxMb))
            })}
          </Alert>
        )}

        {/* Current files status */}
        <div className="wbgrid" style={{ marginTop: '8px' }}>
          <Readout
            label="ProjectZomboid64.json"
            value={
              rep?.clientJson?.exists
                ? `${rep.clientJson.rawXmx || '—'}  ·  ${
                    rep.clientJson.isReadOnly
                      ? '🔒 ' + t('tl.memFileLocked')
                      : '🔓 ' + t('tl.memFileUnlocked')
                  }`
                : t('tl.memFileNotFound')
            }
          />
          <Readout
            label="ProjectZomboid64.bat"
            value={
              rep?.clientBat?.exists
                ? `${rep.clientBat.rawXmx || '—'}  ·  ${
                    rep.clientBat.isReadOnly
                      ? '🔒 ' + t('tl.memFileLocked')
                      : '🔓 ' + t('tl.memFileUnlocked')
                  }`
                : t('tl.memFileNotFound')
            }
          />
        </div>

        {/* Target checkboxes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          <CheckField
            label={t('tl.memTargetJsonLabel')}
            hint={t('tl.memTargetJsonHint')}
            checked={store.targetJson}
            onChange={store.setTargetJson}
            disabled={store.busy}
          />
          <CheckField
            label={t('tl.memTargetBatLabel')}
            hint={t('tl.memTargetBatHint')}
            checked={store.targetBat}
            onChange={store.setTargetBat}
            disabled={store.busy}
          />
          <CheckField
            label={t('tl.memTargetServerBatLabel')}
            hint={t('tl.memTargetServerBatHint')}
            checked={store.targetServerBat}
            onChange={store.setTargetServerBat}
            disabled={store.busy}
          />
          <CheckField
            label={t('tl.memProtectReadOnlyLabel')}
            hint={t('tl.memProtectReadOnlyHint')}
            checked={store.protectReadOnly}
            onChange={store.setProtectReadOnly}
            disabled={store.busy}
          />
        </div>

        {/* Action button */}
        <div className="btnrow" style={{ marginTop: '12px' }}>
          <button
            className="btn is-primary"
            onClick={() => void handleApply()}
            disabled={
              isExceeding ||
              store.busy ||
              (!store.targetJson && !store.targetBat && !store.targetServerBat)
            }
            title={isExceeding ? t('tl.memDisabledExceedsTooltip') : t('tl.memApplyTitle')}
          >
            <Icon name="check" size={13} />
            {t('tl.memApplyBtn')}
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => void handleToggleReadOnly(true)}
            disabled={store.busy || (!store.targetJson && !store.targetBat && !store.targetServerBat)}
            title={t('tl.memLockTitle')}
          >
            <Icon name="lock" size={11} />
            {t('tl.memLockBtn')}
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => void handleToggleReadOnly(false)}
            disabled={store.busy || (!store.targetJson && !store.targetBat && !store.targetServerBat)}
            title={t('tl.memUnlockTitle')}
          >
            <Icon name="rotate" size={11} />
            {t('tl.memUnlockBtn')}
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => void store.refresh()}
            disabled={store.loading || store.busy}
            title={t('tl.nppRefresh')}
          >
            <Icon name="refresh" size={11} className={store.loading ? 'spin' : undefined} />
            {t('tl.nppRefresh')}
          </button>
        </div>
      </Group>

      {/* 3. Windows Environment Variable */}
      <Group title={t('tl.memGroupEnv')} help={t('help.tl.memEnv')}>
        {rep?.envJavaOptions.isOverriding ? (
          <>
            <Alert kind="warn" title={t('tl.memEnvActiveTitle')}>
              {t('tl.memEnvActiveBody', {
                val: rep.envJavaOptions.user ?? rep.envJavaOptions.machine ?? ''
              })}
            </Alert>
            <div className="btnrow" style={{ marginTop: '10px' }}>
              <button
                className="btn btn--tiny is-primary"
                onClick={() => void handleRemoveEnv()}
                disabled={store.busy}
                title={t('tl.memRemoveEnvTitle')}
              >
                <Icon name="trash" size={11} />
                {t('tl.memRemoveEnvBtn')}
              </button>
              <button
                className="btn btn--tiny"
                onClick={() => void handleSyncEnv()}
                disabled={isExceeding || store.busy}
                title={isExceeding ? t('tl.memDisabledExceedsTooltip') : t('tl.memSyncEnvTitle')}
              >
                <Icon name="refresh" size={11} />
                {t('tl.memSyncEnvBtn', { g: Math.round(store.selectedXmxMb / 1024) })}
              </button>
            </div>
          </>
        ) : (
          <>
            <Alert kind="info" title={t('tl.memEnvCleanTitle')}>
              {t('tl.memEnvCleanBody')}
            </Alert>
            <div className="btnrow" style={{ marginTop: '10px' }}>
              <button
                className="btn btn--tiny"
                onClick={() => void handleSyncEnv()}
                disabled={isExceeding || store.busy}
                title={isExceeding ? t('tl.memDisabledExceedsTooltip') : t('tl.memSetEnvTitle')}
              >
                <Icon name="plus" size={11} />
                {t('tl.memSetEnvBtn', { g: Math.round(store.selectedXmxMb / 1024) })}
              </button>
            </div>
          </>
        )}
      </Group>

      {/* 4. Notes on DirectMemory & Pagefile */}
      <Group title={t('tl.memGroupNotes')} help={t('help.tl.memNotes')}>
        <Readout
          label="Direct Memory (Off-Heap)"
          value={t('tl.memNoteDirect')}
          mono={false}
        />
        <Readout
          label="Pagefile.sys"
          value={t('tl.memNotePagefile')}
          mono={false}
        />
      </Group>
    </Panel>
  )
}
