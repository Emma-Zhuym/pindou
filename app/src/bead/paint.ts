// Drawing a chart for beading and editing: bead-coloured cells, a thin line round every cell, red
// lines every 5 (dashed) and 10 (solid) on a white halo, row and column numbers, optionally the
// pegboard it sits on and each cell's code.
import { codeColour } from '../shared'

export const MIN_CELL = 4
export const LABEL_CELL = 11 // smallest cell the code is printed in
/** Pegs left blank round the printed guide lines of each pegboard (52: 1+50+1, 78: 4+70+4, 104: 2+100+2). */
export const BOARD_INSET: Record<number, number> = { 52: 1, 78: 4, 104: 2 }
export const MAX_SIDE = 4000 // canvas pixels a side, within what phones allow
const GUIDE = '#e5243b' // every 5th and 10th grid line

export interface GuideMark {
  /** grid-line position in board cells, measured from its top/left edge */
  cell: number
  /** solid at the first line, then alternating dashed/solid */
  strong: boolean
}

/** The pegboard's printed guide positions. The blank rim is part of the board, not the chart. */
export function boardGuideMarks(side: number): GuideMark[] {
  const inset = BOARD_INSET[side] ?? 0
  const marks: GuideMark[] = []
  for (let cell = inset, i = 0; cell <= side - inset; cell += 5, i++) marks.push({ cell, strong: i % 2 === 0 })
  return marks
}

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
  /** where the chart sits on the pegboard, in pegs from its top left; centred when absent */
  offset?: { x: number; y: number }
  /** show the chart boundary while the user is positioning it on a pegboard */
  moving?: boolean
  /** false: no ruler margin; the numbers are drawn apart (paintRulers) so they can stay in view */
  rulers?: boolean
}

/** Text colour that reads on a bead colour. */
export const inkOn = (code: string) => {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(codeColour(code))
  if (!m) return '#000'
  const [r, g, b] = m.slice(1).map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)'
}

/** Where things are, in CSS pixels: a two-cell ruler margin (unless the rulers are drawn apart),
 *  then the pegboard or the chart. */
export function layout(o: Pick<PaintOptions, 'cols' | 'rows' | 'cell' | 'board' | 'offset' | 'rulers'>) {
  const w = o.board ?? o.cols
  const h = o.board ?? o.rows
  const m = o.rulers === false ? 0 : 2 * o.cell
  return {
    width: w * o.cell + m,
    height: h * o.cell + m,
    margin: m,
    // the chart on the pegboard: where it was put, else centred
    x0: m + (o.offset?.x ?? Math.floor((w - o.cols) / 2)) * o.cell,
    y0: m + (o.offset?.y ?? Math.floor((h - o.rows) / 2)) * o.cell,
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
  const { cells, cols, rows, cell, board, mirror = false, labels = false, focus = null, done = [], moving = false } = o
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
  // codes as large as fits: a three-character code across 86% of the cell, at most half its height
  ctx.font = '600 10px -apple-system, sans-serif'
  const labelPx = Math.min(cell * 0.5, (10 * cell * 0.86) / ctx.measureText('B88').width)
  ctx.font = `600 ${labelPx}px -apple-system, sans-serif`
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
  // A thin line round every cell (every peg, on a pegboard). The red 5/10 lines are the
  // pegboard's own printed lines when on one (they stay put as the chart moves), else the chart's.
  const gx0 = board ? m : x0
  const gy0 = board ? m : y0
  const gw = board ? L.w : cols
  const gh = board ? L.h : rows
  const inset = board ? (BOARD_INSET[board] ?? 0) : 0
  const thin = (k: number, vertical: boolean) => {
    ctx.beginPath()
    if (vertical) {
      ctx.moveTo(gx0 + k * cell, gy0)
      ctx.lineTo(gx0 + k * cell, gy0 + gh * cell)
    } else {
      ctx.moveTo(gx0, gy0 + k * cell)
      ctx.lineTo(gx0 + gw * cell, gy0 + k * cell)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'
  ctx.lineWidth = 0.75
  for (let k = 0; k <= gw; k++) thin(k, true)
  for (let k = 0; k <= gh; k++) thin(k, false)
  // the marked lines in red on a white halo, so they show on any bead
  const mark = (k: number, vertical: boolean, strong: boolean) => {
    const path = () => {
      ctx.beginPath()
      if (vertical) {
        const x = gx0 + k * cell
        ctx.moveTo(x, gy0 + inset * cell)
        ctx.lineTo(x, gy0 + (gh - inset) * cell)
      } else {
        const y = gy0 + k * cell
        ctx.moveTo(gx0 + inset * cell, y)
        ctx.lineTo(gx0 + (gw - inset) * cell, y)
      }
    }
    const width = strong ? 2 : 1.25
    ctx.setLineDash(strong ? [] : [Math.max(3, cell / 3), Math.max(2, cell / 5)])
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = width + 2
    path()
    ctx.stroke()
    ctx.strokeStyle = GUIDE
    ctx.lineWidth = width
    path()
    ctx.stroke()
  }
  if (board) {
    // These coordinates belong to the board, so they do not move with the chart.
    for (const guide of boardGuideMarks(board)) mark(guide.cell, true, guide.strong)
    for (const guide of boardGuideMarks(board)) mark(guide.cell, false, guide.strong)
  } else {
    // On a chart alone the lines count from the mirrored side too, so they match the printed chart.
    for (let k = 0; k <= gw; k++) {
      const fromV = mirror ? gw - k : k
      if (fromV % 5 === 0) mark(k, true, fromV % 10 === 0)
    }
    for (let k = 0; k <= gh; k++) if (k % 5 === 0) mark(k, false, k % 10 === 0)
  }
  ctx.setLineDash([])
  // The chart edge is useful only while placing it; the board edge remains visible.
  if (moving && board) {
    ctx.lineWidth = 2
    ctx.strokeStyle = '#000'
    ctx.strokeRect(x0, y0, cols * cell, rows * cell)
  }
  if (board) {
    ctx.strokeStyle = '#8e8e93'
    ctx.strokeRect(m, m, L.w * cell, L.h * cell)
  }
  if (o.rulers === false) return
  // rulers every 5: the pegboard's lines when on one, else the chart's columns and rows
  ctx.fillStyle = '#6e6e73'
  ctx.font = `${Math.max(9, Math.floor(cell * 0.7))}px -apple-system, sans-serif`
  if (board) {
    for (let k = 5; k <= gw - 2 * inset; k += 5) ctx.fillText(String(k), gx0 + (inset + k - 0.5) * cell, m - cell * 0.8)
    for (let k = 5; k <= gh - 2 * inset; k += 5) ctx.fillText(String(k), m - cell * 0.9, gy0 + (inset + k - 0.5) * cell)
  } else {
    for (let k = 5; k <= cols; k += 5) ctx.fillText(String(k), x0 + ((mirror ? cols - k : k - 1) + 0.5) * cell, m - cell * 0.8)
    for (let k = 5; k <= rows; k += 5) ctx.fillText(String(k), m - cell * 0.9, y0 + (k - 0.5) * cell)
  }
}

/** One number on a ruler: its place along the ruler (CSS pixels from the chart's top or left
 *  edge) and whether it is a fifth, printed bold. */
function marks(o: PaintOptions, across: boolean): { at: number; n: number; bold: boolean }[] {
  const { cell, board, mirror = false } = o
  const L = layout({ ...o, rulers: false })
  const out: { at: number; n: number; bold: boolean }[] = []
  if (board) {
    // the pegboard's own numbering, inside its blank border
    const inset = BOARD_INSET[board] ?? 0
    for (let k = 1; k <= board - 2 * inset; k++) out.push({ at: (inset + k - 0.5) * cell, n: k, bold: k % 5 === 0 })
  } else {
    const count = across ? o.cols : o.rows
    const start = across ? L.x0 : L.y0
    for (let k = 1; k <= count; k++) out.push({ at: start + ((across && mirror ? count - k : k - 1) + 0.5) * cell, n: k, bold: k % 5 === 0 })
  }
  return out
}

/**
 * The column numbers along `top` and the row numbers down `left`, matching a chart painted with
 * `rulers: false`: kept apart so the page can hold them in view while the chart scrolls. Every
 * fifth number always; every number once the cells are big enough to read them.
 */
export function paintRulers(top: HTMLCanvasElement, left: HTMLCanvasElement, o: PaintOptions, thick: number, ink: string) {
  const L = layout({ ...o, rulers: false })
  const each = o.cell >= 18
  const draw = (canvas: HTMLCanvasElement, w: number, h: number, across: boolean) => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(w, h))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const m of marks(o, across)) {
      if (!m.bold && !each) continue
      ctx.fillStyle = ink
      ctx.globalAlpha = m.bold ? 1 : 0.55
      const size = m.bold ? Math.min(13, Math.max(10, o.cell * 0.55)) : Math.min(11, o.cell * 0.45)
      ctx.font = `${m.bold ? 600 : 400} ${size}px -apple-system, sans-serif`
      if (across) ctx.fillText(String(m.n), m.at, h / 2)
      else ctx.fillText(String(m.n), w / 2, m.at)
    }
    ctx.globalAlpha = 1
  }
  draw(top, L.width, thick, true)
  draw(left, thick, L.height, false)
}
