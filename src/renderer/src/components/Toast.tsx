import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type ToastKind = 'info' | 'warn' | 'ok'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  notify(text: string, kind?: ToastKind): void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

const ICONS: Record<ToastKind, IconName> = { info: 'info', warn: 'alert', ok: 'check' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const notify = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setItems((prev) => [...prev.slice(-3), { id, kind, text }])
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 2600)
  }, [])

  const api = useMemo<ToastApi>(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <Icon name={ICONS[t.kind]} size={14} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
