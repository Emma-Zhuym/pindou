// Drawing a chart for beading and editing: bead-coloured cells, a thin line round every cell, red
// lines every 5 (dashed) and 10 (solid) on a white halo, row and column numbers, optionally the
// pegboard it sits on and each cell's code.
import { codeColour } from '../shared'

export const MIN_CELL = 4
export const LABEL_CELL = 20 // smallest cell the code is printed in
export const MAX_SIDE = 4000 // canvas pixels a side, within what phones allow
const GUIDE = '#e5243b' // every 5th and 10th grid line

export interface PaintOptions {
  cells: string[]
  cols: number
  rows: number
  /** CSS pixels per cell */
  cell: number
  /** pegboard pegs a side, or null to draw the chart alone */
  board: number | null
  mirror?: boolean
  labels?: boolean
  /** the one code shown at full strength, others faded */
  focus?: string | null
  /** codes ticked off: faded */
  done?: string[]
}

/** Text colour that reads on a bead colour. */
export const inkOn = (code: string) => {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(codeColour(code))
  if (!m) return '#000'
  const [r, g, b] = m.slice(1).map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)'
}

/** Where things are, in CSS pixels: a two-cell ruler margin, then the pegboard or the chart. */
export function layout(o: Pick<PaintOptions, 'cols' | 'rows' | 'cell' | 'board'>) {
  const w = o.board ?? o.cols
  const h = o.board ?? o.rows
  const m = 2 * o.cell
  return {
    width: (w + 2) * o.cell,
    height: (h + 2) * o.cell,
    margin: m,
    // the chart, centred on the pegboard
    x0: m + Math.floor((w - o.cols) / 2) * o.cell,
    y0: m + Math.floor((h - o.rows) / 2) * o.cell,
    w,
    h,
  }
}

/** The cell under a point of the canvas (CSS pixels), or -1. */
export function cellAt(o: PaintOptions, x: number, y: number): number {
  const { x0, y0 } = layout(o)
  const cx = Math.floor((x - x0) / o.cell)
  const r = Math.floor((y - y0) / o.cell)
  if (cx < 0 || r < 0 || cx >= o.cols || r >= o.rows) return -1
  return r * o.cols + (o.mirror ? o.cols - 1 - cx : cx)
}

export function paintChart(canvas: HTMLCanvasElement, o: PaintOptions) {
  const { cells, cols, rows, cell, board, mirror = false, labels = false, focus = null, done = [] } = o
  const L = layout(o)
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(L.width, L.height))
  canvas.width = Math.round(L.width * dpr)
  canvas.height = Math.round(L.height * dpr)
  canvas.style.width = `${L.width}px`
  canvas.style.height = `${L.height}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, L.width, L.height)
  const { margin: m, x0, y0 } = L
  if (board) {
    ctx.fillStyle = '#f2f2f4'
    ctx.fillRect(m, m, L.w * cell, L.h * cell)
    if (cell >= 8) {
      ctx.fillStyle = '#d8d8de'
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) ctx.fillRect(m + (x + 0.5) * cell - 1, m + (y + 0.5) * cell - 1, 2, 2)
    }
  }
  const at = (c0: number) => (mirror ? cols - 1 - c0 : c0)
  const text = labels && cell >= LABEL_CELL
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.floor(cell * 0.36)}px -apple-system, sans-serif`
  for (let r = 0; r < rows; r++) {
    for (let c0 = 0; c0 < cols; c0++) {
      const code = cells[r * cols + c0]
      if (!code) continue
      const x = x0 + at(c0) * cell
      const y = y0 + r * cell
      const dim = focus ? code !== focus : done.includes(code)
      ctx.globalAlpha = dim ? (focus ? 0.12 : 0.3) : 1
      ctx.fillStyle = codeColour(code)
      ctx.fillRect(x, y, cell, cell)
      if (text && !dim) {
        ctx.fillStyle = inkOn(code)
        ctx.fillText(code, x + cell / 2, y + cell / 2)
      }
    }
  }
  ctx.globalAlpha = 1
  // Grid over the chart, counted from its own first row and column: a thin line round every cell;
  // every 5th dashed and every 10th solid, in red on a white halo so they show on any bead.
  const line = (k: number, vertical: boolean) => {
    const strong = k % 10 === 0
    const mid = !strong && k % 5 === 0
    const path = () => {
      ctx.beginPath()
      if (vertical) {
        const x = x0 + (mirror ? cols - k : k) * cell
        ctx.moveTo(x, y0)
        ctx.lineTo(x, y0 + rows * cell)
      } else {
        const y = y0 + k * cell
        ctx.moveTo(x0, y)
        ctx.lineTo(x0 + cols * cell, y)
      }
    }
    if (!strong && !mid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.16)'
      ctx.lineWidth = 0.75
      ctx.setLineDash([])
      path()
      ctx.stroke()
      return
    }
    const width = strong ? 2 : 1.25
    ctx.setLineDash(mid ? [Math.max(3, cell / 3), Math.max(2, cell / 5)] : [])
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = width + 2
    path()
    ctx.stroke()
    ctx.strokeStyle = GUIDE
    ctx.lineWidth = width
    path()
    ctx.stroke()
  }
  // thin ones first, so the marked ones lie on top
  for (const pass of [0, 1]) {
    for (let k = 0; k <= cols; k++) if ((k % 5 === 0) === (pass === 1)) line(k, true)
    for (let k = 0; k <= rows; k++) if ((k % 5 === 0) === (pass === 1)) line(k, false)
  }
  ctx.setLineDash([])
  // the chart's edge, and the pegboard's
  ctx.lineWidth = 2
  ctx.strokeStyle = '#000'
  ctx.strokeRect(x0, y0, cols * cell, rows * cell)
  if (board) {
    ctx.strokeStyle = '#8e8e93'
    ctx.strokeRect(m, m, L.w * cell, L.h * cell)
  }
  // rulers: the chart's column and row numbers every 5
  ctx.fillStyle = '#6e6e73'
  ctx.font = `${Math.max(9, Math.floor(cell * 0.7))}px -apple-system, sans-serif`
  for (let k = 5; k <= cols; k += 5) ctx.fillText(String(k), x0 + ((mirror ? cols - k : k - 1) + 0.5) * cell, m - cell * 0.8)
  for (let k = 5; k <= rows; k += 5) ctx.fillText(String(k), m - cell * 0.9, y0 + (k - 0.5) * cell)
}
