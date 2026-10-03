// Naming the legend swatches found by legendSwatches.ts. Three kinds of evidence per swatch:
//   - the labels printed in the board cells of that colour, stacked (same reader as recognise)
//   - the label printed on the swatch itself
//   - how close the swatch colour is to each code's catalogue colour
// Many legends list their codes in code order (by number, A4 before A15, or as text, A15 before
// A4); when the unordered reading already mostly ascends, the order is enforced to settle
// look-alike codes.
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
  /** the swatches named (some found ones may be dropped as not swatches); names follow this list */
  swatches: LegendSwatch[]
  /** swatch index per board cell (-1 for empty cells or colours no swatch is near) */
  swatchOf: Int16Array
}

// weights fitted on three charts only (tree, dog, landscape); revisit with more charts
/** Catalogue distance that costs one unit of label score. Labels the font fit explains well
 *  (Arial-like, fit >= 0.95) outrank colour; pixel fonts (fit <= 0.90) lean on colour. */
const colourScale = (fit: number) => 250 * 6 ** Math.min(1, Math.max(0, (fit - 0.9) / 0.05))
const SWATCH_LABEL_WEIGHT = 0.25
const BESIDE_LABEL_WEIGHT = 3
const BESIDE_MIN_READ = 0.65 // a word beside a real swatch reads at 0.8 or so
const SPECIAL_SERIES = 0.3 // pearl, glow, transparent … rarely in a chart
const ORDER_SHARE = 0.75 // share of ascending neighbours that marks a legend in code order
const MAX_CELL_DIST = 60

const naturalKey = (c: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(c)
  return m ? m[1].charCodeAt(0) * 1000 + (m[1].length > 1 ? 500 : 0) + Number(m[2]) : 0
}
const ORDERED = [...CODES].sort((a, b) => naturalKey(a) - naturalKey(b))
const INDEX = new Map(CODES.map((c, i) => [c, i]))
// position of each ORDERED code when a legend sorts by number, or as plain text
const BY_NUMBER = Int32Array.from(ORDERED.keys())
const BY_TEXT = (() => {
  const text = [...ORDERED.keys()].sort((x, y) => (ORDERED[x] < ORDERED[y] ? -1 : 1))
  const r = new Int32Array(ORDERED.length)
  text.forEach((k, pos) => (r[k] = pos))
  return r
})()

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

/**
 * The code printed BESIDE a swatch ("B1: 90"): the first word of the text that starts right of the
 * swatch, without a trailing colon, as an INK x INK ink map against the page colour. Null when no
 * text starts close to the swatch or the first word is not label-shaped.
 */
function besideInk(img: Raster, s: LegendSwatch, all: LegendSwatch[]): Float32Array | null {
  const { width: W, height: H, data } = img
  const r = s.rect
  const x0 = Math.min(W - 1, Math.round(r.x + r.w + 1))
  // up to the next swatch on the row: its own printed code is not this one's
  let x1 = Math.min(W, Math.round(r.x + r.w + 8 * r.h))
  for (const o of all) {
    const overlap = Math.min(o.rect.y + o.rect.h, r.y + r.h) - Math.max(o.rect.y, r.y)
    if (o !== s && overlap > 0.5 * r.h && o.rect.x > r.x + r.w / 2) x1 = Math.min(x1, Math.round(o.rect.x))
  }
  const y0 = Math.max(0, Math.round(r.y - 0.25 * r.h))
  const y1 = Math.min(H, Math.round(r.y + 1.25 * r.h))
  if (x1 - x0 < 4 || y1 - y0 < 4) return null
  const w = x1 - x0
  const h = y1 - y0
  // page colour: the commonest of a coarse sample of the region
  const tally = new Map<number, number>()
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
  }
  const top = [...tally].sort((a, b) => b[1] - a[1])[0][0]
  const page = { r: ((top >> 8) << 4) + 8, g: (((top >> 4) & 15) << 4) + 8, b: ((top & 15) << 4) + 8 }
  const ink = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * W + x0 + x) * 4
      ink[y * w + x] = Math.min(1, dist(data[i], data[i + 1], data[i + 2], page) / 255)
    }
  }
  const on = (x: number, y: number) => ink[y * w + x] > 0.35
  const colOn = (x: number) => {
    for (let y = 0; y < h; y++) if (on(x, y)) return true
    return false
  }
  // the first word: ink columns from the first one until a gap as wide as a space. A frame
  // around the swatch (a thin full-height line) is skipped first.
  let a = 0
  for (;;) {
    while (a < w && !colOn(a)) a++
    let e = a
    while (e < w && colOn(e)) e++
    let tall = 0
    for (let y = 0; y < h; y++) {
      for (let xx = a; xx < e; xx++) {
        if (on(xx, y)) {
          tall++
          break
        }
      }
    }
    if (a < w && e - a <= Math.max(3, 0.15 * r.h) && tall >= 0.8 * r.h) a = e
    else break
  }
  if (a >= w || a > 1.2 * r.h) return null
  const groups: [number, number][] = []
  let x = a
  const space = Math.max(2, 0.3 * r.h)
  while (x < w) {
    let e = x
    while (e < w && colOn(e)) e++
    groups.push([x, e])
    let g = e
    while (g < w && !colOn(g)) g++
    if (g - e >= space || g >= w) break
    x = g
  }
  const rows = (gx0: number, gx1: number) => {
    let lo = h
    let hi = -1
    for (let y = 0; y < h; y++) {
      for (let xx = gx0; xx < gx1; xx++) {
        if (on(xx, y)) {
          lo = Math.min(lo, y)
          hi = Math.max(hi, y)
          break
        }
      }
    }
    return [lo, hi]
  }
  // a trailing colon: a narrow glyph with nothing in the middle of its height
  const last = groups[groups.length - 1]
  if (groups.length > 1) {
    const [lo, hi] = rows(groups[0][0], groups[groups.length - 2][1])
    const mid = [lo + 0.45 * (hi - lo), lo + 0.6 * (hi - lo)]
    let middle = false
    for (let y = Math.round(mid[0]); y <= Math.round(mid[1]); y++) for (let xx = last[0]; xx < last[1]; xx++) if (on(xx, y)) middle = true
    if (last[1] - last[0] < 0.3 * (hi - lo + 1) && !middle) groups.pop()
  }
  const tx0 = groups[0][0]
  const tx1 = groups[groups.length - 1][1]
  const [ty0, ty1] = rows(tx0, tx1)
  const tw = tx1 - tx0
  const th = ty1 - ty0 + 1
  // label-shaped: one to three characters, not taller than the swatch row
  if (th < 4 || th > 1.3 * r.h || tw < 0.6 * th || tw > 4 * th) return null
  // scaled by text height, the same for every swatch, so one font size fits all labels
  const side = Math.max(tw * 1.3, th * 3.6)
  const cx = tx0 + tw / 2
  const cy = ty0 + th / 2
  const out = new Float32Array(INK * INK)
  for (let v = 0; v < INK; v++) {
    for (let u = 0; u < INK; u++) {
      const px = cx - side / 2 + ((u + 0.5) * side) / INK
      const py = cy - side / 2 + ((v + 0.5) * side) / INK
      if (px < tx0 - 1 || px > tx1 + 1 || py < ty0 - 1 || py > ty1 + 1) continue
      const xi = Math.min(w - 1, Math.max(0, Math.round(px)))
      const yi = Math.min(h - 1, Math.max(0, Math.round(py)))
      out[v * INK + u] = ink[yi * w + xi]
    }
  }
  return out
}

export function nameSwatches(img: Raster, rec: Recognition, found: LegendSwatch[], render: TextRenderer): LegendNaming {
  // The code is printed either on the swatch or beside it: read whichever the font fit explains
  // better (beside needs a word next to most swatches).
  let swatches = found
  let inks = swatches.map((s) => swatchInk(img, s))
  let swatchFit = fitLabels(render, inks)
  let swatchWeight = SWATCH_LABEL_WEIGHT
  const beside = swatches.map((s) => besideInk(img, s, swatches))
  if (swatches.length && beside.filter(Boolean).length >= 0.7 * swatches.length) {
    const besideFit = fitLabels(render, beside.filter((b): b is Float32Array => !!b))
    if (besideFit.score > swatchFit.score) {
      // In a legend that prints its codes beside the swatches, a "swatch" with no readable word
      // beside it is something else that happens to be coloured.
      const reader = makeReader(render, besideFit)
      const keep = beside.map((b) => !!b && Math.max(...reader.all(b, true)) >= BESIDE_MIN_READ)
      swatches = swatches.filter((_, i) => keep[i])
      inks = beside.filter((_, i) => keep[i]) as Float32Array[]
      swatchFit = besideFit
      // printed beside the swatch in a plain font: trustworthy, and often all there is
      swatchWeight = BESIDE_LABEL_WEIGHT
    }
  }
  const N = swatches.length
  const swatchOf = cellsBySwatch(rec, swatches)
  if (!N) return { names: [], ordered: false, swatchOf, swatches }
  const members: number[][] = swatches.map(() => [])
  swatchOf.forEach((k, i) => {
    if (k >= 0) members[k].push(i)
  })
  const cellReader = makeReader(render, rec.fit)
  const swatchReader = makeReader(render, swatchFit)

  const scale = colourScale(rec.fit.score)
  // score[i][j]: swatch i read as ORDERED[j]
  const score = swatches.map((s, i) => {
    const fromCells = members[i].length ? cellReader.all(stack(rec.cells, members[i].slice(0, 400)), true) : null
    const fromSwatch = swatchReader.all(inks[i], true)
    return ORDERED.map((code) => {
      const c = INDEX.get(code)!
      const label = (fromCells ? fromCells[c] : 0) + swatchWeight * (Number.isFinite(fromSwatch[c]) ? fromSwatch[c] : 0)
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

  // Ordered: codes strictly increasing along the legend, best total score. Legends sort either
  // by number (A4 before A15) or as text (A15 before A4); `rank` maps ORDERED indices to the
  // position in the order being tried.
  const decode = (rank: Int32Array) => {
    const seq = Array.from(rank.keys()).sort((x, y) => rank[x] - rank[y])
    const M = seq.length
    const total = score.map(() => new Float64Array(M))
    const back = score.map(() => new Int32Array(M).fill(-1))
    for (let q = 0; q < M; q++) total[0][q] = score[0][seq[q]]
    for (let i = 1; i < N; i++) {
      let run = -Infinity
      let runAt = -1
      total[i].fill(-Infinity)
      for (let q = 1; q < M; q++) {
        if (total[i - 1][q - 1] > run) {
          run = total[i - 1][q - 1]
          runAt = q - 1
        }
        total[i][q] = run + score[i][seq[q]]
        back[i][q] = runAt
      }
    }
    const out = new Array<number>(N)
    let q = total[N - 1].indexOf(Math.max(...total[N - 1]))
    for (let i = N - 1; i >= 0; i--) {
      out[i] = q < 0 ? -1 : seq[q]
      q = q < 0 ? -1 : back[i][q]
    }
    return out
  }
  // A legend in code order shows through even in the unordered reading: most neighbours already
  // ascend. Legends sorted by count (dog) ascend about half the time.
  const ascending = (rank: Int32Array) => {
    let n = 0
    for (let i = 1; i < N; i++) if (rank[free[i]] > rank[free[i - 1]]) n++
    return N > 1 ? n / (N - 1) : 0
  }
  const rank = [BY_NUMBER, BY_TEXT].sort((x, y) => ascending(y) - ascending(x))[0]
  const useOrder = N >= 3 && ascending(rank) >= ORDER_SHARE
  const ordered = useOrder ? decode(rank) : free
  const pick = useOrder ? ordered : free

  const names = pick.map((j, i) => {
    const row = score[i]
    const others = row.map((v, q) => ({ v, q })).filter((o) => o.q !== j).sort((a, b) => b.v - a.v)
    const margin = row[j] - others[0].v
    // in an ordered legend the order may rightly overrule a slightly better-looking code
    const sure = useOrder ? margin > -0.05 : margin > 0.05
    return { code: ORDERED[j], options: [ORDERED[j], ...others.slice(0, 3).map((o) => ORDERED[o.q])], sure }
  })
  return { names, ordered: useOrder, swatchOf, swatches }
}
