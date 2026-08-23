import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface VirtualWindow {
  ref: React.RefObject<HTMLDivElement | null>
  start: number
  end: number
  offset: number
  totalHeight: number
  scrollToIndex(index: number): void
}

/**
 * Minimal fixed-height row virtualiser. Keeps 900+ mod rows and 10k+ file rows
 * scrolling at native speed without pulling in a dependency.
 */
export function useVirtual(count: number, rowHeight: number, overscan = 12): VirtualWindow {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setViewport(el.clientHeight || 600)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const visible = Math.ceil(viewport / rowHeight)
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, start + visible + overscan * 2)

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = ref.current
      if (!el) return
      const top = index * rowHeight
      const bottom = top + rowHeight
      if (top < el.scrollTop) el.scrollTop = top - rowHeight
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight + rowHeight
      }
    },
    [rowHeight]
  )

  return {
    ref,
    start,
    end,
    offset: start * rowHeight,
    totalHeight: count * rowHeight,
    scrollToIndex
  }
}
