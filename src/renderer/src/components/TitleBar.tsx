import { useEffect, useState } from 'react'
import { Icon } from './Icon'

interface TitleBarProps {
  /** Breadcrumb shown after the product name. */
  section?: string
  onHome?: () => void
  busy?: boolean
}

export function TitleBar({ section, onHome, busy }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.pz.window.onState((s) => setMaximized(s.maximized)), [])

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <button
          className="titlebar__mark"
          onClick={onHome}
          title={onHome ? 'Back to hub' : 'PZ Management'}
          disabled={!onHome}
        >
          <span className="titlebar__mark-text">PZ</span>
        </button>
        <span className="titlebar__name stencil">PZ Management</span>
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
        <button className="wbtn" onClick={() => void window.pz.window.minimize()} title="Minimise">
          <Icon name="minus" size={14} />
        </button>
        <button
          className="wbtn"
          onClick={() => void window.pz.window.toggleMaximize()}
          title={maximized ? 'Restore' : 'Maximise'}
        >
          <Icon name="square" size={12} />
        </button>
        <button
          className="wbtn wbtn--close"
          onClick={() => void window.pz.window.close()}
          title="Close"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  )
}
