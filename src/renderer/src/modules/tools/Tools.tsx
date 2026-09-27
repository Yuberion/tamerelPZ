import { useEffect, useState } from 'react'
import { Hint } from '@renderer/components/Hint'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useI18n, type TKey } from '@renderer/i18n'
import { formatBytes, formatCount, shortenPath } from '@renderer/lib/format'
import { ForgeTool } from './ForgeTool'
import { MemoryTool } from './MemoryTool'
import { NppTool } from './NppTool'
import { PzoptTool } from './PzoptTool'
import { useForge } from './useForge'
import { useMemory } from './useMemory'
import { useNpp } from './useNpp'
import { usePzopt } from './usePzopt'

type Tab = 'forge' | 'npp' | 'pzopt' | 'memory'

const TABS: Array<{ id: Tab; labelKey: TKey; icon: IconName }> = [
  { id: 'forge', labelKey: 'tl.tabForge', icon: 'cube' },
  { id: 'npp', labelKey: 'tl.tabNpp', icon: 'edit' },
  { id: 'pzopt', labelKey: 'tl.tabPzopt', icon: 'pulse' },
  { id: 'memory', labelKey: 'tl.tabMemory', icon: 'hard-drive' }
]

const LS_TAB = 'pz.tools.tab'

function readTab(): Tab {
  const v = localStorage.getItem(LS_TAB)
  return v === 'npp' ? 'npp' : v === 'pzopt' ? 'pzopt' : v === 'memory' ? 'memory' : 'forge'
}

/**
 * Tools (module 07) — the workshop drawer.
 *
 * Two tools that share nothing but a toolbar: a converter that turns arbitrary
 * files into FBX, and a Notepad++ bridge that teaches the editor to read Project
 * Zomboid's own file formats. Both hooks are mounted for the module's whole life
 * so a queue survives a tab switch — the forge's queue is the user's work, and
 * losing it because they looked at the other tab would be its own bug.
 */
export function Tools({ onExit }: { onExit: () => void }) {
  const { t, p } = useI18n()
  const [tab, setTab] = useState<Tab>(readTab)
  const forge = useForge()
  const npp = useNpp()
  const pzopt = usePzopt()
  const memory = useMemory()

  useEffect(() => {
    localStorage.setItem(LS_TAB, tab)
  }, [tab])

  const packState = npp.missing ? 'missing' : npp.stale ? 'stale' : 'ok'
  const pzoptState = pzopt.status?.state ?? 'not_installed'

  return (
    <div className="tools">
      <div className="toolbar">
        <div className="toolbar__row">
          <button className="btn" onClick={onExit} title={t('tb.backToHub')}>
            <Icon name="arrow-left" size={13} />
            {t('tb.hub')}
          </button>
          <div className="divider-v" />
          <div className="wbtabs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                className={`wbtab ${tab === entry.id ? 'is-on' : ''}`}
                onClick={() => setTab(entry.id)}
              >
                <Icon name={entry.icon} size={13} />
                <span className="wbtab__label stencil">{t(entry.labelKey)}</span>
              </button>
            ))}
          </div>
          <Hint title={t('module.tools.tagline')} body={t('help.tl.tabs')} />

          <div className="toolbar__spacer" />

          {tab === 'forge' && forge.inputs.length > 0 && (
            <span className="label toolbar__legend">
              {formatCount(forge.inputs.length)} {p('files', forge.inputs.length)}
            </span>
          )}
          {tab === 'npp' && (
            <span className={`tlpill ${packState === 'ok' ? 'tlpill--ok' : 'tlpill--warn'}`}>
              {packState === 'ok' ? t('tl.packCurrent') : packState === 'stale' ? t('tl.packStale') : t('tl.packAbsent')}
            </span>
          )}
          {tab === 'pzopt' && (
            <span
              className={`tlpill ${
                pzoptState === 'ok'
                  ? 'tlpill--ok'
                  : pzoptState === 'mismatch'
                    ? 'tlpill--warn'
                    : pzoptState === 'corrupt'
                      ? 'tlpill--bad'
                      : 'tlpill--idle'
              }`}
            >
              {pzoptState === 'ok'
                ? t('tl.pzoptStateOk')
                : pzoptState === 'mismatch'
                  ? t('tl.pzoptStateMismatch')
                  : pzoptState === 'corrupt'
                    ? t('tl.pzoptStateCorrupt')
                    : t('tl.pzoptStateNotInstalled')}
            </span>
          )}
          {tab === 'memory' && (
            <span className="tlpill tlpill--ok">
              {`${(memory.selectedXmxMb / 1024).toFixed(1)} GB RAM`}
            </span>
          )}
        </div>
      </div>

      <div className="tools__body">
        <section className="pane pane--center tools__main">
          {tab === 'forge' ? (
            <ForgeTool store={forge} />
          ) : tab === 'npp' ? (
            <NppTool store={npp} />
          ) : tab === 'pzopt' ? (
            <PzoptTool store={pzopt} />
          ) : (
            <MemoryTool store={memory} />
          )}
        </section>
      </div>

      <footer className="statusbar mono">
        <Icon name="hammer" size={12} />
        {tab === 'forge' ? (
          <>
            <span>{t('tl.sbEncoding', { v: forge.options.encoding })}</span>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">{t('tl.sbScale', { v: forge.options.scaleText })}</span>
            {forge.result && (
              <>
                <span className="statusbar__sep">·</span>
                <span className={forge.result.errors > 0 ? 'is-warn' : 'is-dim'}>
                  {t('tl.sbLastRun', {
                    ok: formatCount(forge.result.ok),
                    bad: formatCount(forge.result.errors)
                  })}
                </span>
              </>
            )}
            <span className="statusbar__spacer" />
            <span className="statusbar__path" title={forge.outputDir}>
              {forge.options.outputMode === 'beside'
                ? t('tl.destBeside')
                : forge.outputDir
                  ? shortenPath(forge.outputDir, 4)
                  : t('tl.noFolder')}
            </span>
          </>
        ) : tab === 'npp' ? (
          <>
            <span>{npp.status?.installed ? t('tl.nppFound') : t('tl.nppMissing')}</span>
            {npp.status?.version && (
              <>
                <span className="statusbar__sep">·</span>
                <span className="is-dim">{npp.status.version}</span>
              </>
            )}
            <span className="statusbar__sep">·</span>
            <span className="is-dim">
              {t('tl.sbPack', {
                v: npp.status?.installedVersion ?? '—',
                size: formatBytes((npp.status?.files ?? []).reduce((n, f) => n + f.bytes, 0))
              })}
            </span>
            <span className="statusbar__spacer" />
            <span className="statusbar__path" title={npp.status?.udlDir}>
              {npp.status?.udlDir ? shortenPath(npp.status.udlDir, 3) : '—'}
            </span>
          </>
        ) : tab === 'memory' ? (
          <>
            <span>{t('tl.memSbConfigured', { xmx: `${memory.selectedXmxMb} MB` })}</span>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">
              {t('tl.memSbSystem', { total: `${memory.report?.system.totalMb ?? '—'} MB` })}
            </span>
            {memory.report?.envJavaOptions.isOverriding && (
              <>
                <span className="statusbar__sep">·</span>
                <span className="is-warn">
                  {t('tl.memSbEnvOverride', { val: memory.report.envJavaOptions.user ?? memory.report.envJavaOptions.machine ?? '' })}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <span>
              {pzopt.status?.installed
                ? t('tl.pzoptSbInstalled', { rev: pzopt.status.installedRevision ?? '—' })
                : t('tl.pzoptSbNotInstalled')}
            </span>
            <span className="statusbar__sep">·</span>
            <span className="is-dim">
              {t('tl.pzoptSbGameRev', { rev: pzopt.status?.gameRevision ?? '—' })}
            </span>
            <span className="statusbar__spacer" />
            <span className="statusbar__path" title={pzopt.status?.gameDir}>
              {pzopt.status?.gameDir ? shortenPath(pzopt.status.gameDir, 4) : '—'}
            </span>
          </>
        )}
      </footer>
    </div>
  )
}
