import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@renderer/i18n'
import { useHelp } from './Hint'
import { Icon } from './Icon'

interface TitleBarProps {
  /** Breadcrumb shown after the product name. */
  section?: string
  onHome?: () => void
  busy?: boolean
}

/** Popover identity for the app overview, which has exactly one anchor. */
const OVERVIEW_ID = 'help.overview'

export function TitleBar({ section, onHome, busy }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)
  const { t } = useI18n()

  useEffect(() => window.pz.window.onState((s) => setMaximized(s.maximized)), [])

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <button
          className="titlebar__mark"
          onClick={onHome}
          title={onHome ? t('title.backToHub') : 'PZ Management'}
          disabled={!onHome}
        >
          <span className="titlebar__mark-text">PZ</span>
        </button>
        <span className="titlebar__name stencil">PZ Management</span>
        <span className="titlebar__author-tag" title="Project Author: Tamerel">by Tamerel</span>

        <LangToggle />
        <HelpToggle />

        {section && (
          <>
            <span className="titlebar__sep">/</span>
            <span className="titlebar__section stencil">{section}</span>
          </>
        )}
        {busy && <Icon name="refresh" size={12} className="spin titlebar__busy" />}
      </div>

      <div className="titlebar__drag" />

      <div className="titlebar__controls">
        <button
          className="wbtn"
          onClick={() => void window.pz.window.minimize()}
          title={t('title.minimise')}
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          className="wbtn"
          onClick={() => void window.pz.window.toggleMaximize()}
          title={maximized ? t('title.restore') : t('title.maximise')}
        >
          <Icon name="square" size={12} />
        </button>
        <button
          className="wbtn wbtn--close"
          onClick={() => void window.pz.window.close()}
          title={t('title.close')}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  )
}

/**
 * Two-segment RU/EN switch. It shows both options with the active one lit rather than
 * only the alternative, so the current language is readable at a glance.
 */
function LangToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="langtoggle" role="group" aria-label={t('lang.toRu')}>
      <button
        type="button"
        className={`langtoggle__opt ${lang === 'ru' ? 'is-on' : ''}`}
        onClick={() => setLang('ru')}
        title={t('lang.toRu')}
        aria-pressed={lang === 'ru'}
      >
        RU
      </button>
      <button
        type="button"
        className={`langtoggle__opt ${lang === 'en' ? 'is-on' : ''}`}
        onClick={() => setLang('en')}
        title={t('lang.toEn')}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
    </div>
  )
}

/**
 * Help mode.
 *
 * Turning it on lights every `?` badge in the app and opens the overview anchored
 * here, so a first-time user gets both the map and the legend from one press. F1 is
 * bound here rather than in the provider because this button is the anchor, and it
 * is mounted exactly once for the lifetime of the window.
 */
function HelpToggle() {
  const { t } = useI18n()
  const help = useHelp()
  const ref = useRef<HTMLButtonElement>(null)

  const activate = useCallback(() => {
    const wasOn = help.enabled
    help.toggle()
    if (wasOn) {
      help.close()
      return
    }
    if (ref.current) {
      help.open(OVERVIEW_ID, ref.current, {
        title: 'PZ Management · by Tamerel',
        body: t('help.app'),
        note: t('help.hotkeys')
      })
    }
  }, [help, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // `repeat` guard: holding the key would otherwise flip help mode per tick.
      if (e.key !== 'F1' || e.repeat) return
      e.preventDefault()
      activate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activate])

  return (
    <button
      ref={ref}
      type="button"
      className={`titlebar__help ${help.enabled ? 'is-on' : ''}`}
      onClick={activate}
      title={t(help.enabled ? 'help.toggleOff' : 'help.toggleOn')}
      aria-pressed={help.enabled}
    >
      ?
    </button>
  )
}
