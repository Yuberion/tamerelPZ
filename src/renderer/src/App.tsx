import { useCallback, useEffect, useState } from 'react'
import { I18nProvider } from './i18n'
import { HelpProvider } from './components/Hint'
import { TitleBar } from './components/TitleBar'
import { ToastProvider } from './components/Toast'
import { Hub } from './hub/Hub'
import { moduleById, type ModuleId } from './hub/modules'
import { Ledger } from './modules/ledger/Ledger'
import { Loadout } from './modules/loadout/Loadout'
import { Explorer } from './modules/explorer/Explorer'
import { Tools } from './modules/tools/Tools'
import { Auditor } from './modules/auditor/Auditor'
import { WorkshopOverview } from './modules/workshop/WorkshopOverview'
import { Triage } from './modules/cartographer/Cartographer'
import { Outpost } from './modules/outpost/Outpost'
import { useAppStore } from './state/store'

type View = 'hub' | ModuleId

export default function App() {
  const [view, setView] = useState<View>('hub')
  const [navParams, setNavParams] = useState<any>()
  const { scanning } = useAppStore()

  const goHome = useCallback(() => {
    setView('hub')
    setNavParams(undefined)
  }, [])

  // Listen for programmatic cross-module navigation
  useEffect(() => {
    const onNav = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (detail?.module) {
        setView(detail.module)
        setNavParams(detail)
      }
    }
    window.addEventListener('pz:navigate-module', onNav)
    return () => window.removeEventListener('pz:navigate-module', onNav)
  }, [])

  // Escape leaves a module. An open help popover swallows the key first (see
  // HelpProvider), so one press never both closes a hint and navigates away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || view === 'hub') return
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      if (typing) return
      goHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, goHome])

  return (
    <I18nProvider>
      <HelpProvider>
        <ToastProvider>
          <div className="shell">
            <TitleBar
              section={view === 'hub' ? undefined : moduleById(view).name}
              onHome={view === 'hub' ? undefined : goHome}
              busy={scanning}
            />
            <main className="shell__body">
              {view === 'hub' ? <Hub onOpen={setView} /> : null}
              {view === 'explorer' ? <Explorer onExit={goHome} /> : null}
              {view === 'loadout' ? <Loadout onExit={goHome} /> : null}
              {view === 'workshop' ? <WorkshopOverview onExit={goHome} /> : null}
              {view === 'auditor' || view === 'workbench' ? (
                <Auditor
                  onExit={goHome}
                  initialTab={navParams?.subTab}
                  initialModKey={navParams?.modKey}
                />
              ) : null}
              {view === 'triage' || view === 'cartograph' ? <Triage onExit={goHome} /> : null}
              {view === 'tools' ? <Tools onExit={goHome} /> : null}
              {view === 'outpost' ? <Outpost onExit={goHome} /> : null}
              {view === 'ledger' ? <Ledger onExit={goHome} /> : null}
            </main>
          </div>
        </ToastProvider>
      </HelpProvider>
    </I18nProvider>
  )
}
