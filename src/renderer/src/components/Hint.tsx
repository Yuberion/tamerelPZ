import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useI18n } from '@renderer/i18n'
import { Icon } from './Icon'

/**
 * Inline help.
 *
 * Native `title=` tooltips name a control; they cannot explain it. Anything whose
 * consequence is not obvious from its label — every mod.info field, the pack modes,
 * the grouping and filter controls — carries a small `?` button instead, which opens
 * one shared popover with a plain-language explanation.
 *
 * Only one popover exists at a time: it is owned by the provider, not by the button,
 * so opening a second hint replaces the first and nothing can pile up on screen.
 *
 * `help mode` (the titlebar `?` or F1) lights every button at once. Without it the
 * badges are quiet enough to ignore; with it they are the fastest way to learn the
 * interface, which is the point.
 */

const STORAGE_KEY = 'pz.help'

export interface HintText {
  /** Normally the label of the control the hint belongs to. */
  title: string
  body: string
  /** Second, dimmer paragraph: defaults, caveats, hotkeys. */
  note?: string
}

interface Popover extends HintText {
  id: string
  /** Anchor geometry, captured on open. Scrolling or resizing dismisses instead. */
  left: number
  top: number
  bottom: number
}

interface HelpApi {
  /** True while every hint badge is highlighted. */
  enabled: boolean
  toggle: () => void
  openId: string | undefined
  open: (id: string, anchor: HTMLElement, text: HintText) => void
  close: () => void
}

const HelpContext = createContext<HelpApi | undefined>(undefined)

const POP_W = 322
/** Room needed below the anchor before the popover flips above it. */
const POP_MIN_H = 200

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    /* private mode / storage disabled */
    return false
  }
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(readStored)
  const [pop, setPop] = useState<Popover>()
  const { t } = useI18n()

  const close = useCallback(() => setPop(undefined), [])

  const open = useCallback((id: string, anchor: HTMLElement, text: HintText) => {
    const r = anchor.getBoundingClientRect()
    setPop({ id, ...text, left: r.left, top: r.top, bottom: r.bottom })
  }, [])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.body.classList.toggle('is-help', enabled)
    return () => document.body.classList.remove('is-help')
  }, [enabled])

  /*
   * Dismissal. Escape is captured so that it belongs to the popover and nothing
   * else: the module handlers (back to hub, clear search) are bubble listeners on
   * window, so stopping propagation here keeps one Escape from doing two things.
   *
   * A mousedown inside the popover or on any hint badge is left alone — the first
   * so text stays selectable, the second so a badge can toggle itself shut.
   */
  useEffect(() => {
    if (!pop) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    const onDown = (e: MouseEvent): void => {
      const el = e.target
      if (el instanceof Element && el.closest('.hintpop, .hint')) return
      close()
    }
    // The anchor rect is captured once, so any scroll underneath invalidates it —
    // except a scroll inside the popover itself, which is a long hint being read.
    const onWheel = (e: WheelEvent): void => {
      const el = e.target
      if (el instanceof Element && el.closest('.hintpop')) return
      close()
    }
    const onAway = (): void => close()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('resize', onAway)
    window.addEventListener('blur', onAway)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('blur', onAway)
    }
  }, [pop, close])

  const api = useMemo<HelpApi>(
    () => ({ enabled, toggle, openId: pop?.id, open, close }),
    [enabled, toggle, pop, open, close]
  )

  // Clamp horizontally, and flip above the anchor when the bottom of the window is
  // too close. The height is unknown before paint, so the flipped case anchors the
  // popover by its bottom edge instead of measuring.
  const left = pop
    ? Math.min(Math.max(8, pop.left - 10), Math.max(8, window.innerWidth - POP_W - 8))
    : 0
  const below = pop ? window.innerHeight - pop.bottom > POP_MIN_H : true

  return (
    <HelpContext.Provider value={api}>
      {children}
      {pop && (
        <div
          className="hintpop brackets"
          role="dialog"
          aria-label={pop.title}
          style={
            below
              ? { left, top: pop.bottom + 7, width: POP_W }
              : { left, bottom: window.innerHeight - pop.top + 7, width: POP_W }
          }
        >
          <div className="hintpop__head">
            <Icon name="info" size={13} color="var(--rust-hot)" />
            <span className="hintpop__title stencil truncate">{pop.title}</span>
            <button
              type="button"
              className="hintpop__close"
              onClick={close}
              title={t('help.close')}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <p className="hintpop__body">{pop.body}</p>
          {pop.note && <p className="hintpop__note">{pop.note}</p>}
        </div>
      )}
    </HelpContext.Provider>
  )
}

export function useHelp(): HelpApi {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error('useHelp must be used inside HelpProvider')
  return ctx
}

/**
 * The `?` badge. Drop it next to a label; it needs no wiring beyond its text.
 *
 * `preventDefault` matters: several fields wrap their control in a `<label>`, and
 * without it a click here would also focus the input or flip the checkbox.
 */
export function Hint({ title, body, note, className }: HintText & { className?: string }) {
  const help = useHelp()
  const { t } = useI18n()
  const id = useId()
  const ref = useRef<HTMLButtonElement>(null)
  const on = help.openId === id
  const label = t('help.aria', { name: title })

  return (
    <button
      ref={ref}
      type="button"
      className={`hint ${on ? 'is-on' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-expanded={on}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (on) help.close()
        else if (ref.current) help.open(id, ref.current, { title, body, note })
      }}
    >
      ?
    </button>
  )
}
