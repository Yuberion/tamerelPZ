import { useMemo, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { copyText } from '@renderer/lib/format'
import { useToast } from '@renderer/components/Toast'

export interface ParsedItem {
  id: string
  module: string
  fullId: string
  displayName: string
  type: string
  subCategory?: string
  weight?: string
  icon?: string
  tags: string[]
  props: Record<string, string>
}

export interface ParsedRecipe {
  name: string
  module: string
  kind: 'recipe' | 'craftRecipe'
  result?: string
  time?: string
  category?: string
  lines: string[]
}

export interface ParsedScriptData {
  items: ParsedItem[]
  recipes: ParsedRecipe[]
}

/** Robust parser for Project Zomboid B41/B42 script files (.txt). */
export function parsePzScript(text: string): ParsedScriptData {
  const items: ParsedItem[] = []
  const recipes: ParsedRecipe[] = []

  // Remove block comments /* */ and single-line comments //
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  let currentModule = 'Base'

  // Match module blocks or top-level tokens
  // We can scan token by token or block regex
  const blockRegex = /(?:(module)\s+([\w-]+)\s*\{|(\bitem|\brecipe|\bcraftRecipe)\s+([\w\s-]+)\s*\{)/g
  
  // Find all balanced blocks
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(clean)) !== null) {
    const isModule = Boolean(match[1])
    const kind = match[1] || match[3]
    const name = (match[2] || match[4] || '').trim()
    const startIndex = match.index + match[0].length

    // Find matching closing brace
    let depth = 1
    let endIndex = startIndex
    for (let i = startIndex; i < clean.length; i++) {
      if (clean[i] === '{') depth++
      else if (clean[i] === '}') {
        depth--
        if (depth === 0) {
          endIndex = i
          break
        }
      }
    }

    const blockBody = clean.slice(startIndex, endIndex)

    if (isModule) {
      currentModule = name || 'Base'
      // Inside module, parse inner blocks
      const innerRegex = /(\bitem|\brecipe|\bcraftRecipe)\s+([\w\s-]+)\s*\{/g
      let innerMatch: RegExpExecArray | null
      while ((innerMatch = innerRegex.exec(blockBody)) !== null) {
        const innerKind = innerMatch[1]
        const innerName = innerMatch[2].trim()
        const innerStart = innerMatch.index + innerMatch[0].length
        let innerDepth = 1
        let innerEnd = innerStart
        for (let j = innerStart; j < blockBody.length; j++) {
          if (blockBody[j] === '{') innerDepth++
          else if (blockBody[j] === '}') {
            innerDepth--
            if (innerDepth === 0) {
              innerEnd = j
              break
            }
          }
        }
        const innerContent = blockBody.slice(innerStart, innerEnd)
        parseBlock(innerKind, innerName, currentModule, innerContent, items, recipes)
      }
    } else {
      parseBlock(kind, name, currentModule, blockBody, items, recipes)
    }
  }

  return { items, recipes }
}

function parseBlock(
  kind: string,
  name: string,
  moduleName: string,
  body: string,
  items: ParsedItem[],
  recipes: ParsedRecipe[]
) {
  if (kind === 'item') {
    const props: Record<string, string> = {}
    const lines = body.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//')) continue
      const eqIdx = line.indexOf('=')
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim()
        let val = line.slice(eqIdx + 1).trim()
        if (val.endsWith(',')) val = val.slice(0, -1).trim()
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
        props[key] = val
      }
    }

    const tags = props.Tags ? props.Tags.split(';').map((t) => t.trim()).filter(Boolean) : []
    items.push({
      id: name,
      module: moduleName,
      fullId: `${moduleName}.${name}`,
      displayName: props.DisplayName ?? name,
      type: props.Type ?? 'Normal',
      subCategory: props.SubCategory,
      weight: props.Weight,
      icon: props.Icon,
      tags,
      props
    })
  } else if (kind === 'recipe' || kind === 'craftRecipe') {
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'))
    
    let result: string | undefined
    let time: string | undefined
    let category: string | undefined

    for (const l of lines) {
      if (l.startsWith('Result:')) result = l.replace('Result:', '').replace(/,$/, '').trim()
      else if (l.startsWith('Time:')) time = l.replace('Time:', '').replace(/,$/, '').trim()
      else if (l.startsWith('Category:')) category = l.replace('Category:', '').replace(/,$/, '').trim()
    }

    recipes.push({
      name,
      module: moduleName,
      kind: kind as 'recipe' | 'craftRecipe',
      result,
      time,
      category,
      lines
    })
  }
}

interface ItemInspectorProps {
  text: string
}

export function ItemInspector({ text }: ItemInspectorProps) {
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const parsed = useMemo(() => parsePzScript(text), [text])

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyId = (fullId: string) => {
    void copyText(fullId)
    notify(`ID скопирован: ${fullId}`, 'ok')
  }

  const distinctTypes = useMemo(() => {
    const set = new Set<string>()
    for (const item of parsed.items) set.add(item.type)
    return Array.from(set).sort()
  }, [parsed.items])

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim()
    return parsed.items.filter((item) => {
      if (typeFilter !== 'all' && item.type.toLowerCase() !== typeFilter.toLowerCase()) {
        return false
      }
      if (!q) return true
      return (
        item.displayName.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.fullId.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        (item.subCategory && item.subCategory.toLowerCase().includes(q))
      )
    })
  }, [parsed.items, query, typeFilter])

  const filteredRecipes = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'recipes') return []
    const q = query.toLowerCase().trim()
    if (!q) return parsed.recipes
    return parsed.recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.result && r.result.toLowerCase().includes(q)) ||
        (r.category && r.category.toLowerCase().includes(q))
    )
  }, [parsed.recipes, query, typeFilter])

  const totalCount = parsed.items.length + parsed.recipes.length

  if (totalCount === 0) {
    return (
      <div className="inspector-empty">
        <Icon name="info" size={24} />
        <span>В данном скрипте не обнаружено стандартных блоков item или recipe</span>
      </div>
    )
  }

  return (
    <div className="item-inspector">
      {/* Top Filter and Search bar */}
      <div className="item-inspector__toolbar">
        <div className="item-inspector__search">
          <Icon name="search" size={13} className="is-dim" />
          <input
            type="text"
            className="item-inspector__input mono"
            placeholder="Фильтр по названию, ID, тегам..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="btn btn-icon btn-sm"
              onClick={() => setQuery('')}
              title="Очистить"
            >
              ×
            </button>
          )}
        </div>

        {/* Type Filter Pills */}
        <div className="item-inspector__pills">
          <button
            type="button"
            className={`pill pill--btn ${typeFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            Все ({parsed.items.length})
          </button>
          {distinctTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`pill pill--btn ${typeFilter === t ? 'is-active' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
          {parsed.recipes.length > 0 && (
            <button
              type="button"
              className={`pill pill--btn ${typeFilter === 'recipes' ? 'is-active' : ''}`}
              onClick={() => setTypeFilter('recipes')}
            >
              Рецепты ({parsed.recipes.length})
            </button>
          )}
        </div>
      </div>

      {/* Cards List */}
      <div className="item-inspector__cards">
        {filteredItems.map((item) => {
          const isWeapon = item.type.toLowerCase().includes('weapon')
          const isFood = item.type.toLowerCase().includes('food')
          const isClothing = item.type.toLowerCase().includes('clothing')
          const isContainer = item.type.toLowerCase().includes('container')
          const isExpanded = expandedItems.has(item.fullId)

          return (
            <div key={item.fullId} className="item-card brackets">
              <div className="item-card__header">
                <div className="item-card__title-row">
                  <span className="item-card__name">{item.displayName}</span>
                  <span className="item-card__type-badge mono">{item.type}</span>
                  {item.subCategory && (
                    <span className="item-card__sub-badge mono is-dim">{item.subCategory}</span>
                  )}
                </div>
                <div className="item-card__actions">
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    title={`Скопировать ${item.fullId}`}
                    onClick={() => copyId(item.fullId)}
                  >
                    <Icon name="copy" size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    title={isExpanded ? 'Скрыть сырые свойства' : 'Показать все свойства'}
                    onClick={() => toggleExpand(item.fullId)}
                  >
                    <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
                  </button>
                </div>
              </div>

              <div className="item-card__id-row mono is-dim">
                <span>{item.fullId}</span>
                {item.icon && <span>· Icon: {item.icon}</span>}
              </div>

              {/* Badges row: Weight, Two-handed, Condition, Ammo */}
              <div className="item-card__badges">
                {item.weight && (
                  <span className="ibadge ibadge--weight mono">
                    Вес: {item.weight}
                  </span>
                )}
                {item.props.TwoHandWeapon === 'TRUE' && (
                  <span className="ibadge ibadge--twohand mono">2-ручное</span>
                )}
                {item.props.ConditionMax && (
                  <span className="ibadge ibadge--cond mono">
                    Прочность: {item.props.ConditionMax}
                  </span>
                )}
                {item.props.MaxAmmo && (
                  <span className="ibadge ibadge--ammo mono">
                    Магазин: {item.props.MaxAmmo} {item.props.AmmoType ? `(${item.props.AmmoType.split('.').pop()})` : ''}
                  </span>
                )}
              </div>

              {/* Weapon Stats Grid */}
              {isWeapon && (
                <div className="item-card__stats-grid">
                  {(item.props.MinDamage || item.props.MaxDamage) && (
                    <div className="istat">
                      <span className="istat__label">Урон</span>
                      <span className="istat__val istat__val--dmg mono">
                        {item.props.MinDamage ?? '0'} — {item.props.MaxDamage ?? '0'}
                      </span>
                    </div>
                  )}
                  {item.props.CriticalChance && (
                    <div className="istat">
                      <span className="istat__label">Крит. шанс</span>
                      <span className="istat__val istat__val--crit mono">
                        {item.props.CriticalChance}% (x{item.props.CritDmgMultiplier ?? '2'})
                      </span>
                    </div>
                  )}
                  {item.props.DoorDamage && (
                    <div className="istat">
                      <span className="istat__label">Урон дверям</span>
                      <span className="istat__val istat__val--amber mono">
                        {item.props.DoorDamage}
                      </span>
                    </div>
                  )}
                  {(item.props.MinRange || item.props.MaxRange) && (
                    <div className="istat">
                      <span className="istat__label">Дистанция</span>
                      <span className="istat__val mono">
                        {item.props.MinRange ?? '0'} - {item.props.MaxRange ?? '0'}
                      </span>
                    </div>
                  )}
                  {item.props.BaseSpeed && (
                    <div className="istat">
                      <span className="istat__label">Скорость</span>
                      <span className="istat__val mono">{item.props.BaseSpeed}</span>
                    </div>
                  )}
                  {item.props.SwingTime && (
                    <div className="istat">
                      <span className="istat__label">Замах</span>
                      <span className="istat__val mono">{item.props.SwingTime}s</span>
                    </div>
                  )}
                </div>
              )}

              {/* Food Stats Grid */}
              {isFood && (
                <div className="item-card__stats-grid">
                  {item.props.HungerChange && (
                    <div className="istat">
                      <span className="istat__label">Голод</span>
                      <span className="istat__val istat__val--amber mono">
                        {item.props.HungerChange}
                      </span>
                    </div>
                  )}
                  {item.props.ThirstChange && (
                    <div className="istat">
                      <span className="istat__label">Жажда</span>
                      <span className="istat__val istat__val--cyan mono">
                        {item.props.ThirstChange}
                      </span>
                    </div>
                  )}
                  {item.props.Calories && (
                    <div className="istat">
                      <span className="istat__label">Калории</span>
                      <span className="istat__val mono">{item.props.Calories}</span>
                    </div>
                  )}
                  {item.props.Carbohydrates && (
                    <div className="istat">
                      <span className="istat__label">Углеводы/Белки</span>
                      <span className="istat__val mono">
                        {item.props.Carbohydrates} / {item.props.Proteins ?? 0}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Clothing / Armor Stats */}
              {isClothing && (
                <div className="item-card__stats-grid">
                  {item.props.BiteDefense && (
                    <div className="istat">
                      <span className="istat__label">Защита от укусов</span>
                      <span className="istat__val istat__val--armor mono">
                        +{item.props.BiteDefense}%
                      </span>
                    </div>
                  )}
                  {item.props.ScratchDefense && (
                    <div className="istat">
                      <span className="istat__label">Защита от царапин</span>
                      <span className="istat__val istat__val--armor mono">
                        +{item.props.ScratchDefense}%
                      </span>
                    </div>
                  )}
                  {item.props.BulletDefense && (
                    <div className="istat">
                      <span className="istat__label">Бронезащита</span>
                      <span className="istat__val istat__val--crit mono">
                        +{item.props.BulletDefense}%
                      </span>
                    </div>
                  )}
                  {item.props.Insulation && (
                    <div className="istat">
                      <span className="istat__label">Теплоизоляция</span>
                      <span className="istat__val mono">{item.props.Insulation}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Container Stats */}
              {isContainer && (
                <div className="item-card__stats-grid">
                  {item.props.Capacity && (
                    <div className="istat">
                      <span className="istat__label">Вместимость</span>
                      <span className="istat__val istat__val--cyan mono">{item.props.Capacity}</span>
                    </div>
                  )}
                  {item.props.WeightReduction && (
                    <div className="istat">
                      <span className="istat__label">Снижение веса</span>
                      <span className="istat__val istat__val--dmg mono">
                        -{item.props.WeightReduction}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Tags */}
              {item.tags.length > 0 && (
                <div className="item-card__tags">
                  {item.tags.map((t) => (
                    <span key={t} className="tagchip mono">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {/* Expanded Raw Properties */}
              {isExpanded && (
                <div className="item-card__raw mono">
                  <table className="item-card__raw-table">
                    <tbody>
                      {Object.entries(item.props).map(([k, v]) => (
                        <tr key={k}>
                          <td className="raw-key">{k}</td>
                          <td className="raw-val">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}

        {/* Recipes */}
        {filteredRecipes.map((r, i) => (
          <div key={`${r.name}-${i}`} className="item-card item-card--recipe brackets">
            <div className="item-card__header">
              <div className="item-card__title-row">
                <span className="item-card__name">{r.name}</span>
                <span className="item-card__type-badge mono">{r.kind}</span>
                {r.category && (
                  <span className="item-card__sub-badge mono is-dim">{r.category}</span>
                )}
              </div>
            </div>

            <div className="item-card__badges">
              {r.result && (
                <span className="ibadge ibadge--ammo mono">
                  Результат: <strong>{r.result}</strong>
                </span>
              )}
              {r.time && (
                <span className="ibadge ibadge--weight mono">
                  Время: {r.time}s
                </span>
              )}
            </div>

            <div className="item-card__recipe-body mono">
              {r.lines.map((l, idx) => (
                <div key={idx} className="recipe-line">
                  • {l}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
