import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
  { tag: 'Local', ru: 'Локальные моды', en: 'Local Mods', icon: 'folder' },
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
  { tag: 'QoL', ru: 'Удобство (QoL)', en: 'Quality of Life', icon: 'check-circle' },
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

// Helper to generate numbered page buttons with smart ellipses
function getPaginationItems(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total]
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total]
  }
  return [1, '...', current - 1, current, current + 1, '...', total]
}

export function WorkshopOverview({ onExit }: WorkshopOverviewProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()
  const [, startTransition] = useTransition()

  // Primary mode: 'workshop' (Steam Online) vs 'installed' (Local Library)
  const [mode, setMode] = useState<WorkshopViewMode>('installed')

  // Search & Filter state
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Sidebar / Category drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)

  // Data state
  const [loading, setLoading] = useState(false)
  const [installedCount, setInstalledCount] = useState<number>(0)
  const [items, setItems] = useState<WorkshopItemSummary[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const mainRef = useRef<HTMLDivElement>(null)

  // Multi-Page Pagination state (Strict Discrete Pages, Zero DOM Bloat)
  const [page, setPage] = useState(1)
  const [jumpPageInput, setJumpPageInput] = useState('1')
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  // Detail drawer state
  const [selectedItem, setSelectedItem] = useState<WorkshopItemDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [activeHeroImg, setActiveHeroImg] = useState<string>('')
  const [showOriginalDesc, setShowOriginalDesc] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  // Selected Category Objects
  const selectedCategories = useMemo(
    () => WORKSHOP_CATEGORIES.filter((c) => c.tag && selectedTags.includes(c.tag)),
    [selectedTags]
  )

  // Active state ref to eliminate stale closures and race conditions
  const queryStateRef = useRef({ mode, search, selectedTags, page })
  useEffect(() => {
    queryStateRef.current = { mode, search, selectedTags, page }
  }, [mode, search, selectedTags, page])

  // Query executor: loads a specific page (defaulting to 1) with explicit or state params
  const runQuery = async (
    targetPage = 1,
    forceRefresh = false,
    overrideTags?: string[],
    overrideMode?: WorkshopViewMode,
    overrideSearch?: string
  ): Promise<void> => {
    const activeMode = overrideMode ?? queryStateRef.current.mode
    const activeTags = overrideTags ?? queryStateRef.current.selectedTags
    const activeSearch = overrideSearch ?? queryStateRef.current.search

    setLoading(true)
    try {
      const q: WorkshopSearchQuery = {
        mode: activeMode,
        search: activeSearch.trim() || undefined,
        page: targetPage,
        numPerPage: 30,
        tags: activeTags.length > 0 ? activeTags : undefined,
        forceRefresh
      }

      const res = await window.pz.workshop.query(q)
      startTransition(() => {
        setItems(res.items)
        setTotalCount(res.total)
        setPage(targetPage)
        setJumpPageInput(String(targetPage))
      })
      mainRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) {
      notify(
        isRu ? `Ошибка загрузки Workshop: ${String(err)}` : `Failed to load Workshop: ${String(err)}`,
        'warn'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleGoToPage = (target: number): void => {
    const clamped = Math.max(1, Math.min(target, totalPages))
    if (clamped === page && items.length > 0) return
    void runQuery(clamped)
  }

  const handleJumpSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const parsed = parseInt(jumpPageInput.trim(), 10)
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      handleGoToPage(parsed)
    } else {
      setJumpPageInput(String(page))
    }
  }

  // Category toggle handler with immediate deterministic query trigger
  const handleToggleCategory = (catTag: string): void => {
    let nextTags: string[] = []
    if (catTag === '') {
      nextTags = []
    } else {
      nextTags = selectedTags.includes(catTag)
        ? selectedTags.filter((t) => t !== catTag)
        : [...selectedTags, catTag]
    }
    setSelectedTags(nextTags)
    void runQuery(1, false, nextTags)
  }

  // Mode switch handler with immediate deterministic query trigger
  const handleSwitchMode = (nextMode: WorkshopViewMode): void => {
    if (mode === nextMode) return
    setMode(nextMode)
    void runQuery(1, false, selectedTags, nextMode)
  }

  // Category clear handler
  const handleResetCategories = (): void => {
    setSelectedTags([])
    void runQuery(1, false, [])
  }

  // Autonomous Steam Sync on Mount & Background File Watcher
  useEffect(() => {
    // Initial silent autonomous scan & count
    void window.pz.workshop.syncSteam().then((res) => {
      setInstalledCount(res.installedCount)
    })

    // Listen to background file watcher (Steam downloads in background)
    const unsub = window.pz.workshop.onSyncChanged((syncRes) => {
      setInstalledCount(syncRes.installedCount)
      const { page: currPage } = queryStateRef.current
      void runQuery(currPage)
    })

    // When returning to window after subscribing in Steam external browser
    const onFocus = (): void => {
      void window.pz.workshop.syncSteam().then((res) => {
        setInstalledCount(res.installedCount)
      })
    }
    window.addEventListener('focus', onFocus)

    // Initial load on mount
    void runQuery(1)

    return () => {
      unsub()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

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
        if (mode === 'installed') {
          // Immediately remove the unsubscribed mod from the installed grid
          setItems((prev) => prev.filter((it) => it.id !== id))
          setTotalCount((c) => Math.max(0, c - 1))
          setInstalledCount((c) => Math.max(0, c - 1))
          // Close detail modal/drawer if this was the open mod
          setSelectedItem((prev) => (prev?.id === id ? null : prev))
        } else {
          setSelectedItem((prev) => (prev ? { ...prev, isInstalled: false, isSubscribed: false } : null))
          setItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, isInstalled: false, isSubscribed: false } : it))
          )
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

  // Action: Manual Force Rescan / Refresh
  const handleForceRescan = async (): Promise<void> => {
    setLoading(true)
    try {
      const syncRes = await window.pz.workshop.syncSteam()
      setInstalledCount(syncRes.installedCount)
      await runQuery(page, true)
      notify(
        isRu
          ? `Список обновлен (установлено модов: ${syncRes.installedCount})`
          : `List refreshed (${syncRes.installedCount} mods installed)`,
        'ok'
      )
    } catch (err) {
      notify(
        isRu ? `Ошибка при обновлении списка: ${String(err)}` : `Refresh failed: ${String(err)}`,
        'warn'
      )
    } finally {
      setLoading(false)
    }
  }

  // Action: Open in Steam
  const handleOpenSteam = async (id: string): Promise<void> => {
    await window.pz.workshop.openSteam(id)
    notify(isRu ? 'Страница мода открыта в Steam' : 'Opened mod in Steam', 'ok')
  }

  // Action: Open in Browser
  const handleOpenBrowser = async (id: string): Promise<void> => {
    try {
      await window.pz.shell.external(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`)
      notify(isRu ? 'Страница открыта в браузере' : 'Opened page in browser', 'ok')
    } catch {
      notify(isRu ? 'Ошибка при открытии ссылки' : 'Failed to open URL', 'warn')
    }
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
              onClick={() => handleSwitchMode('workshop')}
              title={isRu ? 'Каталог Мастерской Steam онлайн' : 'Steam Workshop Online Catalogue'}
            >
              <Icon name="globe" size={13} />
              <span>Workshop</span>
            </button>

            <button
              className={`ws-mode-btn ${mode === 'installed' ? 'is-active' : ''}`}
              onClick={() => handleSwitchMode('installed')}
              title={isRu ? 'Все установленные моды на диске' : 'All locally installed mods on disk'}
            >
              <Icon name="folder" size={13} />
              <span>{isRu ? 'Установленные' : 'Installed'}</span>
              {installedCount > 0 && <span className="ws-mode-btn__badge">{installedCount}</span>}
            </button>
          </div>

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
                  void runQuery(1, false, selectedTags, mode, '')
                }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </form>

          {/* Refresh / Force Rescan Button */}
          <button
            className="btn btn--subtle btn--tiny"
            onClick={() => void handleForceRescan()}
            disabled={loading}
            title={
              mode === 'installed'
                ? isRu
                  ? 'Пересканировать установленные моды на диске'
                  : 'Rescan installed mods on disk'
                : isRu
                  ? 'Обновить результаты поиска'
                  : 'Refresh search results'
            }
          >
            <Icon name="refresh" size={11} className={loading ? 'spin' : ''} />
            <span>{isRu ? 'Обновить' : 'Refresh'}</span>
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
            <Icon name="layers" size={12} />
            <span>{isRu ? 'Категории' : 'Categories'}</span>
            {selectedTags.length > 0 && (
              <span className="ws-sidebar-pull-tab__badge">{selectedTags.length}</span>
            )}
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
              {selectedTags.length > 0 && (
                <span className="ws-sidebar__count-badge">{selectedTags.length}</span>
              )}
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

          {/* Categories List (Multi-Selectable) */}
          <div className="ws-sidebar__list">
            {WORKSHOP_CATEGORIES.map((cat) => {
              const isAll = cat.tag === ''
              const isActive = isAll ? selectedTags.length === 0 : selectedTags.includes(cat.tag)
              const label = isRu ? cat.ru : cat.en

              return (
                <button
                  key={cat.tag || 'all'}
                  className={`ws-sidebar-item ${isActive ? 'is-active' : ''} ${cat.isBuild ? 'is-build' : ''}`}
                  onClick={() => handleToggleCategory(cat.tag)}
                  title={label}
                >
                  <div className={`ws-sidebar-item__check ${isActive ? 'is-checked' : ''}`}>
                    {isActive && <Icon name="check" size={10} strokeWidth={2.8} />}
                  </div>
                  <Icon name={cat.icon} size={14} />
                  <span className="ws-sidebar-item__label">{label}</span>
                </button>
              )
            })}
          </div>

          {/* Sidebar Footer */}
          {selectedTags.length > 0 && (
            <div className="ws-sidebar__footer">
              <button
                className="btn btn--subtle btn--tiny"
                style={{ width: '100%' }}
                onClick={handleResetCategories}
              >
                <Icon name="rotate" size={11} />
                <span>
                  {isRu
                    ? `Сбросить выбор (${selectedTags.length})`
                    : `Reset selection (${selectedTags.length})`}
                </span>
              </button>
            </div>
          )}
        </aside>

        {/* Backdrop for floating drawer (when not pinned) */}
        {sidebarOpen && !sidebarPinned && (
          <div className="ws-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main Grid View */}
        <main className="ws-main" ref={mainRef}>
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
                    ? 'В вашей библиотеке не найдено модов по выбранному фильтру или категориям.'
                    : 'No installed mods found matching the selected filter or categories.'
                  : isRu
                    ? 'Попробуйте изменить поисковый запрос или категории.'
                    : 'Try adjusting your search query or categories.'}
              </span>
              {selectedTags.length > 0 && (
                <button
                  className="btn btn--subtle btn--tiny"
                  style={{ marginTop: 12 }}
                  onClick={handleResetCategories}
                >
                  <Icon name="rotate" size={12} />
                  <span>
                    {isRu
                      ? `Сбросить категории (${selectedTags.length})`
                      : `Reset categories (${selectedTags.length})`}
                  </span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Active Filter Bar Info with Category Chips */}
              <div
                className={`ws-results-header ${
                  !sidebarOpen && !sidebarPinned ? 'has-pull-tab' : ''
                }`}
              >
                <span className="ws-results-count">
                  {mode === 'installed'
                    ? isRu
                      ? `Найдено среди установленных: ${totalCount.toLocaleString()} • Страница ${page.toLocaleString()} из ${totalPages.toLocaleString()}`
                      : `Installed mods found: ${totalCount.toLocaleString()} • Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`
                    : isRu
                      ? `Найдено в Мастерской: ${totalCount.toLocaleString()} • Страница ${page.toLocaleString()} из ${totalPages.toLocaleString()}`
                      : `Workshop mods found: ${totalCount.toLocaleString()} • Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`}
                </span>

                {selectedCategories.length > 0 && (
                  <div className="ws-active-chips">
                    {selectedCategories.map((cat) => (
                      <span key={cat.tag} className="ws-chip">
                        <Icon name={cat.icon} size={11} />
                        <span>{isRu ? cat.ru : cat.en}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleCategory(cat.tag)
                          }}
                          title={isRu ? 'Убрать фильтр' : 'Remove filter'}
                        >
                          <Icon name="close" size={10} />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="ws-chip-clear"
                      onClick={handleResetCategories}
                    >
                      {isRu ? 'Сбросить все' : 'Clear all'}
                    </button>
                  </div>
                )}
              </div>

              {/* Mod Cards Grid */}
              <div className="ws-grid">
                {items.map((item) => {
                  const isSelected = selectedItem?.id === item.id
                  const isB42 = item.tags.some((t) => t.toLowerCase().includes('42') || t.toLowerCase() === 'build 42')
                  const isB41 =
                    item.tags.some((t) => t.toLowerCase().includes('41') || t.toLowerCase() === 'build 41') ||
                    (!isB42 && !item.tags.some((t) => t.toLowerCase().includes('40')))
                  const isLocal = Boolean(
                    item.isLocal || item.id.startsWith('local_') || item.tags.some((t) => t.toLowerCase() === 'local')
                  )

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
                        ) : isLocal ? (
                          <div className="ws-card__badge ws-card__badge--local">
                            <Icon name="folder" size={10} />
                            <span>{isRu ? 'Локальный' : 'Local'}</span>
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
                          {isB41 && <span className="ws-card__tag ws-card__tag--b41">Build 41</span>}
                          {isLocal && (
                            <span className="ws-card__tag ws-card__tag--local">
                              {isRu ? 'Локальный' : 'Local'}
                            </span>
                          )}
                          {item.tags
                            .filter(
                              (t) =>
                                !t.toLowerCase().includes('build') &&
                                t.toLowerCase() !== 'local'
                            )
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

              {/* Multi-Page Discrete Pagination Controls */}
              {totalPages > 1 && (
                <nav className="ws-pagination" aria-label="Pagination Navigation">
                  <div className="ws-pagination__nav">
                    {/* First Page */}
                    <button
                      type="button"
                      className="ws-pagination__btn"
                      disabled={page <= 1 || loading}
                      onClick={() => handleGoToPage(1)}
                      title={isRu ? 'На первую страницу' : 'First page'}
                    >
                      <Icon name="chevrons-left" size={12} />
                      <span>{isRu ? 'Первая' : 'First'}</span>
                    </button>

                    {/* Previous Page */}
                    <button
                      type="button"
                      className="ws-pagination__btn"
                      disabled={page <= 1 || loading}
                      onClick={() => handleGoToPage(page - 1)}
                      title={isRu ? 'Предыдущая страница' : 'Previous page'}
                    >
                      <Icon name="chevron-left" size={12} />
                      <span>{isRu ? 'Назад' : 'Prev'}</span>
                    </button>

                    {/* Numbered Page Buttons with Ellipses */}
                    <div className="ws-pagination__pages">
                      {getPaginationItems(page, totalPages).map((p, idx) => {
                        if (p === '...') {
                          return (
                            <span key={`ellipsis-${idx}`} className="ws-pagination__ellipsis">
                              …
                            </span>
                          )
                        }
                        const isCurrent = p === page
                        return (
                          <button
                            key={`page-${p}`}
                            type="button"
                            className={`ws-pagination__page-btn ${isCurrent ? 'is-active' : ''}`}
                            disabled={loading || isCurrent}
                            onClick={() => handleGoToPage(p)}
                            title={isRu ? `Страница ${p}` : `Page ${p}`}
                          >
                            {p}
                          </button>
                        )
                      })}
                    </div>

                    {/* Next Page */}
                    <button
                      type="button"
                      className="ws-pagination__btn"
                      disabled={page >= totalPages || loading}
                      onClick={() => handleGoToPage(page + 1)}
                      title={isRu ? 'Следующая страница' : 'Next page'}
                    >
                      <span>{isRu ? 'Вперёд' : 'Next'}</span>
                      <Icon name="chevron-right" size={12} />
                    </button>

                    {/* Last Page */}
                    <button
                      type="button"
                      className="ws-pagination__btn"
                      disabled={page >= totalPages || loading}
                      onClick={() => handleGoToPage(totalPages)}
                      title={isRu ? `На последнюю страницу (${totalPages})` : `Last page (${totalPages})`}
                    >
                      <span>{isRu ? 'Последняя' : 'Last'}</span>
                      <Icon name="chevrons-right" size={12} />
                    </button>
                  </div>

                  {/* Direct Jump to Page Form */}
                  <form className="ws-pagination__jump" onSubmit={handleJumpSubmit}>
                    <span className="ws-pagination__jump-label">
                      {isRu ? 'К странице:' : 'Go to page:'}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpPageInput}
                      onChange={(e) => setJumpPageInput(e.target.value)}
                      disabled={loading}
                      className="ws-pagination__jump-input"
                    />
                    <span className="ws-pagination__jump-total">
                      {isRu ? `из ${totalPages.toLocaleString()}` : `of ${totalPages.toLocaleString()}`}
                    </span>
                    <button
                      type="submit"
                      className="ws-pagination__jump-btn"
                      disabled={loading}
                    >
                      {isRu ? 'Перейти' : 'Go'}
                    </button>
                  </form>
                </nav>
              )}
            </>
          )}
        </main>

        {/* Side-Drawer: Detailed Mod View */}
        {selectedItem && (() => {
          const isDrawerB42 = selectedItem.tags.some(
            (t) => t.toLowerCase().includes('42') || t.toLowerCase() === 'build 42'
          )
          const isDrawerB41 =
            selectedItem.tags.some(
              (t) => t.toLowerCase().includes('41') || t.toLowerCase() === 'build 41'
            ) ||
            (!isDrawerB42 && !selectedItem.tags.some((t) => t.toLowerCase().includes('40')))
          const isDrawerLocal = Boolean(
            selectedItem.isLocal ||
              selectedItem.id.startsWith('local_') ||
              selectedItem.tags.some((t) => t.toLowerCase() === 'local')
          )
          const isNumericSteam = /^\d+$/.test(selectedItem.id)

          return (
            <aside className="ws-drawer">
              <header className="ws-drawer__header">
                <div className="ws-drawer__title-block">
                  <div className="ws-drawer__title">{selectedItem.title}</div>
                  <div className="ws-drawer__author">
                    {isRu ? 'Автор: ' : 'Author: '}
                    <span className="bold" style={{ color: 'var(--amber)' }}>
                      {selectedItem.author || (isDrawerLocal ? 'Local Mod' : 'Steam User')}
                    </span>
                  </div>

                  {/* Build badges & tags */}
                  <div className="ws-drawer__tags-row">
                    {isDrawerB42 && <span className="ws-card__tag ws-card__tag--b42">Build 42</span>}
                    {isDrawerB41 && <span className="ws-card__tag ws-card__tag--b41">Build 41</span>}
                    {isDrawerLocal && (
                      <span className="ws-card__tag ws-card__tag--local">
                        <Icon name="folder" size={10} />
                        {isRu ? 'Локальный мод' : 'Local Mod'}
                      </span>
                    )}
                    {selectedItem.tags
                      .filter((t) => !t.toLowerCase().includes('build') && t.toLowerCase() !== 'local')
                      .slice(0, 4)
                      .map((t) => (
                        <span key={t} className="ws-card__tag">
                          {t}
                        </span>
                      ))}
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
                  {isDrawerLocal ? (
                    <div className="ws-drawer__installed-status">
                      <div className="ws-badge-installed-pill ws-badge-installed-pill--local">
                        <Icon name="folder" size={13} color="#10b981" />
                        <span>{isRu ? 'Установлен локально (диск)' : 'Installed locally (disk)'}</span>
                      </div>
                    </div>
                  ) : selectedItem.isInstalled || selectedItem.isSubscribed ? (
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
                      title={isRu ? 'Скопировать ID' : 'Copy ID'}
                    >
                      <Icon name="copy" size={12} />
                      <span>ID: {selectedItem.id}</span>
                    </button>

                    {isNumericSteam && (
                      <>
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
                          onClick={() => void handleOpenBrowser(selectedItem.id)}
                          title={isRu ? 'Открыть в веб-браузере' : 'Open in browser'}
                        >
                          <Icon name="globe" size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Technical Specifications */}
                <div className="ws-meta-grid">
                  <div className="ws-meta-item">
                    <span className="ws-meta-item__label">{isRu ? 'Совместимость' : 'Target Build'}</span>
                    <span className="ws-meta-item__value">
                      {isDrawerB42 && isDrawerB41
                        ? 'B41 + B42'
                        : isDrawerB42
                          ? 'Build 42'
                          : 'Build 41'}
                    </span>
                  </div>
                  <div className="ws-meta-item">
                    <span className="ws-meta-item__label">{isRu ? 'Размер мода' : 'File Size'}</span>
                    <span className="ws-meta-item__value mono">{formatBytes(selectedItem.fileSize)}</span>
                  </div>
                  <div className="ws-meta-item">
                    <span className="ws-meta-item__label">{isRu ? 'Подписчиков' : 'Subscribers'}</span>
                    <span className="ws-meta-item__value mono">
                      {selectedItem.subscriptions > 0
                        ? selectedItem.subscriptions.toLocaleString()
                        : isDrawerLocal
                          ? isRu ? 'Локальный' : 'Local'
                          : '—'}
                    </span>
                  </div>
                  <div className="ws-meta-item">
                    <span className="ws-meta-item__label">{isRu ? 'Источник' : 'Source'}</span>
                    <span className="ws-meta-item__value">
                      {isDrawerLocal ? (isRu ? 'Локальный (диск)' : 'Local (disk)') : 'Steam Workshop'}
                    </span>
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
          )
        })()}
      </div>
    </div>
  )
}
