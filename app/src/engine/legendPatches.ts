// Finding legend swatches by colour: a swatch is a flat patch, outside the board, painted in one
// of the colours the board's cells use. Unlike the darkness thresholds in legendSwatches.ts this
// does not care whether the swatch is pale or dark, rounded or square, or whether the code is
// printed inside it or beside it.
import { clusterByFill } from './cells'
import type { Rgb } from './glyphs'
import { type Raster, reduce } from './grid'
import type { LegendSwatch } from './legendSwatches'
import type { Recognition } from './recognize'

/** working resolution: about this many pixels per cell */
const WORK_CELL = 12
const FLAT = 28 // a patch grows over pixels this close to its running mean
const MATCH = 40 // a patch colour this close to a board colour is that colour's swatch
const SAME = 10 // printed in the same ink
const SAME_SIZE = 0.15 // and the same size, each side within this share

interface Patch {
  x0: number
  y0: number
  x1: number
  y1: number
  n: number
  r: number
  g: number
  b: number
  /** share of the bounding box inside the outline, by rows and by columns (the smaller): holes
   *  such as a printed code count as inside, letter strokes do not fill their box */
  solid: number
}

const dist = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

/** Flat-colour regions of the image outside the board, at working resolution. */
export function patches(img: Raster, board: { x0: number; y0: number; x1: number; y1: number }): Patch[] {
  const { width: W, height: H, data } = img
  const seen = new Uint8Array(W * H)
  for (let y = Math.max(0, board.y0); y < Math.min(H, board.y1); y++) seen.fill(1, y * W + Math.max(0, board.x0), y * W + Math.min(W, board.x1))
  const queue = new Int32Array(W * H)
  const out: Patch[] = []
  for (let start = 0; start < W * H; start++) {
    if (seen[start]) continue
    seen[start] = 1
    let r = data[start * 4]
    let g = data[start * 4 + 1]
    let b = data[start * 4 + 2]
    const p: Patch = { x0: start % W, y0: Math.floor(start / W), x1: start % W, y1: Math.floor(start / W), n: 1, r, g, b, solid: 1 }
    let head = 0
    let tail = 0
    queue[tail++] = start
    while (head < tail) {
      const q = queue[head++]
      const x = q % W
      const y = (q - x) / W
      for (const nb of [x > 0 ? q - 1 : -1, x + 1 < W ? q + 1 : -1, y > 0 ? q - W : -1, y + 1 < H ? q + W : -1]) {
        if (nb < 0 || seen[nb]) continue
        const i = nb * 4
        if (Math.abs(data[i] - p.r) + Math.abs(data[i + 1] - p.g) + Math.abs(data[i + 2] - p.b) >= FLAT) continue
        seen[nb] = 1
        queue[tail++] = nb
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        p.n++
        p.r = r / p.n
        p.g = g / p.n
        p.b = b / p.n
        const nx = nb % W
        const ny = (nb - nx) / W
        if (nx < p.x0) p.x0 = nx
        if (nx > p.x1) p.x1 = nx
        if (ny < p.y0) p.y0 = ny
        if (ny > p.y1) p.y1 = ny
      }
    }
    const w = p.x1 - p.x0 + 1
    const h = p.y1 - p.y0 + 1
    if (w > 2 && h > 2 && w < W / 2 && h < H / 2) {
      const rowLo = new Int32Array(h).fill(w)
      const rowHi = new Int32Array(h).fill(-1)
      const colLo = new Int32Array(w).fill(h)
      const colHi = new Int32Array(w).fill(-1)
      for (let k = 0; k < tail; k++) {
        const x = (queue[k] % W) - p.x0
        const y = Math.floor(queue[k] / W) - p.y0
        if (x < rowLo[y]) rowLo[y] = x
        if (x > rowHi[y]) rowHi[y] = x
        if (y < colLo[x]) colLo[x] = y
        if (y > colHi[x]) colHi[x] = y
      }
      let rows = 0
      let cols = 0
      for (let y = 0; y < h; y++) if (rowHi[y] >= 0) rows += rowHi[y] - rowLo[y] + 1
      for (let x = 0; x < w; x++) if (colHi[x] >= 0) cols += colHi[x] - colLo[x] + 1
      p.solid = Math.min(rows, cols) / (w * h)
      out.push(p)
    }
  }
  return out
}

/** `trace` receives each filtering stage (full-resolution rects), for tests and debugging. */
export function findSwatchesByColour(img: Raster, rec: Recognition, trace?: (stage: string, rects: { x: number; y: number; w: number; h: number }[]) => void): LegendSwatch[] {
  const { grid, cells } = rec
  const per = (grid.perX + grid.perY) / 2
  const f = Math.max(1, per / WORK_CELL)
  const small = f > 1 ? reduce(img, f) : img
  const cell = per / f
  const board = {
    x0: Math.floor((grid.offX + cells.c0 * grid.perX) / f),
    y0: Math.floor((grid.offY + cells.r0 * grid.perY) / f),
    x1: Math.ceil((grid.offX + (cells.c0 + cells.cols) * grid.perX) / f),
    y1: Math.ceil((grid.offY + (cells.r0 + cells.rows) * grid.perY) / f),
  }
  const colours = clusterByFill(cells.fill)
  const boardColours: Rgb[] = []
  colours.count.forEach((_, k) => boardColours.push({ r: colours.centre[k * 3], g: colours.centre[k * 3 + 1], b: colours.centre[k * 3 + 2] }))

  // swatch-shaped: at least a third of a cell across, at most a dozen (some legends print big tiles), roughly compact, a solid outline
  // (a printed code inside only leaves holes)
  const shaped = patches(small, board).filter((p) => {
    const w = p.x1 - p.x0 + 1
    const h = p.y1 - p.y0 + 1
    return w >= cell * 0.35 && h >= cell * 0.35 && w <= cell * 12 && h <= cell * 12 && w / h < 3.5 && h / w < 3.5 && p.solid >= 0.8 && p.n / (w * h) >= 0.3
  })
  // the rulers printed along the board's edges (row and column numbers) sit within a cell of it
  const ruler = (p: Patch) => {
    const across = (a0: number, a1: number, b0: number, b1: number) => a0 >= b0 - cell * 0.5 && a1 <= b1 + cell * 0.5
    const strip = (lo: number, hi: number, edge: number, outward: 1 | -1) => (outward > 0 ? lo >= edge - 2 && hi <= edge + cell * 1.5 : hi <= edge + 2 && lo >= edge - cell * 1.5)
    return (
      (across(p.x0, p.x1, board.x0, board.x1) && (strip(p.y0, p.y1, board.y1, 1) || strip(p.y0, p.y1, board.y0, -1))) ||
      (across(p.y0, p.y1, board.y0, board.y1) && (strip(p.x0, p.x1, board.x1, 1) || strip(p.x0, p.x1, board.x0, -1)))
    )
  }
  const matched = shaped.filter((p) => !ruler(p) && boardColours.some((c) => dist(p, c) < MATCH))
  if (!matched.length) return []

  const area = (p: Patch) => (p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1)
  // Page furniture (count boxes, ruler cells, text in one ink) repeats one exact colour at one
  // size; swatches of look-alike codes still differ by more than a few levels. Width and height
  // are compared apart: a white code box beside a white count box can be close in area alone.
  const span = (p: Patch) => [p.x1 - p.x0 + 1, p.y1 - p.y0 + 1]
  const near = (a: number, b: number) => Math.abs(a - b) < SAME_SIZE * a
  const same = (p: Patch, q: Patch) => dist(p, q) < SAME && near(span(p)[0], span(q)[0]) && near(span(p)[1], span(q)[1])
  const unique = matched.filter((p) => matched.filter((q) => same(p, q)).length < 3)
  if (!unique.length) return []

  // one size for all swatches of a legend: drop patches far from the typical size
  const typical = unique.map(area).sort((a, b) => a - b)[unique.length >> 1]
  const sized = unique.filter((p) => area(p) > typical * 0.4 && area(p) < typical * 2.5)

  if (trace) {
    const full = (ps: Patch[]) => ps.map((p) => ({ x: p.x0 * f, y: p.y0 * f, w: (p.x1 - p.x0 + 1) * f, h: (p.y1 - p.y0 + 1) * f }))
    trace('shaped', full(shaped))
    trace('matched', full(matched))
    trace('unique', full(unique))
    trace('sized', full(sized))
  }
  // reading order: rows by centre height, then left to right
  const rows: Patch[][] = []
  for (const p of [...sized].sort((a, b) => a.y0 + a.y1 - b.y0 - b.y1)) {
    const row = rows.find((r) => Math.abs(r[0].y0 + r[0].y1 - p.y0 - p.y1) / 2 < (r[0].y1 - r[0].y0 + 1) * 0.5)
    if (row) row.push(p)
    else rows.push([p])
  }
  return rows.flatMap((row) =>
    row
      .sort((a, b) => a.x0 - b.x0)
      .map((p) => {
        const rect = { x: Math.round(p.x0 * f), y: Math.round(p.y0 * f), w: Math.round((p.x1 - p.x0 + 1) * f), h: Math.round((p.y1 - p.y0 + 1) * f) }
        return { rect, sampleRect: rect, colour: { r: p.r, g: p.g, b: p.b }, fillShare: p.n / area(p) }
      }),
  )
}
