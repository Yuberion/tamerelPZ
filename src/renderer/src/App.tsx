import { useCallback, useEffect, useState } from 'react'
import { I18nProvider } from './i18n'
import { TitleBar } from './components/TitleBar'
import { ToastProvider } from './components/Toast'
import { Hub } from './hub/Hub'
import { moduleById, type ModuleId } from './hub/modules'
import { Stalker } from './modules/stalker/Stalker'
import { Workbench } from './modules/workbench/Workbench'
import { useAppStore } from './state/store'

type View = 'hub' | ModuleId

export default function App() {
  const [view, setView] = useState<View>('hub')
  const { scanning } = useAppStore()

  const goHome = useCallback(() => setView('hub'), [])

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
      <ToastProvider>
        <div className="shell">
          <TitleBar
            section={view === 'hub' ? undefined : moduleById(view).name}
            onHome={view === 'hub' ? undefined : goHome}
            busy={scanning}
          />
          <main className="shell__body">
            {view === 'hub' ? <Hub onOpen={setView} /> : null}
            {view === 'stalker' ? <Stalker onExit={goHome} /> : null}
            {view === 'workbench' ? <Workbench onExit={goHome} /> : null}
          </main>
        </div>
      </ToastProvider>
    </I18nProvider>
  )
}
