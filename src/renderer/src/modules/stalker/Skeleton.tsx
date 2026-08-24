import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsNode, ModEntry } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useMenu } from '@renderer/components/Menu'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { fileColor, fileIcon } from '@renderer/lib/catmeta'
import { copyText, formatBytes, formatCount } from '@renderer/lib/format'
import { useVirtual } from '@renderer/lib/useVirtual'

const ROW_H = 24
const DEEP_DEPTH = 6

interface FlatNode {
  node: FsNode
  depth: number
  expanded: boolean
}

interface SkeletonProps {
  mod: ModEntry | undefined
  selectedPath: string | undefined
  onSelectNode: (node: FsNode) => void
}

/** Recursively push pre-fetched children into the cache. */
function seedCache(nodes: FsNode[], cache: Map<string, FsNode[]>): void {
  for (const n of nodes) {
    if (n.children) {
      cache.set(n.path, n.children)
      seedCache(n.children, cache)
    }
  }
}

function collectDirs(nodes: FsNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.dir && n.childCount > 0) out.add(n.path)
    if (n.children) collectDirs(n.children, out)
  }
}

export function Skeleton({ mod, selectedPath, onSelectNode }: SkeletonProps) {
  const [roots, setRoots] = useState<FsNode[]>([])
  const [cache, setCache] = useState<Map<string, FsNode[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [deepLoaded, setDeepLoaded] = useState(false)
  const requestId = useRef(0)
  const { openMenu } = useMenu()
  const { notify } = useToast()
  const { t, p } = useI18n()

  useEffect(() => {
    setFilter('')
    setDeepLoaded(false)
    if (!mod) {
      setRoots([])
      setCache(new Map())
      setExpanded(new Set())
      return
    }
    const id = ++requestId.current
    setBusy(true)
    setRoots([])
    setCache(new Map())
    void window.pz.fs
      .tree(mod.path, 2)
      .then((nodes) => {
        if (id !== requestId.current) return
        const next = new Map<string, FsNode[]>()
        seedCache(nodes, next)
        setCache(next)
        setRoots(nodes)
        // Open the folders that actually matter on first paint.
        const auto = new Set<string>()
        for (const n of nodes) {
          if (n.dir && /^(media|common|4[12].*)$/i.test(n.name)) auto.add(n.path)
        }
        const media = nodes.find((n) => n.dir && n.name.toLowerCase() === 'media')
        for (const child of media?.children ?? []) {
          if (child.dir && /^(lua|scripts)$/i.test(child.name)) auto.add(child.path)
        }
        setExpanded(auto)
      })
      .finally(() => {
        if (id === requestId.current) setBusy(false)
      })
  }, [mod])

  const loadChildren = useCallback(
    async (path: string) => {
      if (cache.has(path)) return
      setLoading((prev) => new Set(prev).add(path))
      try {
        const children = await window.pz.fs.list(path)
        setCache((prev) => new Map(prev).set(path, children))
      } finally {
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    },
    [cache]
  )

  const toggle = useCallback(
    (node: FsNode) => {
      if (!node.dir) return
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(node.path)) next.delete(node.path)
        else {
          next.add(node.path)
          if (!cache.has(node.path)) void loadChildren(node.path)
        }
        return next
      })
    },
    [cache, loadChildren]
  )

  const expandDeep = useCallback(async () => {
    if (!mod) return
    setBusy(true)
    try {
      const nodes = await window.pz.fs.tree(mod.path, DEEP_DEPTH)
      const next = new Map<string, FsNode[]>()
      seedCache(nodes, next)
      const dirs = new Set<string>()
      collectDirs(nodes, dirs)
      setCache(next)
      setRoots(nodes)
      setExpanded(dirs)
      setDeepLoaded(true)
      notify(
        t('toast.loadedFolders', {
          n: formatCount(dirs.size),
          folders: p('folders', dirs.size)
        }),
        'ok'
      )
    } finally {
      setBusy(false)
    }
  }, [mod, notify, t, p])

  const flat = useMemo(() => {
    const out: FlatNode[] = []
    const needle = filter.trim().toLowerCase()

    const matches = (n: FsNode): boolean => n.name.toLowerCase().includes(needle)

    const hasMatchInside = (nodes: FsNode[]): boolean =>
      nodes.some((n) => matches(n) || hasMatchInside(cache.get(n.path) ?? []))

    const walk = (nodes: FsNode[], depth: number): void => {
      for (const n of nodes) {
        const children = cache.get(n.path) ?? []
        if (needle) {
          const self = matches(n)
          const inside = n.dir && hasMatchInside(children)
          if (!self && !inside) continue
          out.push({ node: n, depth, expanded: n.dir })
          if (n.dir) walk(children, depth + 1)
          continue
        }
        const isOpen = expanded.has(n.path)
        out.push({ node: n, depth, expanded: isOpen })
        if (n.dir && isOpen) walk(children, depth + 1)
      }
    }
    walk(roots, 0)
    return out
  }, [roots, cache, expanded, filter])

  const v = useVirtual(flat.length, ROW_H)

  const nodeMenu = useCallback(
    (e: React.MouseEvent, node: FsNode) => {
      openMenu(e, [
        {
          label: node.dir ? t('menu.openFolderExplorer') : t('menu.reveal'),
          icon: 'external',
          hint: t('menu.hintDblClick'),
          onClick: () =>
            void (node.dir ? window.pz.shell.open(node.path) : window.pz.shell.reveal(node.path))
        },
        {
          label: t('menu.openDefaultApp'),
          icon: 'eye',
          disabled: node.dir,
          onClick: () => void window.pz.shell.open(node.path)
        },
        {
          label: t('menu.openTerminal'),
          icon: 'terminal',
          onClick: () =>
            void window.pz.shell.terminal(
              node.dir ? node.path : node.path.replace(/[\\/][^\\/]+$/, '')
            )
        },
        { separator: true },
        {
          label: t('menu.copyFullPath'),
          icon: 'copy',
          onClick: () => {
            void copyText(node.path)
            notify(t('toast.pathCopied'), 'ok')
          }
        },
        {
          label: t('menu.copyName'),
          icon: 'hash',
          onClick: () => {
            void copyText(node.name)
            notify(t('toast.nameCopied'), 'ok')
          }
        }
      ])
    },
    [openMenu, notify, t]
  )

  if (!mod) {
    return (
      <div className="pane__empty pane__empty--big">
        <Icon name="crosshair" size={34} strokeWidth={1.2} />
        <span className="stencil">{t('sk.pickMod')}</span>
        <span className="label">{t('sk.skeletonHere')}</span>
      </div>
    )
  }

  return (
    <>
      <div className="pane__head">
        <Icon name="layers" size={13} color="var(--rust)" />
        <span className="pane__title stencil truncate">{mod.folderName}</span>
        <span className="pane__count mono">{formatCount(flat.length)}</span>
        <div className="pane__head-spacer" />
        <div className="minisearch">
          <Icon name="search" size={12} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('sk.filterFiles')}
            spellCheck={false}
          />
          {filter && (
            <button className="minisearch__clear" onClick={() => setFilter('')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <button
          className="btn btn-icon"
          title={t('sk.loadFullTree', { n: DEEP_DEPTH })}
          onClick={() => void expandDeep()}
          disabled={busy || deepLoaded}
        >
          <Icon name={busy ? 'refresh' : 'plus'} size={13} className={busy ? 'spin' : undefined} />
        </button>
        <button
          className="btn btn-icon"
          title={t('sk.collapseAll')}
          onClick={() => setExpanded(new Set())}
        >
          <Icon name="minus" size={13} />
        </button>
        <button
          className="btn btn-icon"
          title={t('sk.openModFolder')}
          onClick={() => void window.pz.shell.open(mod.path)}
        >
          <Icon name="folder-open" size={13} />
        </button>
      </div>

      <div className="pane__scroll" ref={v.ref}>
        <div style={{ height: v.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${v.offset}px)` }}>
            {flat.slice(v.start, v.end).map(({ node, depth, expanded: isOpen }) => {
              const color = node.dir ? 'var(--ash)' : fileColor(node.ext)
              const icon = node.dir ? (isOpen ? 'folder-open' : 'folder') : fileIcon(node.ext)
              const isLoading = loading.has(node.path)
              return (
                <div
                  key={node.path}
                  className={`fsrow ${selectedPath === node.path ? 'is-selected' : ''} ${
                    node.dir ? 'is-dir' : ''
                  }`}
                  style={{ height: ROW_H }}
                  onClick={() => {
                    onSelectNode(node)
                    if (node.dir && !filter) toggle(node)
                  }}
                  onDoubleClick={() =>
                    void (node.dir
                      ? window.pz.shell.open(node.path)
                      : window.pz.shell.reveal(node.path))
                  }
                  onContextMenu={(e) => {
                    onSelectNode(node)
                    nodeMenu(e, node)
                  }}
                  title={node.path}
                >
                  {Array.from({ length: depth }).map((_, i) => (
                    <span key={i} className="fsrow__rail" />
                  ))}
                  <span className="fsrow__caret">
                    {node.dir && node.childCount > 0 && (
                      <Icon
                        name={isLoading ? 'refresh' : isOpen ? 'chevron-down' : 'chevron-right'}
                        size={11}
                        className={isLoading ? 'spin' : undefined}
                      />
                    )}
                  </span>
                  <Icon name={icon} size={13} color={color} />
                  <span className="fsrow__name truncate">{node.name}</span>
                  <span className="fsrow__meta mono">
                    {node.dir ? `${formatCount(node.childCount)}` : formatBytes(node.size)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        {!busy && flat.length === 0 && (
          <div className="pane__empty">
            <Icon name="folder" size={22} />
            <span className="label">{filter ? t('sk.noFilesMatch') : t('sk.emptyFolder')}</span>
          </div>
        )}
      </div>
    </>
  )
}
