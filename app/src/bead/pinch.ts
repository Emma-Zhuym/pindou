import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Two-finger pinch on the chart: changes the cell size, keeping the spot between the fingers where
 * it was. The page scrolls up and down, the stage left and right, so both are adjusted after the
 * chart is redrawn at its new size. The browser's own page zoom is held off while pinching.
 * Call it after the effect that paints the chart, so its scrolling sees the new size.
 */
export function usePinchZoom(stage: RefObject<HTMLElement | null>, canvas: RefObject<HTMLCanvasElement | null>, cell: number, setCell: (n: number) => void, min: number, max: number) {
  // the latest values, for listeners added once
  const now = useRef({ cell, min, max, setCell })
  useLayoutEffect(() => {
    now.current = { cell, min, max, setCell }
  })
  // where the fingers' midpoint should stay: in cells from the chart's corner, and on screen
  const anchor = useRef<{ u: number; v: number; x: number; y: number } | null>(null)
  const start = useRef<{ dist: number; cell: number } | null>(null)

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      start.current = { dist: spread(e.touches), cell: now.current.cell }
    }
    const onMove = (e: TouchEvent) => {
      const s = start.current
      if (!s || e.touches.length !== 2) return
      e.preventDefault()
      const { min, max, setCell } = now.current
      const next = Math.round(Math.min(max, Math.max(min, (s.cell * spread(e.touches)) / s.dist)))
      const m = mid(e.touches)
      const r = canvas.current?.getBoundingClientRect()
      if (r) anchor.current = { u: (m.x - r.left) / now.current.cell, v: (m.y - r.top) / now.current.cell, x: m.x, y: m.y }
      if (next !== now.current.cell) setCell(next)
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start.current = null
    }
    // Safari's own pinch-to-zoom of the whole page
    const hold = (e: Event) => e.preventDefault()
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    el.addEventListener('gesturestart', hold)
    el.addEventListener('gesturechange', hold)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('gesturestart', hold)
      el.removeEventListener('gesturechange', hold)
    }
  }, [stage, canvas])

  // after the redraw at the new size (call this hook after the effect that paints the chart):
  // scroll so the anchored spot is back under the fingers
  useEffect(() => {
    const a = anchor.current
    const r = canvas.current?.getBoundingClientRect()
    if (!a || !r) return
    anchor.current = null
    const dx = r.left + a.u * cell - a.x
    const dy = r.top + a.v * cell - a.y
    stage.current?.scrollBy(dx, 0)
    window.scrollBy(0, dy)
  }, [cell, stage, canvas])

  /** true while two fingers are down: one-finger tools should let go */
  return () => start.current !== null
}
