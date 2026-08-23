import { useEffect, useState } from 'react'
import { useI18n } from '@renderer/i18n'
import { Icon } from './Icon'

interface TitleBarProps {
  /** Breadcrumb shown after the product name. */
  section?: string
  onHome?: () => void
  busy?: boolean
}

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

        <LangToggle />

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
