import { useCallback, useEffect, useRef } from 'react'

interface SplitterProps {
  /** Called with the pointer delta in pixels while dragging. */
  onDrag: (deltaX: number) => void
  onDoubleClick?: () => void
}

/** Thin vertical drag handle between panes. */
export function Splitter({ onDrag, onDoubleClick }: SplitterProps) {
  const last = useRef<number | null>(null)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (last.current === null) return
      const delta = e.clientX - last.current
      last.current = e.clientX
      if (delta !== 0) onDrag(delta)
    },
    [onDrag]
  )

  const stop = useCallback(() => {
    last.current = null
    document.body.classList.remove('is-resizing')
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [onPointerMove, stop])

  return (
    <div
      className="splitter"
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        last.current = e.clientX
        document.body.classList.add('is-resizing')
      }}
    >
      <span className="splitter__grip" />
    </div>
  )
}
