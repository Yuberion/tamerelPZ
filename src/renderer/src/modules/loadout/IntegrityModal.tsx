import { useMemo, useState } from 'react'
import type { ModEntry, SortingRule } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useI18n } from '@renderer/i18n'
import { bareId } from './useLoadout'
import { isSeparator } from './OrderList'
import { sortModsMLOS } from './mlos'

interface IntegrityModalProps {
  activeList: string[]
  byModId: Map<string, ModEntry>
  rules: Record<string, SortingRule>
  luaDeps: Record<string, string[]>
  onApplyFixed(fixed: string[]): void
  onClose(): void
}

interface IssueItem {
  id: string
  type: 'cycle' | 'missing' | 'order' | 'rule' | 'incompatible'
  severity: 'error' | 'warn'
  modId: string
  targetModId?: string
  message: string
  details?: string
  canAutoFix: boolean
}

export function IntegrityModal({
  activeList,
  byModId,
  rules,
  luaDeps,
  onApplyFixed,
  onClose
}: IntegrityModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warn'>('all')

  // Run full integrity analysis
  const issues = useMemo(() => {
    const list: IssueItem[] = []
    const cleanMods = activeList.filter((m) => !isSeparator(m))
    const posMap = new Map<string, number>()

    cleanMods.forEach((m, idx) => {
      posMap.set(bareId(m), idx)
    })

    // 1. Check Missing Dependencies & Order Inversions
    for (const rawId of cleanMods) {
      const bare = bareId(rawId)
      const mod = byModId.get(bare)
      const myPos = posMap.get(bare) ?? 0

      if (!mod) continue

      // Hard requirements from mod.info
      for (const req of mod.requires) {
        const reqBare = bareId(req)
        const reqPos = posMap.get(reqBare)

        if (reqPos === undefined) {
          list.push({
            id: `missing:${bare}:${reqBare}`,
            type: 'missing',
            severity: 'error',
            modId: rawId,
            targetModId: req,
            message: isRu
              ? `Отсутствует обязательная зависимость: "${req}"`
              : `Missing required dependency: "${req}"`,
            details: isRu
              ? `Мод "${mod.name}" не запустится в игре без "${req}".`
              : `Mod "${mod.name}" will fail to load without "${req}".`,
            canAutoFix: byModId.has(reqBare)
          })
        } else if (reqPos > myPos) {
          list.push({
            id: `order:${bare}:${reqBare}`,
            type: 'order',
            severity: 'error',
            modId: rawId,
            targetModId: req,
            message: isRu
              ? `Нарушен порядок: "${req}" должен загружаться ДО "${mod.name || rawId}"`
              : `Order inverted: "${req}" must load BEFORE "${mod.name || rawId}"`,
            details: isRu
              ? `Текущая позиция: ${myPos + 1}, а зависимость находится ниже на позиции ${reqPos + 1}.`
              : `Current position: ${myPos + 1}, required mod is lower at position ${reqPos + 1}.`,
            canAutoFix: true
          })
        }
      }

      // Incompatibilities
      if (mod.incompatible) {
        for (const inc of mod.incompatible) {
          const incBare = bareId(inc)
          if (posMap.has(incBare)) {
            list.push({
              id: `inc:${bare}:${incBare}`,
              type: 'incompatible',
              severity: 'error',
              modId: rawId,
              targetModId: inc,
              message: isRu
                ? `Несовместимый мод обнаружен в списке: "${inc}"`
                : `Incompatible mod present in loadout: "${inc}"`,
              details: isRu
                ? `Мод "${mod.name}" объявляет "${inc}" несовместимым.`
                : `Mod "${mod.name}" declares "${inc}" as incompatible.`,
              canAutoFix: false
            })
          }
        }
      }

      // Rule violations (loadAfter / loadBefore)
      const rule = rules[bare]
      if (rule) {
        for (const after of rule.loadAfter) {
          const afterBare = bareId(after)
          const afterPos = posMap.get(afterBare)
          if (afterPos !== undefined && afterPos > myPos) {
            list.push({
              id: `rule_after:${bare}:${afterBare}`,
              type: 'rule',
              severity: 'warn',
              modId: rawId,
              targetModId: after,
              message: isRu
                ? `Правило MLOS: должен загружаться ПОСЛЕ "${after}"`
                : `MLOS Rule: must load AFTER "${after}"`,
              details: isRu
                ? `По правилу сортировки этот мод должен стоять ниже "${after}".`
                : `Sorting rule states this mod must be placed below "${after}".`,
              canAutoFix: true
            })
          }
        }
        for (const before of rule.loadBefore) {
          const beforeBare = bareId(before)
          const beforePos = posMap.get(beforeBare)
          if (beforePos !== undefined && beforePos < myPos) {
            list.push({
              id: `rule_before:${bare}:${beforeBare}`,
              type: 'rule',
              severity: 'warn',
              modId: rawId,
              targetModId: before,
              message: isRu
                ? `Правило MLOS: должен загружаться ДО "${before}"`
                : `MLOS Rule: must load BEFORE "${before}"`,
              details: isRu
                ? `По правилу сортировки этот мод должен стоять выше "${before}".`
                : `Sorting rule states this mod must be placed above "${before}".`,
              canAutoFix: true
            })
          }
        }
      }
    }

    return list
  }, [activeList, byModId, rules, isRu])

  const filteredIssues = useMemo(() => {
    if (filterType === 'all') return issues
    return issues.filter((i) => i.severity === filterType)
  }, [issues, filterType])

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warnCount = issues.filter((i) => i.severity === 'warn').length

  const handleAutoFix = (): void => {
    // 1. Collect missing dependencies that can be added
    const toAdd: string[] = []
    for (const issue of issues) {
      if (issue.type === 'missing' && issue.targetModId) {
        const bare = bareId(issue.targetModId)
        const found = byModId.get(bare)
        const idToAdd = found?.modId ?? issue.targetModId
        if (!activeList.includes(idToAdd) && !toAdd.includes(idToAdd)) {
          toAdd.push(idToAdd)
        }
      }
    }

    // 2. Build list to sort (preserving separators in place)
    const baseMods = [...activeList]
    for (const add of toAdd) {
      baseMods.push(add)
    }

    // Run MLOS sort on non-separator items
    const seps: Array<{ index: number; value: string }> = []
    const modsOnly: string[] = []

    baseMods.forEach((item, idx) => {
      if (isSeparator(item)) {
        seps.push({ index: idx, value: item })
      } else {
        modsOnly.push(item)
      }
    })

    const sortedMods = sortModsMLOS(modsOnly, byModId, rules, luaDeps).sorted

    // Re-insert separators proportionally or at start
    const result: string[] = [...sortedMods]
    for (const sep of seps.sort((a, b) => a.index - b.index)) {
      const targetIdx = Math.min(sep.index, result.length)
      result.splice(targetIdx, 0, sep.value)
    }

    onApplyFixed(result)
    onClose()
  }

  return (
    <div className="lomodal-backdrop" onClick={onClose}>
      <div className="lomodal lomodal--validation" onClick={(e) => e.stopPropagation()}>
        <div className="lomodal__head">
          <div className="lomodal__titlebox">
            <Icon
              name={issues.length === 0 ? 'check' : 'alert'}
              size={16}
              color={issues.length === 0 ? 'var(--moss)' : errorCount > 0 ? 'var(--ember)' : 'var(--amber)'}
            />
            <h3 className="lomodal__title stencil">
              {isRu ? 'Аудит стабильности и порядка (Dry-Run)' : 'Integrity & Stability Audit (Dry-Run)'}
            </h3>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <div className="lomodal__body lomodal__body--validation">
          <div className="loval-summary">
            {issues.length === 0 ? (
              <div className="loval-status is-ok">
                <Icon name="check" size={20} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {isRu ? 'Порядок загрузки полностью стабилен!' : 'Load order is fully stable!'}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.8, marginTop: 2 }}>
                    {isRu
                      ? 'Все зависимости найдены, порядок и правила MLOS строго соблюдены.'
                      : 'All requirements satisfied, MLOS rules and order hierarchy verified.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="loval-status is-warn">
                <Icon name="alert" size={20} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {isRu ? `Найдено проблем: ${issues.length}` : `Issues detected: ${issues.length}`}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.85, marginTop: 2 }}>
                    {isRu
                      ? `Критических ошибок: ${errorCount}, предупреждений: ${warnCount}`
                      : `Critical errors: ${errorCount}, warnings: ${warnCount}`}
                  </div>
                </div>
              </div>
            )}

            <div className="loval-badges" style={{ marginTop: 8 }}>
              <button
                className={`btn btn-sm ${filterType === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilterType('all')}
              >
                {isRu ? `Все (${issues.length})` : `All (${issues.length})`}
              </button>
              {errorCount > 0 && (
                <button
                  className={`btn btn-sm ${filterType === 'error' ? 'is-active' : ''}`}
                  onClick={() => setFilterType('error')}
                >
                  <span className="lopill lopill--missing">{isRu ? `Ошибки (${errorCount})` : `Errors (${errorCount})`}</span>
                </button>
              )}
              {warnCount > 0 && (
                <button
                  className={`btn btn-sm ${filterType === 'warn' ? 'is-active' : ''}`}
                  onClick={() => setFilterType('warn')}
                >
                  <span className="lopill lopill--dupe">{isRu ? `Предупреждения (${warnCount})` : `Warnings (${warnCount})`}</span>
                </button>
              )}
            </div>
          </div>

          <div className="loval-issues" style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {filteredIssues.map((issue) => (
              <div
                key={issue.id}
                className={`loval-issue loval-issue--${issue.type} ${issue.severity === 'error' ? 'is-error' : ''}`}
              >
                <span className="loval-issue__icon">
                  <Icon
                    name={issue.severity === 'error' ? 'alert' : 'info'}
                    size={14}
                    color={issue.severity === 'error' ? 'var(--ember)' : 'var(--amber)'}
                  />
                </span>
                <div className="loval-issue__body">
                  <div className="loval-issue__head">
                    <span className="loval-issue__mod mono">{issue.modId}</span>
                    <span className="loval-issue__type label">
                      {issue.type === 'missing'
                        ? isRu ? 'Зависимость' : 'Requirement'
                        : issue.type === 'order'
                        ? isRu ? 'Инверсия порядка' : 'Order Inversion'
                        : issue.type === 'rule'
                        ? isRu ? 'Правило MLOS' : 'MLOS Rule'
                        : isRu ? 'Несовместимость' : 'Incompatible'}
                    </span>
                  </div>
                  <div className="loval-issue__msg" style={{ fontWeight: 600 }}>{issue.message}</div>
                  {issue.details && (
                    <div style={{ fontSize: '11px', color: 'var(--ash-faint)', marginTop: 2 }}>
                      {issue.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lomodal__foot">
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
          <div className="toolbar__spacer" />
          {issues.length > 0 && (
            <button className="btn is-primary" onClick={handleAutoFix}>
              <Icon name="refresh" size={12} />
              {isRu ? 'Авто-исправление порядка & зависимостей' : 'Auto-Fix Order & Requirements'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
