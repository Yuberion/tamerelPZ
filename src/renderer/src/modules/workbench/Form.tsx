import type { ChangeEvent, ReactNode } from 'react'
import { Icon, type IconName } from '@renderer/components/Icon'

/**
 * Form primitives shared by the four Workbench tools.
 *
 * Deliberately thin wrappers over native controls: the suite has no component
 * library, and the panels only need consistent label/hint/invalid framing.
 */

export function Panel({
  title,
  lede,
  icon,
  actions,
  children
}: {
  title: string
  lede?: string
  icon: IconName
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="wbpanel">
      <div className="wbpanel__head">
        <Icon name={icon} size={17} color="var(--rust-hot)" strokeWidth={1.4} />
        <div className="wbpanel__titles">
          <h2 className="wbpanel__title stencil">{title}</h2>
          {lede && <p className="wbpanel__lede">{lede}</p>}
        </div>
        {actions && <div className="wbpanel__actions">{actions}</div>}
      </div>
      <div className="wbpanel__body">{children}</div>
    </div>
  )
}

export function Group({
  title,
  hint,
  children,
  cols
}: {
  title: string
  hint?: string
  children: ReactNode
  /** Lay the fields out in two columns. */
  cols?: boolean
}) {
  return (
    <section className="isect wbgroup">
      <div className="isect__head">
        <span className="label">{title}</span>
        <span className="isect__rule" />
      </div>
      {hint && <p className="wbgroup__hint">{hint}</p>}
      <div className={cols ? 'wbgrid' : 'wbstack'}>{children}</div>
    </section>
  )
}

interface BaseFieldProps {
  label: string
  hint?: string
  invalid?: boolean
  disabled?: boolean
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  invalid,
  disabled,
  wide
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
  wide?: boolean
}) {
  return (
    <label className={`wbfield ${wide ? 'wbfield--wide' : ''}`}>
      <span className="wbfield__label label">{label}</span>
      <input
        className={`wbfield__input ${mono ? 'mono' : ''} ${invalid ? 'is-invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      {hint && <span className="wbfield__hint">{hint}</span>}
    </label>
  )
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  mono,
  disabled,
  placeholder
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  rows?: number
  mono?: boolean
  placeholder?: string
}) {
  return (
    <label className="wbfield wbfield--wide">
      <span className="wbfield__label label">{label}</span>
      <textarea
        className={`wbfield__input wbfield__area ${mono ? 'mono' : ''}`}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      />
      {hint && <span className="wbfield__hint">{hint}</span>}
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled
}: BaseFieldProps & {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <label className="wbfield">
      <span className="wbfield__label label">{label}</span>
      <select
        className="wbfield__input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="wbfield__hint">{hint}</span>}
    </label>
  )
}

export function CheckField({
  label,
  hint,
  checked,
  onChange,
  disabled
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`wbcheck ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="wbcheck__box">{checked && <Icon name="check" size={10} />}</span>
      <span className="wbcheck__text">
        <span className="wbcheck__label">{label}</span>
        {hint && <span className="wbcheck__hint">{hint}</span>}
      </span>
    </label>
  )
}

/** Radio rendered as a card: used for build layout and pack mode. */
export function OptionCard({
  on,
  onClick,
  label,
  hint,
  icon,
  disabled
}: {
  on: boolean
  onClick: () => void
  label: string
  hint?: string
  icon?: IconName
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`wbopt ${on ? 'is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={15} />}
      <span className="wbopt__text">
        <span className="wbopt__label stencil">{label}</span>
        {hint && <span className="wbopt__hint mono">{hint}</span>}
      </span>
      {on && <Icon name="check" size={12} className="wbopt__tick" />}
    </button>
  )
}

/** Editable list of single-line values (`require=` entries, tags). */
export function ListField({
  label,
  hint,
  values,
  onChange,
  addLabel,
  removeLabel,
  placeholder,
  disabled
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (values: string[]) => void
  addLabel: string
  removeLabel: string
  placeholder?: string
  disabled?: boolean
}) {
  const set = (index: number, value: string): void => {
    onChange(values.map((v, i) => (i === index ? value : v)))
  }
  return (
    <div className="wbfield wbfield--wide">
      <span className="wbfield__label label">{label}</span>
      <div className="wblist">
        {values.map((value, i) => (
          <div key={i} className="wblist__row">
            <input
              className="wbfield__input mono"
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => set(i, e.target.value)}
            />
            <button
              className="btn btn-icon"
              type="button"
              title={removeLabel}
              disabled={disabled}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
        <button
          className="btn btn--tiny"
          type="button"
          disabled={disabled}
          onClick={() => onChange([...values, ''])}
        >
          <Icon name="plus" size={11} />
          {addLabel}
        </button>
      </div>
      {hint && <span className="wbfield__hint">{hint}</span>}
    </div>
  )
}

export function Alert({
  kind,
  title,
  children
}: {
  kind: 'bad' | 'warn' | 'info'
  title?: string
  children?: ReactNode
}) {
  const icon: IconName = kind === 'bad' ? 'x-circle' : kind === 'warn' ? 'alert' : 'info'
  return (
    <div className={`alert ${kind === 'info' ? '' : `alert--${kind}`}`}>
      <Icon name={icon} size={13} />
      <div>
        {title && <strong>{title}</strong>}
        {title && children ? ' ' : null}
        {children}
      </div>
    </div>
  )
}

/** Read-only key/value line, used for resolved paths and result summaries. */
export function Readout({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <span className="field__label label">{label}</span>
      <span className={`field__value is-wrap ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  )
}
