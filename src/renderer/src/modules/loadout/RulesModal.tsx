import { useState } from 'react'
import type { SortingRule } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import { CATEGORY_META, RAW_CATEGORY_ORDER } from './mlos'

interface RulesModalProps {
  modId: string
  modName?: string
  initialRule?: SortingRule
  onSave(rule: SortingRule): Promise<void>
  onDelete(): Promise<void>
  onClose(): void
}

export function RulesModal({
  modId,
  modName,
  initialRule,
  onSave,
  onDelete,
  onClose
}: RulesModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'

  const [after, setAfter] = useState((initialRule?.loadAfter ?? []).join(', '))
  const [before, setBefore] = useState((initialRule?.loadBefore ?? []).join(', '))
  const [incompat, setIncompat] = useState((initialRule?.incompatibleMods ?? []).join(', '))
  const [loadFirst, setLoadFirst] = useState<'on' | 'category' | 'off'>(
    initialRule?.loadFirst ?? 'off'
  )
  const [loadLast, setLoadLast] = useState<'on' | 'category' | 'off'>(
    initialRule?.loadLast ?? 'off'
  )
  const [category, setCategory] = useState<string>(initialRule?.category ?? '')
  const [busy, setBusy] = useState(false)

  const parseCsv = (val: string): string[] =>
    val
      .split(/[,;]/)
      .map((s) => s.trim().replace(/^\\/, ''))
      .filter(Boolean)

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    try {
      const rule: SortingRule = {
        loadAfter: parseCsv(after),
        loadBefore: parseCsv(before),
        incompatibleMods: parseCsv(incompat),
        loadFirst,
        loadLast,
        category: category || undefined
      }
      await onSave(rule)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--rules" onClick={(e) => e.stopPropagation()}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon name="wrench" size={15} color="var(--rust-hot)" />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Правила сортировки (MLOS)' : 'Sorting Rules (MLOS)'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__body">
          <div className="lomodal__modinfo">
            <span className="label is-dim">{isRu ? 'Мод:' : 'Mod:'}</span>
            <span className="lomodal__modname">{modName || modId}</span>
            <span className="mono lomodal__modid">({modId})</span>
          </div>

          <div className="lofield">
            <label className="label">{isRu ? 'Загружать после (loadAfter):' : 'Load After:'}</label>
            <input
              className="lofield__input mono"
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              placeholder="modId1, modId2, ..."
              spellCheck={false}
            />
            <span className="label wbmuted">
              {isRu
                ? 'ID модов через запятую, которые должны загрузиться раньше этого'
                : 'Comma-separated mod IDs that must load before this mod'}
            </span>
          </div>

          <div className="lofield">
            <label className="label">{isRu ? 'Загружать до (loadBefore):' : 'Load Before:'}</label>
            <input
              className="lofield__input mono"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
              placeholder="modId1, modId2, ..."
              spellCheck={false}
            />
            <span className="label wbmuted">
              {isRu
                ? 'ID модов через запятую, которые должны загрузиться позже этого'
                : 'Comma-separated mod IDs that must load after this mod'}
            </span>
          </div>

          <div className="lofield">
            <label className="label">
              {isRu ? 'Несовместимые моды (incompatibleMods):' : 'Incompatible Mods:'}
            </label>
            <input
              className="lofield__input mono"
              value={incompat}
              onChange={(e) => setIncompat(e.target.value)}
              placeholder="modId1, modId2, ..."
              spellCheck={false}
            />
          </div>

          <div className="lofield-grid">
            <div className="lofield">
              <label className="label">loadFirst:</label>
              <select
                className="lofield__select"
                value={loadFirst}
                onChange={(e) => setLoadFirst(e.target.value as 'on' | 'category' | 'off')}
              >
                <option value="off">off ({isRu ? 'обычно' : 'normal'})</option>
                <option value="category">category ({isRu ? 'в начале категории' : 'category top'})</option>
                <option value="on">on ({isRu ? 'в самое начало списка' : 'absolute first'})</option>
              </select>
            </div>

            <div className="lofield">
              <label className="label">loadLast:</label>
              <select
                className="lofield__select"
                value={loadLast}
                onChange={(e) => setLoadLast(e.target.value as 'on' | 'category' | 'off')}
              >
                <option value="off">off ({isRu ? 'обычно' : 'normal'})</option>
                <option value="category">category ({isRu ? 'в конце категории' : 'category bottom'})</option>
                <option value="on">on ({isRu ? 'в самый конец списка' : 'absolute last'})</option>
              </select>
            </div>

            <div className="lofield">
              <label className="label">{isRu ? 'Категория MLOS:' : 'MLOS Category:'}</label>
              <select
                className="lofield__select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">{isRu ? '— автоопределение —' : '— auto-detect —'}</option>
                {RAW_CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {isRu ? `${CATEGORY_META[c].labelRu} (${c})` : `${CATEGORY_META[c].labelEn} (${c})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="lomodal__note">
            <span className="label wbmuted">
              {isRu
                ? 'Правила сохраняются в Zomboid/sorting_rules.txt с автоматическим бэкапом.'
                : 'Rules are persisted to Zomboid/sorting_rules.txt with automatic backup.'}
            </span>
          </div>
        </div>

        <div className="lomodal__foot">
          {initialRule && (
            <button className="btn btn--danger" onClick={() => void handleDelete()} disabled={busy}>
              <Icon name="trash" size={12} />
              {isRu ? 'Удалить правило' : 'Delete Rule'}
            </button>
          )}
          <div className="toolbar__spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {isRu ? 'Отмена' : 'Cancel'}
          </button>
          <button className="btn is-primary" onClick={() => void handleSave()} disabled={busy}>
            <Icon name="save" size={12} />
            {isRu ? 'Сохранить' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
