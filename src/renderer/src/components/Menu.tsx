import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  label?: string
  icon?: IconName
  onClick?: () => void
  separator?: boolean
  disabled?: boolean
  hint?: string
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface MenuApi {
  openMenu(event: MouseEvent, items: MenuItem[]): void
}

const MenuContext = createContext<MenuApi | undefined>(undefined)

const ROW_H = 26
const MENU_W = 224

export function MenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MenuState | undefined>(undefined)

  const openMenu = useCallback((event: MouseEvent, items: MenuItem[]) => {
    event.preventDefault()
    event.stopPropagation()
    setState({ x: event.clientX, y: event.clientY, items })
  }, [])

  const close = useCallback(() => setState(undefined), [])

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const onDown = (): void => close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('wheel', onDown, { passive: true })
    window.addEventListener('blur', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('wheel', onDown)
      window.removeEventListener('blur', onDown)
    }
  }, [state, close])

  const api = useMemo<MenuApi>(() => ({ openMenu }), [openMenu])

  const height = state
    ? state.items.reduce((acc, i) => acc + (i.separator ? 7 : ROW_H), 0) + 8
    : 0
  const x = state ? Math.min(state.x, window.innerWidth - MENU_W - 8) : 0
  const y = state ? Math.min(state.y, window.innerHeight - height - 8) : 0

  return (
    <MenuContext.Provider value={api}>
      {children}
      {state && (
        <div className="ctxmenu brackets" style={{ left: x, top: y, width: MENU_W }}>
          {state.items.map((item, i) =>
            item.separator ? (
              <div key={i} className="ctxmenu__sep" />
            ) : (
              <button
                key={i}
                className="ctxmenu__item"
                disabled={item.disabled}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  close()
                  item.onClick?.()
                }}
              >
                <span className="ctxmenu__icon">
                  {item.icon && <Icon name={item.icon} size={13} />}
                </span>
                <span className="ctxmenu__label truncate">{item.label}</span>
                {item.hint && <span className="ctxmenu__hint mono">{item.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </MenuContext.Provider>
  )
}

export function useMenu(): MenuApi {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('useMenu must be used inside MenuProvider')
  return ctx
}
