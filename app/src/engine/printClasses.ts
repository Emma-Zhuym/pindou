// Cells sorted by what is printed in them, not only by colour. Two codes of near the same colour
// (C23 and H19, G11 and G12) differ in their print; one code's cells all print alike. A class is a
// set of cells of one colour and one print: colour first, then each colour split by print while
// the halves are clearly apart. Classes come out purer than any colour grouping (well under 1% of
// cells in the wrong class on the test charts), at the price of a code taking a few classes.
import { type Cells, clusterByFill, INK } from './cells'
import { CATALOGUE, type Rgb } from './glyphs'

/** side of a print feature */
const SIDE = 24
/** ink this close to the cell edge is grid line or an edge mark (every 5th line in red), not print */
const MARGIN = 7
/** colours this close are one colour before the print splits them */
const COLOUR = 26
/** halves of a class this far apart (Fisher ratio along their difference) are two prints */
const APART = 16
/** neither half of a split may be smaller than this */
const MIN_HALF = 3

export interface PrintClass {
  /** the cells, by cell index, the most typical of the class first */
  cells: number[]
  colour: Rgb
  /** mean print, unit length (SIDE*SIDE) */
  print: Float32Array
}

/** Print features: the ink inside the margin, centred on its own centre of mass, resampled to
 *  SIDE x SIDE, mean removed, unit length. One row per cell given. */
export function printFeatures(cells: Cells, which: number[]): Float32Array {
  const D = SIDE * SIDE
  const out = new Float32Array(which.length * D)
  const W = INK - 2 * MARGIN
  const vals = new Float32Array(W * W)
  which.forEach((i, k) => {
    const b = i * INK * INK
    // the print's centre: mass of the ink above the cell's own median
    let n = 0
    for (let y = MARGIN; y < INK - MARGIN; y++) for (let x = MARGIN; x < INK - MARGIN; x++) vals[n++] = cells.ink[b + y * INK + x]
    const floor = Float32Array.from(vals).sort()[n >> 1]
    let m = 0
    let mx = 0
    let my = 0
    for (let y = MARGIN; y < INK - MARGIN; y++)
      for (let x = MARGIN; x < INK - MARGIN; x++) {
        const v = Math.max(0, cells.ink[b + y * INK + x] - floor)
        m += v
        mx += v * x
        my += v * y
      }
    const cx = m ? mx / m : INK / 2
    const cy = m ? my / m : INK / 2
    const at = (x: number, y: number) => (x < MARGIN || y < MARGIN || x >= INK - MARGIN || y >= INK - MARGIN ? floor : cells.ink[b + y * INK + x])
    const o = k * D
    for (let v = 0; v < SIDE; v++)
      for (let u = 0; u < SIDE; u++) {
        const sx = cx - W / 2 + ((u + 0.5) * W) / SIDE - 0.5
        const sy = cy - W / 2 + ((v + 0.5) * W) / SIDE - 0.5
        const xi = Math.floor(sx)
        const yi = Math.floor(sy)
        const fx = sx - xi
        const fy = sy - yi
        out[o + v * SIDE + u] = (at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx) * (1 - fy) + (at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx) * fy
      }
    unitRow(out, o, D)
  })
  return out
}

function unitRow(x: Float32Array, o: number, D: number) {
  let mean = 0
  for (let j = 0; j < D; j++) mean += x[o + j]
  mean /= D
  let norm = 0
  for (let j = 0; j < D; j++) {
    x[o + j] -= mean
    norm += x[o + j] * x[o + j]
  }
  norm = Math.sqrt(norm) + 1e-6
  for (let j = 0; j < D; j++) x[o + j] /= norm
}

const dot = (X: Float32Array, j: number, v: Float32Array, D: number) => {
  let s = 0
  for (let d = 0; d < D; d++) s += X[j * D + d] * v[d]
  return s
}

const meanOf = (X: Float32Array, rows: number[], D: number) => {
  const m = new Float32Array(D)
  for (const j of rows) for (let d = 0; d < D; d++) m[d] += X[j * D + d]
  for (let d = 0; d < D; d++) m[d] /= Math.max(1, rows.length)
  return m
}

/** Halve the rows by print (2-means from the two most different) while the halves are clearly
 *  apart: one print's noise spreads around one mean, two prints sit on either side. */
function splitByPrint(X: Float32Array, D: number, rows: number[]): number[][] {
  if (rows.length < 2 * MIN_HALF) return [rows]
  const mean = meanOf(X, rows, D)
  let a = rows[0]
  let lo = Infinity
  for (const j of rows) {
    const s = dot(X, j, mean, D)
    if (s < lo) {
      lo = s
      a = j
    }
  }
  let ca = X.slice(a * D, a * D + D)
  let b = rows[0]
  lo = Infinity
  for (const j of rows) {
    const s = dot(X, j, ca, D)
    if (s < lo) {
      lo = s
      b = j
    }
  }
  let cb = X.slice(b * D, b * D + D)
  let A: number[] = []
  let B: number[] = []
  for (let it = 0; it < 10; it++) {
    A = []
    B = []
    for (const j of rows) (dot(X, j, ca, D) >= dot(X, j, cb, D) ? A : B).push(j)
    if (!A.length || !B.length) return [rows]
    ca = meanOf(X, A, D)
    cb = meanOf(X, B, D)
  }
  if (A.length < MIN_HALF || B.length < MIN_HALF) return [rows]
  const diff = new Float32Array(D)
  let q = 0
  for (let d = 0; d < D; d++) {
    diff[d] = ca[d] - cb[d]
    q += diff[d] * diff[d]
  }
  q = Math.sqrt(q) + 1e-9
  const spread = (side: number[]) => {
    const p = side.map((j) => dot(X, j, diff, D) / q)
    const m = p.reduce((x, y) => x + y, 0) / p.length
    return { m, v: p.reduce((x, y) => x + (y - m) ** 2, 0) / p.length }
  }
  const pa = spread(A)
  const pb = spread(B)
  if ((pa.m - pb.m) ** 2 / (pa.v + pb.v + 1e-9) < APART) return [rows]
  return [...splitByPrint(X, D, A), ...splitByPrint(X, D, B)]
}

/** The given cells (beads with print in them) in classes of one colour and one print. */
export function printClasses(cells: Cells, beads: number[]): PrintClass[] {
  const D = SIDE * SIDE
  const X = printFeatures(cells, beads)
  const fill = new Float32Array(beads.length * 3)
  beads.forEach((i, j) => fill.set(cells.fill.subarray(i * 3, i * 3 + 3), j * 3))
  const byColour = clusterByFill(fill, COLOUR)
  const rows: number[][] = byColour.count.map(() => [])
  beads.forEach((_, j) => rows[byColour.label[j]].push(j))
  return rows.flatMap((r) => splitByPrint(X, D, r)).map((r) => {
    const print = meanOf(X, r, D)
    let q = 0
    for (const v of print) q += v * v
    q = Math.sqrt(q) + 1e-9
    for (let d = 0; d < D; d++) print[d] /= q
    const colour = { r: 0, g: 0, b: 0 }
    for (const j of r) {
      colour.r += fill[j * 3] / r.length
      colour.g += fill[j * 3 + 1] / r.length
      colour.b += fill[j * 3 + 2] / r.length
    }
    const like = new Map(r.map((j) => [j, dot(X, j, print, D)]))
    const typical = [...r].sort((a, b) => like.get(b)! - like.get(a)!)
    return { cells: typical.map((j) => beads[j]), colour, print }
  })
}

/** a cell moved away from the name it had costs this much (in cells of count mismatch): a change
 *  of name needs the counts to say so clearly */
const INERTIA = 0.6
/** a class unlike the rest of its code's print, per cell, in cells of count mismatch */
const PRINT_WEIGHT = 2
/** codes whose colours are further apart than this never trade cells */
const TRADE_COLOUR = 150
/** Some charts draw each code in its catalogue colour, some in their own shades (often nearer
 *  another code's catalogue colour than their own). A chart whose classes mostly sit this close
 *  to a catalogue colour of its list draws catalogue colours, and colour weighs fully. */
const FAITHFUL = 12
/** elsewhere, only a class this far from a code's catalogue colour counts against it (charts
 *  shade codes their own way, but not into another colour family) */
const STRAY = 90
/** colour distance worth one cell of count mismatch, per cell */
const COLOUR_SCALE = 30
/** beyond this, colour says no more: a watermark tints a class far off any colour, and only its
 *  print can tell which code it is */
const COLOUR_CAP = 60
/** codes this close in the chart's own colours can be mistaken for each other */
const LOOK_ALIKE = 60

const colourDist = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

export interface ClassNames {
  /** code index per class; -1: not a bead (the page under a pattern, a ruler's numbers) */
  code: number[]
  /** per class: another code would fit it nearly as well */
  doubt: boolean[]
}

/**
 * The codes of the classes. Each class starts with the code most of its cells were given (by colour
 * and printed counts, legendRead.ts). With printed counts, a class then takes another code, or two
 * codes trade all their classes, wherever that brings the counts closer to the printed ones, by
 * more than the cells moved (INERTIA), with the classes of a code printing alike. Colour does not
 * judge between codes here: charts draw codes in their own shades, often nearer another code's
 * catalogue colour than their own. `fixed`: cells per code outside any class.
 */
export function nameClasses(classes: PrintClass[], codes: string[], given: number[], want: (number | undefined)[], colours: Rgb[], fixed: number[]): ClassNames {
  const K = want.length
  const C = classes.length
  const D = SIDE * SIDE
  const size = classes.map((c) => c.cells.length)
  // how alike every two classes print
  const G = new Float32Array(C * C)
  for (let a = 0; a < C; a++)
    for (let b = a; b < C; b++) {
      let s = 0
      for (let d = 0; d < D; d++) s += classes[a].print[d] * classes[b].print[d]
      G[a * C + b] = s
      G[b * C + a] = s
    }
  // how far each class is from each code's catalogue colour, as far as the chart's colours can be trusted
  const known = codes.map((c) => CATALOGUE[c])
  const nearestKnown = classes.map((c) => Math.min(...known.filter(Boolean).map((k) => colourDist(c.colour, k))))
  const faithful = weightedMedian(nearestKnown, size) <= FAITHFUL
  const stray = classes.map((c) =>
    known.map((k) => {
      if (!k) return 0
      const d = colourDist(c.colour, k)
      return (c.cells.length * (faithful ? Math.min(d, COLOUR_CAP) : Math.max(0, d - STRAY))) / COLOUR_SCALE
    }),
  )
  // one code's share of the cost: its count off the printed one, its classes off its print (the
  // size-weighted mean of their prints) and off its colour, and (with `moved`) its cells moved
  // from the name they were given
  const codeCost = (k: number, members: number[], moved = true) => {
    // not a bead: no count printed for it, no print of its own; only the cells moved there count
    if (k === EMPTY) return moved ? members.reduce((t, j) => t + size[j] * INERTIA, 0) : 0
    let n = fixed[k]
    for (const j of members) n += size[j]
    let total = want[k] === undefined ? 0 : Math.abs(n - want[k]!)
    if (!members.length) return total
    let norm = 0
    for (const a of members) for (const b of members) norm += size[a] * size[b] * G[a * C + b]
    norm = Math.sqrt(Math.max(norm, 1e-9))
    for (const j of members) {
      let s = 0
      for (const i of members) s += size[i] * G[j * C + i]
      total += size[j] * (1 - s / norm) * PRINT_WEIGHT + stray[j][k]
      if (moved && given[j] !== k) total += size[j] * INERTIA
    }
    return total
  }
  const EMPTY = K
  // how like print each class is: its best likeness to a class first named another code
  const textLike = classes.map((_, j) => {
    let best = -1
    for (let i = 0; i < C; i++) if (given[i] !== given[j]) best = Math.max(best, G[j * C + i])
    return best
  })
  const code = [...given]
  const members = Array.from({ length: K + 1 }, (_, k) => code.flatMap((c, j) => (c === k ? [j] : [])))
  const costs = members.map((m, k) => codeCost(k, m))
  // what moving these classes to `to` would change
  const moveDelta = (js: number[], to: number) => {
    const from = new Set(js.map((j) => code[j]))
    let delta = 0
    const after = new Map<number, number[]>()
    for (const k of [...from, to]) after.set(k, members[k].filter((j) => !js.includes(j)))
    after.get(to)!.push(...js)
    for (const [k, m] of after) delta += codeCost(k, m) - costs[k]
    return { delta, after }
  }
  const apply = (after: Map<number, number[]>) => {
    for (const [k, m] of after) {
      members[k] = m
      costs[k] = codeCost(k, m)
      for (const j of m) code[j] = k
    }
  }
  if (want.some((n) => n !== undefined)) {
    for (let pass = 0; pass < 6; pass++) {
      let improved = false
      // two codes trading all their classes
      for (let a = 0; a < K; a++)
        for (let b = a + 1; b < K; b++) {
          if (colourDist(colours[a], colours[b]) > TRADE_COLOUR) continue
          const ma = members[a]
          const mb = members[b]
          const delta = codeCost(a, mb) + codeCost(b, ma) - costs[a] - costs[b]
          if (delta < -1e-6) {
            apply(new Map([[a, mb], [b, ma]]))
            improved = true
          }
        }
      // one class taking another code
      for (let j = 0; j < C; j++)
        for (let k = 0; k < K; k++) {
          if (k === code[j] || colourDist(classes[j].colour, colours[k]) > TRADE_COLOUR) continue
          const { delta, after } = moveDelta([j], k)
          if (delta < -1e-6) {
            apply(after)
            improved = true
          }
        }
      // A class not a bead at all: its code has at least that many cells more than the legend
      // prints (a patterned page, a ruler, counted as beads). Only with every count printed, and
      // only when the count says so: a class merely unlike its code's print stays a bead. Which of
      // the code's classes it is: the one least like print, clearly less than its code's others
      // (codes print in one font, alike; a pattern is like none of them).
      if (want.every((n) => n !== undefined)) {
        for (let k = 0; k < K; k++) {
          const order = [...members[k]].sort((a, b) => textLike[a] - textLike[b])
          const j = order[0]
          if (j === undefined) continue
          const others = order.slice(1)
          if (others.length && textLike[j] + LESS_LIKE > Math.max(...others.map((i) => textLike[i]))) continue
          const n = fixed[k] + members[k].reduce((t, i) => t + size[i], 0)
          const extra = Math.abs(n - want[k]!) - Math.abs(n - size[j] - want[k]!)
          if (extra < NOT_BEAD * size[j]) continue
          const { delta, after } = moveDelta([j], EMPTY)
          if (delta < -1e-6) {
            apply(after)
            improved = true
          }
        }
      }
      if (!improved) break
    }
  }
  // A class is in doubt when another code would fit it nearly as well, or its code and another
  // nearly as well trading all their classes, the reluctance to move set aside: that is how
  // much the evidence itself prefers the names.
  const plain = members.map((m, k) => codeCost(k, m, false))
  const doubt = code.map(() => false)
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++) {
      if (colourDist(colours[a], colours[b]) > LOOK_ALIKE || (!members[a].length && !members[b].length)) continue
      const cells = [...members[a], ...members[b]].reduce((n, j) => n + size[j], 0)
      if (codeCost(a, members[b], false) + codeCost(b, members[a], false) - plain[a] - plain[b] < DOUBT_TRADE * cells) for (const j of [...members[a], ...members[b]]) doubt[j] = true
    }
  code.forEach((k, j) => {
    if (doubt[j] || k === EMPTY) return
    for (let o = 0; o < K; o++) {
      if (o === k || colourDist(classes[j].colour, colours[o]) > LOOK_ALIKE) continue
      const without = members[k].filter((i) => i !== j)
      const delta = codeCost(k, without, false) + codeCost(o, [...members[o], j], false) - plain[k] - plain[o]
      if (delta < DOUBT * size[j]) {
        doubt[j] = true
        return
      }
    }
  })
  return { code: code.map((k) => (k === EMPTY ? -1 : k)), doubt }
}
/** a class is taken for no bead when its code's count is over by at least this share of it */
const NOT_BEAD = 0.8
/** ...and it is at least this much less like print than its code's other classes */
const LESS_LIKE = 0.15
/** another code costing less than this much more per cell leaves a class in doubt */
const DOUBT = 0.3
/** two codes trading all their cells for less than this much more per cell leaves both in doubt.
 *  Codes of look-alike colours and close counts (132 and 135) are often named right by colour and
 *  the legend's swatches yet trade cheaply, so only near-ties count; the review shows each code's
 *  stacked print, and the model reads every class, which settle the rest. */
const DOUBT_TRADE = 0.05

function weightedMedian(values: number[], weights: number[]): number {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  for (const i of order) {
    acc += weights[i]
    if (acc >= total / 2) return values[i]
  }
  return Infinity
}
