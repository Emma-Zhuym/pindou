// Naming the legend swatches found by legendSwatches.ts. Three kinds of evidence per swatch:
//   - the labels printed in the board cells of that colour, stacked (same reader as recognise)
//   - the label printed on the swatch itself
//   - how close the swatch colour is to each code's catalogue colour
// Many legends list their codes in code order; when the unordered reading already mostly
// ascends, the order is enforced to settle look-alike codes.
import { INK, stack } from './cells'
import { CATALOGUE, CODES, fitLabels, makeReader, type Rgb, type TextRenderer } from './glyphs'
import type { Raster } from './grid'
import type { LegendSwatch } from './legendSwatches'
import type { Recognition } from './recognize'

export interface SwatchName {
  code: string
  /** best few codes for this swatch, `code` first: what the confirmation sheet offers */
  options: string[]
  /** false when another code scored about as well: worth a look */
  sure: boolean
}

export interface LegendNaming {
  names: SwatchName[]
  /** the legend lists its codes in code order (A1, A2 … H7), so order was used */
  ordered: boolean
  /** swatch index per board cell (-1 for empty cells or colours no swatch is near) */
  swatchOf: Int16Array
}

// weights fitted on three charts only (tree, dog, landscape); revisit with more charts
/** Catalogue distance that costs one unit of label score. Labels the font fit explains well
 *  (Arial-like, fit >= 0.95) outrank colour; pixel fonts (fit <= 0.90) lean on colour. */
const colourScale = (fit: number) => 250 * 6 ** Math.min(1, Math.max(0, (fit - 0.9) / 0.05))
const SWATCH_LABEL_WEIGHT = 0.25
const SPECIAL_SERIES = 0.3 // pearl, glow, transparent … rarely in a chart
const ORDER_SHARE = 0.75 // share of ascending neighbours that marks a legend in code order
const MAX_CELL_DIST = 60

const naturalKey = (c: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(c)
  return m ? m[1].charCodeAt(0) * 1000 + (m[1].length > 1 ? 500 : 0) + Number(m[2]) : 0
}
const ORDERED = [...CODES].sort((a, b) => naturalKey(a) - naturalKey(b))
const INDEX = new Map(CODES.map((c, i) => [c, i]))

const dist = (r: number, g: number, b: number, c: Rgb) => Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)

/** Each board cell goes to the swatch nearest its fill colour. */
export function cellsBySwatch(rec: Recognition, swatches: LegendSwatch[]): Int16Array {
  const { fill } = rec.cells
  const out = new Int16Array(rec.assign.length).fill(-1)
  for (let i = 0; i < out.length; i++) {
    if (rec.empty[i]) continue
    let best = -1
    let bd = Infinity
    swatches.forEach((s, k) => {
      const d = dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], s.colour)
      if (d < bd) {
        bd = d
        best = k
      }
    })
    if (bd < MAX_CELL_DIST) out[i] = best
  }
  return out
}

/** The swatch's own label as an INK x INK ink map: a square window on the coloured part,
 *  ink measured against the swatch colour, nothing outside the coloured part. */
function swatchInk(img: Raster, s: LegendSwatch): Float32Array {
  const r = s.sampleRect
  const side = Math.max(r.w, r.h)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const pad = Math.max(1, Math.round(Math.min(r.w, r.h) * 0.1))
  const { width: W, height: H, data } = img
  const px = (x: number, y: number, ch: number) => data[(Math.min(H - 1, y) * W + Math.min(W - 1, x)) * 4 + ch]
  const ref = [s.colour.r, s.colour.g, s.colour.b]
  const out = new Float32Array(INK * INK)
  for (let v = 0; v < INK; v++) {
    for (let u = 0; u < INK; u++) {
      const x = cx - side / 2 + ((u + 0.5) * side) / INK
      const y = cy - side / 2 + ((v + 0.5) * side) / INK
      if (x < r.x + pad || x > r.x + r.w - pad || y < r.y + pad || y > r.y + r.h - pad) continue
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const fx = x - xi
      const fy = y - yi
      let d = 0
      for (let ch = 0; ch < 3; ch++) {
        const val = px(xi, yi, ch) * (1 - fx) * (1 - fy) + px(xi + 1, yi, ch) * fx * (1 - fy) + px(xi, yi + 1, ch) * (1 - fx) * fy + px(xi + 1, yi + 1, ch) * fx * fy
        d += Math.abs(val - ref[ch])
      }
      out[v * INK + u] = Math.min(1, d / 255)
    }
  }
  return out
}

export function nameSwatches(img: Raster, rec: Recognition, swatches: LegendSwatch[], render: TextRenderer): LegendNaming {
  const N = swatches.length
  const swatchOf = cellsBySwatch(rec, swatches)
  if (!N) return { names: [], ordered: false, swatchOf }

  const members: number[][] = swatches.map(() => [])
  swatchOf.forEach((k, i) => {
    if (k >= 0) members[k].push(i)
  })
  const cellReader = makeReader(render, rec.fit)
  const inks = swatches.map((s) => swatchInk(img, s))
  const swatchReader = makeReader(render, fitLabels(render, inks))

  const scale = colourScale(rec.fit.score)
  // score[i][j]: swatch i read as ORDERED[j]
  const score = swatches.map((s, i) => {
    const fromCells = members[i].length ? cellReader.all(stack(rec.cells, members[i].slice(0, 400)), true) : null
    const fromSwatch = swatchReader.all(inks[i], true)
    return ORDERED.map((code) => {
      const c = INDEX.get(code)!
      const label = (fromCells ? fromCells[c] : 0) + SWATCH_LABEL_WEIGHT * (Number.isFinite(fromSwatch[c]) ? fromSwatch[c] : 0)
      const special = /^[A-HM]\d/.test(code) ? 0 : SPECIAL_SERIES
      return label - dist(s.colour.r, s.colour.g, s.colour.b, CATALOGUE[code]) / scale - special
    })
  })

  // unordered: best code per swatch, each code used once (greedy, most certain swatch first)
  const free = new Array<number>(N).fill(-1)
  const taken = new Set<number>()
  const byStrength = score.map((row, i) => ({ i, top: Math.max(...row) })).sort((a, b) => b.top - a.top)
  for (const { i } of byStrength) {
    let best = -1
    score[i].forEach((v, j) => {
      if (!taken.has(j) && (best < 0 || v > score[i][best])) best = j
    })
    free[i] = best
    taken.add(best)
  }

  // ordered: strictly increasing codes along the legend, best total score
  const M = ORDERED.length
  const total = score.map(() => new Float64Array(M))
  const back = score.map(() => new Int32Array(M).fill(-1))
  total[0].set(score[0])
  for (let i = 1; i < N; i++) {
    let run = -Infinity
    let runAt = -1
    total[i].fill(-Infinity)
    for (let j = 1; j < M; j++) {
      if (total[i - 1][j - 1] > run) {
        run = total[i - 1][j - 1]
        runAt = j - 1
      }
      total[i][j] = run + score[i][j]
      back[i][j] = runAt
    }
  }
  const ordered = new Array<number>(N)
  let j = total[N - 1].indexOf(Math.max(...total[N - 1]))
  for (let i = N - 1; i >= 0; i--) {
    ordered[i] = j
    j = back[i][j]
  }

  // A legend in code order shows through even in the unordered reading: most neighbours already
  // ascend. Legends sorted by count (dog) ascend about half the time.
  let ascending = 0
  for (let i = 1; i < N; i++) if (free[i] > free[i - 1]) ascending++
  const useOrder = N >= 3 && ordered.every((j) => j >= 0) && ascending / (N - 1) >= ORDER_SHARE
  const pick = useOrder ? ordered : free

  const names = pick.map((j, i) => {
    const row = score[i]
    const others = row.map((v, q) => ({ v, q })).filter((o) => o.q !== j).sort((a, b) => b.v - a.v)
    const margin = row[j] - others[0].v
    // in an ordered legend the order may rightly overrule a slightly better-looking code
    const sure = useOrder ? margin > -0.05 : margin > 0.05
    return { code: ORDERED[j], options: [ORDERED[j], ...others.slice(0, 3).map((o) => ORDERED[o.q])], sure }
  })
  return { names, ordered: useOrder, swatchOf }
}
