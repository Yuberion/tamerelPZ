import { useEffect, useState, useTransition } from 'react'
import type {
  WorkshopItemDetails,
  WorkshopItemSummary,
  WorkshopSearchQuery,
  WorkshopViewMode
} from '@shared/types'
import { Icon, type IconName } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'

interface WorkshopOverviewProps {
  onExit(): void
}

interface CategoryDef {
  tag: string
  ru: string
  en: string
  icon: IconName
  isBuild?: boolean
}

const WORKSHOP_CATEGORIES: CategoryDef[] = [
  { tag: '', ru: 'Все категории', en: 'All Categories', icon: 'grid' },
  // Builds
  { tag: 'Build 42', ru: 'Build 42', en: 'Build 42', icon: 'clock', isBuild: true },
  { tag: 'Build 41', ru: 'Build 41', en: 'Build 41', icon: 'clock', isBuild: true },
  { tag: 'Build 40', ru: 'Build 40', en: 'Build 40', icon: 'clock', isBuild: true },
  // Gameplay Content
  { tag: 'Weapons', ru: 'Оружие', en: 'Weapons', icon: 'gun' },
  { tag: 'Vehicles', ru: 'Транспорт', en: 'Vehicles', icon: 'car' },
  { tag: 'Clothing/Armor', ru: 'Одежда и Броня', en: 'Clothing & Armor', icon: 'shirt' },
  { tag: 'Items', ru: 'Предметы', en: 'Items', icon: 'package' },
  { tag: 'Map', ru: 'Карты', en: 'Maps', icon: 'map' },
  { tag: 'Building', ru: 'Строительство', en: 'Building', icon: 'hammer' },
  { tag: 'Food', ru: 'Еда', en: 'Food', icon: 'coffee' },
  { tag: 'Farming', ru: 'Фермерство', en: 'Farming', icon: 'target' },
  // Systems & Tech
  { tag: 'Framework', ru: 'Фреймворки', en: 'Frameworks', icon: 'code' },
  { tag: 'Interface', ru: 'Интерфейс', en: 'Interface', icon: 'monitor' },
  { tag: 'QOL', ru: 'Удобство (QoL)', en: 'Quality of Life', icon: 'check-circle' },
  { tag: 'Multiplayer', ru: 'Мультиплеер', en: 'Multiplayer', icon: 'user' },
  { tag: 'Military', ru: 'Военное', en: 'Military', icon: 'shield' },
  { tag: 'Models', ru: '3D-Модели', en: '3D Models', icon: 'cube' },
  { tag: 'Textures', ru: 'Текстуры', en: 'Textures', icon: 'palette' },
  { tag: 'Audio', ru: 'Звуки и Музыка', en: 'Audio & Music', icon: 'volume' },
  { tag: 'Animals', ru: 'Животные', en: 'Animals', icon: 'target' },
  // Content & Systems
  { tag: 'Language/Translation', ru: 'Переводы', en: 'Translations', icon: 'globe' },
  { tag: 'Literature', ru: 'Литература', en: 'Literature', icon: 'book' },
  { tag: 'Skills', ru: 'Навыки', en: 'Skills', icon: 'star' },
  { tag: 'Traits', ru: 'Трейты', en: 'Traits', icon: 'pulse' },
  { tag: 'Realistic', ru: 'Реализм', en: 'Realistic', icon: 'check' },
  { tag: 'Hardmode', ru: 'Хардкор', en: 'Hardmode', icon: 'alert' },
  { tag: 'Balance', ru: 'Баланс', en: 'Balance', icon: 'scales' },
  { tag: 'Pop Culture', ru: 'Поп-культура', en: 'Pop Culture', icon: 'external' },
  { tag: 'Silly/Fun', ru: 'Юмор и Фан', en: 'Silly & Fun', icon: 'star' },
  { tag: 'WIP', ru: 'В разработке', en: 'In Development', icon: 'wrench' },
  { tag: 'Misc', ru: 'Разное', en: 'Miscellaneous', icon: 'folder' }
]

export function WorkshopOverview({ onExit }: WorkshopOverviewProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()
  const [, startTransition] = useTransition()

  // Primary mode: 'workshop' (Steam Online) vs 'installed' (Local Library)
  const [mode, setMode] = useState<WorkshopViewMode>('installed')

  // Search & Filter state
  const [search, setSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [updatesOnly, setUpdatesOnly] = useState(false)
  const [page, setPage] = useState(1)

  // Sidebar / Category drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)

  // Data state
  const [loading, setLoading] = useState(false)
  const [installedCount, setInstalledCount] = useState<number>(0)
  const [items, setItems] = useState<WorkshopItemSummary[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  // Detail drawer state
  const [selectedItem, setSelectedItem] = useState<WorkshopItemDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [activeHeroImg, setActiveHeroImg] = useState<string>('')
  const [showOriginalDesc, setShowOriginalDesc] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  // Selected Category Object
  const currentCategory = WORKSHOP_CATEGORIES.find(
    (c) => c.tag.toLowerCase() === selectedTag.toLowerCase()
  )

  // Query executor
  const runQuery = async (targetPage = page): Promise<void> => {
    setLoading(true)
    try {
      const q: WorkshopSearchQuery = {
        mode,
        search: search.trim() || undefined,
        page: targetPage,
        numPerPage: 32,
        tags: selectedTag ? [selectedTag] : undefined,
        updatesOnly
      }

      const res = await window.pz.workshop.query(q)
      startTransition(() => {
        setItems(res.items)
        setTotalCount(res.total)
        setHasMore(res.hasMore)
        setPage(targetPage)
      })
    } catch (err) {
      notify(
        isRu ? `Ошибка загрузки Workshop: ${String(err)}` : `Failed to load Workshop: ${String(err)}`,
        'warn'
      )
    } finally {
      setLoading(false)
    }
  }

  // 100% Autonomous Synchronization:
  // - Sync on mount
  // - Sync on window focus
  // - Listen to fs.watch on appworkshop_108600.acf
  useEffect(() => {
    // Initial silent autonomous scan & count
    void window.pz.workshop.syncSteam().then((res) => {
      setInstalledCount(res.installedCount)
    })

    // Listen to background file watcher
    const unsub = window.pz.workshop.onSyncChanged((syncRes) => {
      setInstalledCount(syncRes.installedCount)
      // When Steam downloads/updates in background, refresh list silently
      void runQuery()
    })

    // Sync silently on window focus (e.g. user just subscribed in Steam browser and returned to app)
    const onFocus = (): void => {
      void window.pz.workshop.syncSteam().then((res) => {
        setInstalledCount(res.installedCount)
        void runQuery()
      })
    }
    window.addEventListener('focus', onFocus)

    return () => {
      unsub()
      window.removeEventListener('focus', onFocus)
    }
  }, [mode, selectedTag, updatesOnly, search])

  // Trigger query on mode, tag, filter changes
  useEffect(() => {
    void runQuery(1)
  }, [mode, selectedTag, updatesOnly])

  // Open item details
  const handleOpenDetails = async (item: WorkshopItemSummary): Promise<void> => {
    setLoadingDetails(true)
    setActiveHeroImg(item.previewUrl)
    setShowOriginalDesc(false)
    try {
      const details = await window.pz.workshop.details(item.id)
      setSelectedItem(details)
      if (details.screenshots.length > 0) {
        setActiveHeroImg(details.screenshots[0])
      }
    } catch {
      // Fallback to summary
      setSelectedItem({
        ...item,
        description: isRu ? 'Не удалось загрузить полное описание.' : 'Failed to load description.',
        screenshots: item.previewUrl ? [item.previewUrl] : [],
        childrenIds: []
      })
    } finally {
      setLoadingDetails(false)
    }
  }

  // Force translation refresh
  const handleForceTranslate = async (): Promise<void> => {
    if (!selectedItem) return
    setTranslating(true)
    try {
      const details = await window.pz.workshop.details(selectedItem.id, true)
      setSelectedItem(details)
      setShowOriginalDesc(false)
      if (details.descriptionRu && details.descriptionRu !== details.description) {
        notify(isRu ? 'Описание успешно переведено на русский' : 'Description translated to Russian', 'ok')
      } else {
        notify(
          isRu ? 'Перевод недоступен или текст уже на русском' : 'Translation unavailable or already in Russian',
          'warn'
        )
      }
    } catch {
      notify(isRu ? 'Ошибка при переводе описания' : 'Failed to translate description', 'warn')
    } finally {
      setTranslating(false)
    }
  }

  // Action: Background Subscribe via Steamworks
  const handleSubscribe = async (id: string): Promise<void> => {
    setSubscribing(true)
    try {
      const res = await window.pz.workshop.subscribe(id)
      if (res.success) {
        notify(
          isRu
            ? 'Подписка оформлена! Steam скачивает мод в фоне'
            : 'Subscribed! Steam is downloading mod in background',
          'ok'
        )
        setSelectedItem((prev) => (prev ? { ...prev, isInstalled: true, isSubscribed: true } : null))
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, isInstalled: true, isSubscribed: true } : it))
        )
      } else {
        notify(
          res.error || (isRu ? 'Не удалось оформить подписку' : 'Failed to subscribe'),
          'warn'
        )
      }
    } catch {
      notify(isRu ? 'Ошибка при связи со Steam' : 'Steam connection error', 'warn')
    } finally {
      setSubscribing(false)
    }
  }

  // Action: Background Unsubscribe via Steamworks
  const handleUnsubscribe = async (id: string): Promise<void> => {
    setSubscribing(true)
    try {
      const res = await window.pz.workshop.unsubscribe(id)
      if (res.success) {
        notify(isRu ? 'Вы отписались от мода в Steam' : 'Unsubscribed from mod in Steam', 'ok')
        setSelectedItem((prev) => (prev ? { ...prev, isInstalled: false, isSubscribed: false } : null))
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, isInstalled: false, isSubscribed: false } : it))
        )
        if (mode === 'installed') {
          setInstalledCount((c) => Math.max(0, c - 1))
        }
      } else {
        notify(
          res.error || (isRu ? 'Не удалось отписаться от мода' : 'Failed to unsubscribe'),
          'warn'
        )
      }
    } catch {
      notify(isRu ? 'Ошибка при связи со Steam' : 'Steam connection error', 'warn')
    } finally {
      setSubscribing(false)
    }
  }

  // Action: Open in Steam
  const handleOpenSteam = async (id: string): Promise<void> => {
    await window.pz.workshop.openSteam(id)
    notify(isRu ? 'Страница мода открыта в Steam' : 'Opened mod in Steam', 'ok')
  }

  // Action: Open local folder
  const handleOpenFolder = async (id: string): Promise<void> => {
    const ok = await window.pz.workshop.openFolder(id)
    if (ok) {
      notify(isRu ? 'Папка мода открыта в Проводнике' : 'Opened mod folder in Explorer', 'ok')
    } else {
      notify(isRu ? 'Папка мода не найдена на диске' : 'Folder not found on disk', 'warn')
    }
  }

  // Copy ID to clipboard
  const handleCopyId = (id: string): void => {
    navigator.clipboard.writeText(id)
    notify(isRu ? `ID ${id} скопирован в буфер` : `Copied ID ${id}`, 'ok')
  }

  // Format helpers
  const formatNum = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`
    return num.toLocaleString()
  }

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '—'
    const mb = bytes / (1024 * 1024)
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`
    return `${mb.toFixed(1)} MB`
  }

  const formatDate = (sec: number): string => {
    if (!sec) return '—'
    return new Date(sec * 1000).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <div className="ws-container">
      {/* Top Toolbar */}
      <header className="ws-toolbar">
        <div className="ws-toolbar__row">
          <button className="btn btn--subtle" onClick={onExit} title={isRu ? 'Назад (Esc)' : 'Back (Esc)'}>
            <Icon name="arrow-left" size={14} />
          </button>

          <div className="ws-toolbar__title">
            <Icon name="download" size={18} color="var(--amber)" />
            <span>WORKSHOP OVERVIEW</span>
          </div>

          {/* View Mode Switcher (Workshop vs Installed) */}
          <div className="ws-mode-switcher">
            <button
              className={`ws-mode-btn ${mode === 'workshop' ? 'is-active' : ''}`}
              onClick={() => {
                if (mode !== 'workshop') {
                  setMode('workshop')
                  setUpdatesOnly(false)
                }
              }}
              title={isRu ? 'Каталог Мастерской Steam онлайн' : 'Steam Workshop Online Catalogue'}
            >
              <Icon name="globe" size={13} />
              <span>Workshop</span>
            </button>

            <button
              className={`ws-mode-btn ${mode === 'installed' ? 'is-active' : ''}`}
              onClick={() => {
                if (mode !== 'installed') {
                  setMode('installed')
                }
              }}
              title={isRu ? 'Все установленные моды на диске' : 'All locally installed mods on disk'}
            >
              <Icon name="folder" size={13} />
              <span>{isRu ? 'Установленные' : 'Installed'}</span>
              {installedCount > 0 && <span className="ws-mode-btn__badge">{installedCount}</span>}
            </button>
          </div>

          {/* Slide-out Category Menu Toggle Button */}
          <button
            className={`ws-btn-category-toggle ${sidebarOpen ? 'is-active' : ''} ${selectedTag ? 'is-filtered' : ''}`}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={isRu ? 'Выбрать категорию модов' : 'Choose mod category'}
          >
            <Icon name={currentCategory ? currentCategory.icon : 'grid'} size={13} color="var(--amber)" />
            <span className="ws-btn-category-label">
              {currentCategory ? (isRu ? currentCategory.ru : currentCategory.en) : isRu ? 'Категории' : 'Categories'}
            </span>
            <Icon name={sidebarOpen ? 'chevron-down' : 'chevron-right'} size={11} />
          </button>

          {/* Search box */}
          <form
            className="ws-search"
            onSubmit={(e) => {
              e.preventDefault()
              void runQuery(1)
            }}
          >
            <Icon name="search" size={13} color="var(--text-muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                mode === 'installed'
                  ? isRu
                    ? 'Поиск среди установленных модов…'
                    : 'Search installed mods…'
                  : isRu
                    ? 'Поиск в Мастерской Steam…'
                    : 'Search Steam Workshop…'
              }
              spellCheck={false}
            />
            {search && (
              <button
                type="button"
                className="ws-search__clear"
                onClick={() => {
                  setSearch('')
                  void runQuery(1)
                }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </form>

          {/* Updates Filter Toggle */}
          <button
            className={`btn btn--tiny ${updatesOnly ? 'btn--active' : 'btn--subtle'}`}
            onClick={() => setUpdatesOnly(!updatesOnly)}
            title={isRu ? 'Моды с доступными обновлениями в Steam' : 'Mods with pending updates in Steam'}
          >
            <Icon name="rotate" size={11} color={updatesOnly ? '#f59e0b' : undefined} />
            <span>{isRu ? 'Обновления' : 'Updates'}</span>
          </button>
        </div>
      </header>

      {/* Main Body with Slide-Out Left Sidebar */}
      <div className="ws-content">
        {/* Pull-out Edge Handle (when sidebar is closed) */}
        {!sidebarOpen && !sidebarPinned && (
          <button
            className="ws-sidebar-pull-tab"
            onClick={() => setSidebarOpen(true)}
            title={isRu ? 'Вытянуть меню категорий' : 'Pull out categories menu'}
          >
            <Icon name="chevron-right" size={12} />
            <span>{isRu ? 'Категории' : 'Categories'}</span>
          </button>
        )}

        {/* Collapsible Left Category Drawer / Sidebar */}
        <aside
          className={`ws-sidebar ${sidebarOpen || sidebarPinned ? 'is-open' : ''} ${sidebarPinned ? 'is-pinned' : ''}`}
        >
          <div className="ws-sidebar__header">
            <div className="ws-sidebar__title">
              <Icon name="layers" size={14} color="var(--amber)" />
              <span>{isRu ? 'КАТЕГОРИИ МОДОВ' : 'MOD CATEGORIES'}</span>
            </div>

            <div className="ws-sidebar__actions">
              <button
                className={`btn btn--subtle btn--tiny ${sidebarPinned ? 'btn--active' : ''}`}
                onClick={() => setSidebarPinned(!sidebarPinned)}
                title={sidebarPinned ? (isRu ? 'Открепить панель' : 'Unpin panel') : (isRu ? 'Закрепить панель' : 'Pin panel')}
              >
                <Icon name="lock" size={11} color={sidebarPinned ? 'var(--amber)' : undefined} />
              </button>

              <button
                className="btn btn--subtle btn--tiny"
                onClick={() => {
                  setSidebarOpen(false)
                  setSidebarPinned(false)
                }}
                title={isRu ? 'Скрыть панель' : 'Collapse panel'}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>

          {/* Categories List */}
          <div className="ws-sidebar__list">
            {WORKSHOP_CATEGORIES.map((cat) => {
              const isActive = selectedTag.toLowerCase() === cat.tag.toLowerCase()
              const label = isRu ? cat.ru : cat.en

              return (
                <button
                  key={cat.tag || 'all'}
                  className={`ws-sidebar-item ${isActive ? 'is-active' : ''} ${cat.isBuild ? 'is-build' : ''}`}
                  onClick={() => {
                    setSelectedTag(isActive ? '' : cat.tag)
                    if (!sidebarPinned) {
                      setSidebarOpen(false)
                    }
                  }}
                  title={label}
                >
                  <Icon name={cat.icon} size={14} />
                  <span className="ws-sidebar-item__label">{label}</span>
                  {isActive && <div className="ws-sidebar-item__dot" />}
                </button>
              )
            })}
          </div>

          {/* Sidebar Footer */}
          {selectedTag && (
            <div className="ws-sidebar__footer">
              <button
                className="btn btn--subtle btn--tiny"
                style={{ width: '100%' }}
                onClick={() => {
                  setSelectedTag('')
                  if (!sidebarPinned) setSidebarOpen(false)
                }}
              >
                <Icon name="rotate" size={11} />
                <span>{isRu ? 'Сбросить фильтр' : 'Reset filter'}</span>
              </button>
            </div>
          )}
        </aside>

        {/* Backdrop for floating drawer (when not pinned) */}
        {sidebarOpen && !sidebarPinned && (
          <div className="ws-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main Grid View */}
        <main className="ws-main">
          {loading && items.length === 0 ? (
            <div className="pane__empty" style={{ padding: '60px 0' }}>
              <Icon name="refresh" size={32} className="spin" color="var(--amber)" />
              <span className="label bold">
                {mode === 'installed'
                  ? isRu
                    ? 'Загрузка установленных модов…'
                    : 'Loading installed mods library…'
                  : isRu
                    ? 'Связь с Мастерской Steam…'
                    : 'Connecting to Steam Workshop…'}
              </span>
            </div>
          ) : items.length === 0 ? (
            <div className="pane__empty" style={{ padding: '60px 0' }}>
              <Icon name="download" size={36} color="var(--text-muted)" />
              <span className="label bold">{isRu ? 'Моды не найдены' : 'No mods found'}</span>
              <span className="label wbmuted">
                {mode === 'installed'
                  ? isRu
                    ? 'В вашей библиотеке не найдено модов по выбранному фильтру или категории.'
                    : 'No installed mods found matching the selected filter or category.'
                  : isRu
                    ? 'Попробуйте изменить поисковый запрос или категорию.'
                    : 'Try adjusting your search query or category.'}
              </span>
            </div>
          ) : (
            <>
              {/* Active Filter Bar Info */}
              <div className="ws-results-header">
                <span className="ws-results-count">
                  {mode === 'installed'
                    ? isRu
                      ? `Установлено модов: ${totalCount.toLocaleString()}`
                      : `Installed mods: ${totalCount.toLocaleString()}`
                    : isRu
                      ? `Найдено в Мастерской: ${totalCount.toLocaleString()}`
                      : `Found in Workshop: ${totalCount.toLocaleString()}`}
                  {currentCategory && ` • ${isRu ? currentCategory.ru : currentCategory.en}`}
                  {updatesOnly && (isRu ? ' • Только с обновлениями' : ' • Updates only')}
                </span>
              </div>

              {/* Mod Cards Grid */}
              <div className="ws-grid">
                {items.map((item) => {
                  const isSelected = selectedItem?.id === item.id
                  const isB42 = item.tags.some((t) => t.toLowerCase().includes('42'))

                  return (
                    <article
                      key={item.id}
                      className={`ws-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => void handleOpenDetails(item)}
                    >
                      {/* Uncropped, Unstretched Mod Preview Image Container */}
                      <div className="ws-card__preview">
                        {item.previewUrl ? (
                          <img src={item.previewUrl} alt={item.title} loading="lazy" />
                        ) : (
                          <Icon name="image" size={36} color="var(--text-muted)" />
                        )}

                        {/* Status badges */}
                        {item.needsUpdate ? (
                          <div className="ws-card__badge ws-card__badge--update">
                            <Icon name="rotate" size={10} />
                            <span>{isRu ? 'Апдейт' : 'Update'}</span>
                          </div>
                        ) : item.isInstalled ? (
                          <div className="ws-card__badge ws-card__badge--installed">
                            <Icon name="check" size={10} />
                            <span>{isRu ? 'Установлен' : 'Installed'}</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Card Content */}
                      <div className="ws-card__body">
                        <div className="ws-card__title" title={item.title}>
                          {item.title}
                        </div>

                        {/* Tags */}
                        <div className="ws-card__tags">
                          {isB42 && <span className="ws-card__tag ws-card__tag--b42">Build 42</span>}
                          {item.tags
                            .filter((t) => !t.toLowerCase().includes('build'))
                            .slice(0, 3)
                            .map((t) => (
                              <span key={t} className="ws-card__tag">
                                {t}
                              </span>
                            ))}
                        </div>

                        {/* Card Meta & Stats */}
                        <div className="ws-card__meta">
                          <span title={isRu ? `Автор: ${item.author}` : `Author: ${item.author}`}>
                            {item.author
                              ? item.author.length > 20
                                ? `${item.author.slice(0, 18)}…`
                                : item.author
                              : 'Steam Author'}
                          </span>

                          <div className="ws-card__stats">
                            {item.subscriptions > 0 && (
                              <div
                                className="ws-card__stat-item"
                                title={
                                  isRu
                                    ? `${item.subscriptions.toLocaleString()} подписчиков`
                                    : `${item.subscriptions.toLocaleString()} subscribers`
                                }
                              >
                                <Icon name="user" size={11} color="var(--sky)" />
                                <span>{formatNum(item.subscriptions)}</span>
                              </div>
                            )}
                            {item.favorited > 0 && (
                              <div
                                className="ws-card__stat-item"
                                title={
                                  isRu
                                    ? `${item.favorited.toLocaleString()} в избранном`
                                    : `${item.favorited.toLocaleString()} favorites`
                                }
                              >
                                <Icon name="star" size={11} color="var(--amber)" />
                                <span>{formatNum(item.favorited)}</span>
                              </div>
                            )}
                            {item.fileSize > 0 && mode === 'installed' && (
                              <span className="ws-card__size">{formatBytes(item.fileSize)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>

              {/* Pagination Controls */}
              <div className="ws-pagination">
                <button
                  className="btn btn--subtle"
                  disabled={page <= 1 || loading}
                  onClick={() => void runQuery(page - 1)}
                >
                  <Icon name="arrow-left" size={12} />
                  <span>{isRu ? 'Предыдущая' : 'Previous'}</span>
                </button>

                <span className="ws-page-indicator">
                  {isRu ? `Страница ${page}` : `Page ${page}`}
                  {totalCount > 0 && ` (${totalCount.toLocaleString()} ${isRu ? 'модов' : 'mods'})`}
                </span>

                <button
                  className="btn btn--subtle"
                  disabled={!hasMore || loading}
                  onClick={() => void runQuery(page + 1)}
                >
                  <span>{isRu ? 'Следующая' : 'Next'}</span>
                  <Icon name="arrow-right" size={12} />
                </button>
              </div>
            </>
          )}
        </main>

        {/* Side-Drawer: Detailed Mod View */}
        {selectedItem && (
          <aside className="ws-drawer">
            <header className="ws-drawer__header">
              <div className="ws-drawer__title-block">
                <div className="ws-drawer__title">{selectedItem.title}</div>
                <div className="ws-drawer__author">
                  {isRu ? 'Автор: ' : 'Author: '}
                  <span className="bold" style={{ color: 'var(--amber)' }}>
                    {selectedItem.author || 'Steam User'}
                  </span>
                </div>
              </div>
              <button
                className="btn btn--subtle btn--tiny"
                onClick={() => setSelectedItem(null)}
                title={isRu ? 'Закрыть' : 'Close'}
              >
                <Icon name="close" size={13} />
              </button>
            </header>

            <div className="ws-drawer__body">
              {/* Media Gallery / Screenshots */}
              <div className="ws-gallery">
                <div className="ws-gallery__hero">
                  {activeHeroImg ? (
                    <img src={activeHeroImg} alt="Screenshot" />
                  ) : (
                    <Icon name="image" size={48} color="var(--text-muted)" />
                  )}
                </div>

                {selectedItem.screenshots.length > 1 && (
                  <div className="ws-gallery__thumbs">
                    {selectedItem.screenshots.map((s, idx) => (
                      <div
                        key={idx}
                        className={`ws-gallery__thumb ${activeHeroImg === s ? 'is-active' : ''}`}
                        onClick={() => setActiveHeroImg(s)}
                      >
                        <img src={s} alt={`thumb ${idx}`} loading="lazy" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Actions Bar */}
              <div className="ws-drawer__actions">
                {selectedItem.isInstalled || selectedItem.isSubscribed ? (
                  <div className="ws-drawer__installed-status">
                    <div className="ws-badge-installed-pill">
                      <Icon name="check-circle" size={13} color="#22c55e" />
                      <span>
                        {selectedItem.isSubscribed
                          ? isRu
                            ? 'Подписан в Steam'
                            : 'Subscribed in Steam'
                          : isRu
                            ? 'Установлен на диске'
                            : 'Installed locally'}
                      </span>
                      {selectedItem.needsUpdate && (
                        <span className="ws-badge-update-alert">
                          {isRu ? 'Доступно обновление' : 'Update available'}
                        </span>
                      )}
                    </div>

                    <button
                      className="ws-btn-unsubscribe"
                      onClick={() => void handleUnsubscribe(selectedItem.id)}
                      disabled={subscribing}
                      title={
                        isRu
                          ? 'Отписаться от мода в Steam в 1 клик'
                          : 'Unsubscribe from mod in Steam in 1 click'
                      }
                    >
                      <Icon
                        name={subscribing ? 'refresh' : 'close'}
                        size={12}
                        className={subscribing ? 'spin' : ''}
                        color="#f87171"
                      />
                      <span>
                        {subscribing
                          ? isRu
                            ? 'Отписка…'
                            : 'Unsubscribing…'
                          : isRu
                            ? 'Отписаться в Steam'
                            : 'Unsubscribe in Steam'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <button
                    className="ws-btn-steam"
                    onClick={() => void handleSubscribe(selectedItem.id)}
                    disabled={subscribing}
                    title={
                      isRu
                        ? 'Подписаться и загрузить мод через Steam в фоне без переключения'
                        : 'Subscribe and download mod via Steam in background'
                    }
                  >
                    <Icon
                      name={subscribing ? 'refresh' : 'download'}
                      size={14}
                      className={subscribing ? 'spin' : ''}
                      color="#66c0f4"
                    />
                    <span>
                      {subscribing
                        ? isRu
                          ? 'Оформление подписки…'
                          : 'Subscribing in Steam…'
                        : isRu
                          ? 'Подписаться / Скачать в Steam'
                          : 'Subscribe / Download in Steam'}
                    </span>
                  </button>
                )}

                <div className="ws-drawer__actions-row">
                  {selectedItem.isInstalled && (
                    <button
                      className="btn btn--subtle btn--tiny"
                      style={{ flex: 1 }}
                      onClick={() => void handleOpenFolder(selectedItem.id)}
                      title={isRu ? 'Открыть папку мода на диске' : 'Open mod folder on disk'}
                    >
                      <Icon name="folder-open" size={12} color="var(--pine)" />
                      <span>{isRu ? 'Папка' : 'Folder'}</span>
                    </button>
                  )}

                  <button
                    className="btn btn--subtle btn--tiny"
                    style={{ flex: 1 }}
                    onClick={() => handleCopyId(selectedItem.id)}
                    title={isRu ? 'Скопировать Workshop ID' : 'Copy Workshop ID'}
                  >
                    <Icon name="copy" size={12} />
                    <span>ID: {selectedItem.id}</span>
                  </button>

                  <button
                    className="btn btn--subtle btn--tiny"
                    onClick={() => void handleOpenSteam(selectedItem.id)}
                    title={isRu ? 'Открыть страницу в клиенте Steam' : 'Open page in Steam client'}
                  >
                    <Icon name="download" size={12} color="#66c0f4" />
                    <span>Steam</span>
                  </button>

                  <button
                    className="btn btn--subtle btn--tiny"
                    onClick={() =>
                      window.pz.shell.external(
                        `https://steamcommunity.com/sharedfiles/filedetails/?id=${selectedItem.id}`
                      )
                    }
                    title={isRu ? 'Открыть в веб-браузере' : 'Open in browser'}
                  >
                    <Icon name="globe" size={12} />
                  </button>
                </div>
              </div>

              {/* Technical Specifications */}
              <div className="ws-meta-grid">
                <div className="ws-meta-item">
                  <span className="ws-meta-item__label">{isRu ? 'Размер мода' : 'File Size'}</span>
                  <span className="ws-meta-item__value mono">{formatBytes(selectedItem.fileSize)}</span>
                </div>
                <div className="ws-meta-item">
                  <span className="ws-meta-item__label">{isRu ? 'Подписчиков' : 'Subscribers'}</span>
                  <span className="ws-meta-item__value mono">{selectedItem.subscriptions.toLocaleString()}</span>
                </div>
                <div className="ws-meta-item">
                  <span className="ws-meta-item__label">{isRu ? 'Создан' : 'Created'}</span>
                  <span className="ws-meta-item__value">{formatDate(selectedItem.timeCreated)}</span>
                </div>
                <div className="ws-meta-item">
                  <span className="ws-meta-item__label">{isRu ? 'Обновлен' : 'Updated'}</span>
                  <span className="ws-meta-item__value">{formatDate(selectedItem.timeUpdated)}</span>
                </div>
              </div>

              {/* Localized / Translated Description Section */}
              <div className="ws-drawer__desc">
                <div className="ws-drawer__desc-header">
                  <h4 style={{ margin: 0, fontSize: '0.88rem', color: 'var(--amber)' }}>
                    {isRu ? 'Описание мода' : 'Mod Description'}
                  </h4>

                  {/* Segmented language switcher when translation is available */}
                  {isRu && selectedItem.descriptionRu && selectedItem.descriptionRu !== selectedItem.description ? (
                    <div className="ws-desc-lang-switch">
                      <button
                        type="button"
                        className={`ws-desc-lang-btn ${!showOriginalDesc ? 'is-active' : ''}`}
                        onClick={() => setShowOriginalDesc(false)}
                        title={isRu ? 'Показать описание на русском языке' : 'Show Russian translation'}
                      >
                        <Icon name="globe" size={11} />
                        <span>Русский</span>
                      </button>
                      <button
                        type="button"
                        className={`ws-desc-lang-btn ${showOriginalDesc ? 'is-active' : ''}`}
                        onClick={() => setShowOriginalDesc(true)}
                        title={isRu ? 'Показать оригинальное описание на английском' : 'Show English original'}
                      >
                        <span>Оригинал (EN)</span>
                      </button>
                    </div>
                  ) : isRu && !loadingDetails && selectedItem.description ? (
                    <button
                      type="button"
                      className="ws-btn-trans-retry"
                      onClick={() => void handleForceTranslate()}
                      disabled={translating}
                      title={isRu ? 'Перевести описание на русский язык' : 'Translate description to Russian'}
                    >
                      <Icon name="rotate" size={11} className={translating ? 'spin' : ''} />
                      <span>{translating ? (isRu ? 'Переводим…' : 'Translating…') : isRu ? 'Перевести (RU)' : 'Translate (RU)'}</span>
                    </button>
                  ) : null}
                </div>

                {loadingDetails ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                    <Icon name="refresh" size={12} className="spin" />
                    <span>{isRu ? 'Загрузка и перевод описания…' : 'Loading description…'}</span>
                  </div>
                ) : (
                  <div
                    className="ws-desc-container"
                    dangerouslySetInnerHTML={{
                      __html:
                        isRu && selectedItem.descriptionRu && !showOriginalDesc
                          ? selectedItem.descriptionRu
                          : selectedItem.description
                    }}
                  />
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
