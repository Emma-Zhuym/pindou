// Finding the grid: cell pitch, line phase, and which part of the image is gridded.
// Ported from research/engine.py; see docs/notes.md for why each rule exists.

export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array // RGBA
}

export interface Grid {
  perX: number
  offX: number
  perY: number
  offY: number
}

export interface Extent {
  r0: number
  c0: number
  rows: number
  cols: number
}

function percentile(values: Float64Array | number[], p: number): number {
  const s = Float64Array.from(values).sort()
  if (!s.length) return 0
  const k = (p / 100) * (s.length - 1)
  const lo = Math.floor(k)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (k - lo)
}

/** Edge strength per column (axis 0) or per row (axis 1), median removed, top 1% clipped so that
 *  thick every-5th lines do not outvote thin ones. */
function profile(img: Raster, axis: 0 | 1): Float64Array {
  const { width: W, height: H, data } = img
  const n = axis === 0 ? W - 1 : H - 1
  const p = new Float64Array(n)
  if (axis === 0) {
    for (let y = 0; y < H; y++) {
      let i = y * W * 4
      for (let x = 0; x < W - 1; x++, i += 4) {
        p[x] += Math.abs(data[i + 4] - data[i]) + Math.abs(data[i + 5] - data[i + 1]) + Math.abs(data[i + 6] - data[i + 2])
      }
    }
  } else {
    const row = W * 4
    for (let y = 0; y < H - 1; y++) {
      let i = y * row
      let s = 0
      for (let x = 0; x < W; x++, i += 4) {
        s += Math.abs(data[i + row] - data[i]) + Math.abs(data[i + row + 1] - data[i + 1]) + Math.abs(data[i + row + 2] - data[i + 2])
      }
      p[y] = s
    }
  }
  const med = percentile(p, 50)
  for (let i = 0; i < n; i++) p[i] -= med
  const cap = percentile(p, 99)
  for (let i = 0; i < n; i++) p[i] = Math.min(Math.max(p[i], 0), cap)
  return p
}

function lineValues(p: Float64Array, per: number, off: number): number[] {
  const out: number[] = []
  const count = Math.floor((p.length - off) / per)
  for (let k = 0; k < count; k++) {
    const i = Math.round(off + k * per)
    if (i >= 0 && i < p.length) out.push(p[i])
  }
  return out
}

function mean(v: number[]): number {
  let s = 0
  for (const x of v) s += x
  return v.length ? s / v.length : 0
}

/**
 * A real pitch has a line at (almost) every predicted position, so candidates are judged by the
 * weak end of their line strengths: half the true pitch lands on label text every other step and
 * fails, multiples of the true pitch pass, and the smallest passing pitch is the cell size.
 */
export function findGrid(img: Raster, lo = 7, hi = 45): Grid {
  // The pitch search covers 7-45px cells. Larger images (originals fetched from a link can have
  // 40-60px cells) are searched on a reduced copy, and only the fine fit runs at full size.
  const longSide = Math.max(img.width, img.height)
  if (longSide > 1800) {
    const f = longSide / 1500
    const coarse = findGrid(reduce(img, f), lo, hi)
    const px = profile(img, 0)
    const py = profile(img, 1)
    const estimate = (coarse.perX + coarse.perY) / 2 * f
    // Reduction can erase fine lines or push the true pitch below `lo`. Treat the
    // reduced result as a candidate: divisors must be checked on ORIGINAL pixels.
    const candidates = []
    // Fine-fit error may put an exact `lo`-pixel grid just below the search bound.
    const minCandidate = lo - Math.max(0.08, lo * 0.0025)
    for (let divisor = 1; estimate / divisor >= minCandidate; divisor++) {
      const grid = refine(px, py, estimate / divisor)
      candidates.push({ grid, x: support(px, grid.perX), y: support(py, grid.perY) })
    }
    const maxX = Math.max(...candidates.map(c => c.x))
    const maxY = Math.max(...candidates.map(c => c.y))
    // Both axes need lines at most predicted positions. A half-period alternates
    // between lines and cell interiors, unlike a genuine finer grid.
    const valid = maxX > 0 && maxY > 0
      ? candidates.filter(c => c.x >= maxX * 0.75 && c.y >= maxY * 0.75)
      : []
    return settle(img, (valid.at(-1) ?? candidates[0]).grid, px, py)
  }
  const px = profile(img, 0)
  const py = profile(img, 1)
  const pers: number[] = []
  for (let per = lo; per < hi; per += 0.02) pers.push(per)

  const axisScore = (p: Float64Array) => {
    const out = new Float64Array(pers.length)
    let top = 0
    pers.forEach((per, i) => {
      let best = 0
      for (let o = 0; o < per; o += 0.5) best = Math.max(best, percentile(lineValues(p, per, o), 40))
      out[i] = best
      top = Math.max(top, best)
    })
    for (let i = 0; i < out.length; i++) out[i] /= top || 1
    return out
  }
  const sx = axisScore(px)
  const sy = axisScore(py)
  const comb = sx.map((v, i) => v + sy[i])
  const top = comb.reduce((a, b) => Math.max(a, b), 0)
  let i = comb.findIndex((v) => v >= 0.62 * top)
  while (i + 1 < pers.length && comb[i + 1] >= comb[i]) i++
  return settle(img, refine(px, py, pers[i]), px, py)
}

/** a step across a row or column of pixels this big (summed over channels) counts as an edge:
 *  low, since the thin lines on some charts barely differ from the cells (about 20) */
const STEP = 12
/** another phase must cover this much more of the image to be taken instead */
const PHASE_WINS = 1.25
/** ...and twice the cell size this much more, on both axes */
const DOUBLE_WINS = 1.2

/** Share of each row (axis 1) or column (axis 0) of pixels where the image steps across it. A
 *  grid line crosses the whole chart; the print in a row of cells only covers part of it. */
function coverage(img: Raster, axis: 0 | 1): Float64Array {
  const { width: W, height: H, data } = img
  const n = axis === 0 ? W - 1 : H - 1
  const out = new Float64Array(n)
  const step = axis === 0 ? 4 : W * 4
  const along = axis === 0 ? H : W
  for (let k = 0; k < n; k++) {
    let c = 0
    for (let a = 0; a < along; a++) {
      const i = axis === 0 ? (a * W + k) * 4 : (k * W + a) * 4
      if (Math.abs(data[i + step] - data[i]) + Math.abs(data[i + step + 1] - data[i + 1]) + Math.abs(data[i + step + 2] - data[i + 2]) > STEP) c++
    }
    out[k] = c / along
  }
  return out
}

/**
 * The cell size checked against twice it, and the phase of the lines against every other phase. Every row of cells prints its codes
 * at one height, so the tops and bottoms of the print make a second set of "lines" at the cell
 * pitch; on charts with faint grey lines and bold print they can outweigh the real ones in the
 * summed profile, and the grid lands in the print, up to half a cell off (seen on rows, not
 * columns: codes start and end at different x). Real lines cross the whole chart, print only part
 * of it, so the phase whose lines cross the most of the image wins when it clearly does.
 */
function settle(img: Raster, grid: Grid, px: Float64Array, py: Float64Array): Grid {
  const cx = coverage(img, 0)
  const cy = coverage(img, 1)
  // White print in the middle of dark cells can pass for a line of its own, and half the cell
  // size then finds a line at every step. At the true size every line crosses the chart; at half
  // of it every other one is print.
  const doubled = refine(px, py, grid.perX + grid.perY)
  if (crossing(cx, doubled.perX).best > DOUBLE_WINS * crossing(cx, grid.perX).best && crossing(cy, doubled.perY).best > DOUBLE_WINS * crossing(cy, grid.perY).best) grid = doubled
  return { ...grid, offX: phase(cx, grid.perX, grid.offX), offY: phase(cy, grid.perY, grid.offY) }
}

/** How much of the image lines at this pitch cross, per phase (a step of half a pixel), and at best. */
function crossing(c: Float64Array, per: number): { score: number[]; best: number; at: (o: number) => number } {
  const reach = Math.max(2, Math.round(per * 0.06))
  const at = (o: number) => {
    let s = 0
    let n = 0
    for (let k = 0; o + k * per < c.length; k++) {
      const x = Math.round(o + k * per)
      let m = 0
      for (let d = -reach; d <= reach; d++) if (x + d >= 0 && x + d < c.length) m = Math.max(m, c[x + d])
      s += m
      n++
    }
    return n ? s / n : 0
  }
  const steps = Math.ceil(per * 2)
  const score = Array.from({ length: steps }, (_, k) => at((k * per) / steps))
  return { score, best: Math.max(...score), at }
}

/** The phase whose lines cross the most of the image, when it clearly beats the one found. */
function phase(c: Float64Array, per: number, off: number): number {
  const { score, best: top, at } = crossing(c, per)
  if (top <= PHASE_WINS * at(off)) return off
  // the middle of the run of phases near the top (the window makes a plateau around a line)
  const steps = score.length
  const best = score.indexOf(top)
  let lo = best
  let hi = best
  while (score[(((lo - 1) % steps) + steps) % steps] >= 0.95 * top && hi - lo < steps) lo--
  while (score[(hi + 1) % steps] >= 0.95 * top && hi - lo < steps) hi++
  return ((((lo + hi) / 2) * per) / steps + per) % per
}

/** Weak-end line evidence; mean alone also rewards every second/fourth grid line. */
function support(p: Float64Array, per: number): number {
  let best = 0
  for (let off = 0; off < per; off += 0.5) {
    best = Math.max(best, percentile(lineValues(p, per, off), 40))
  }
  return best
}

/** Exact pitch and phase per axis around a pitch estimate, then centred on the grid lines. */
function refine(px: Float64Array, py: Float64Array, per: number): Grid {
  // a small relative tolerance: +-0.08px up to 32px cells, then growing (about +-0.11px at 44px)
  const span = Math.max(0.08, per * 0.0025)
  const fine = (p: Float64Array): [number, number] => {
    let best = -1
    let bp = per
    let bo = 0
    for (let dp = -span; dp < span; dp += span / 40) {
      for (let o = 0; o < per + dp; o += 0.1) {
        const s = mean(lineValues(p, per + dp, o))
        if (s > best) {
          best = s
          bp = per + dp
          bo = o
        }
      }
    }
    return [bp, bo]
  }
  // The fit locks onto one edge of each grid line; move to the middle of the line so a cell box
  // starts and ends on line centres and labels are not clipped. Lines get thicker with the
  // cell size, so the search reaches further on big cells.
  const centre = (p: Float64Array, per: number, off: number) => {
    const reach = Math.max(2, Math.round(per * 0.06))
    let main = 0
    let bestD = 0
    let bestV = 0
    for (let d = -reach; d <= reach; d++) {
      const v = off + d >= 0 ? mean(lineValues(p, per, off + d)) : 0
      if (d === 0) main = v
      else if (v > bestV) {
        bestV = v
        bestD = d
      }
    }
    const d2 = bestV >= 0.35 * main ? bestD : 0
    return (((off + d2 / 2 + 0.5) % per) + per) % per
  }
  const [perX, ox] = fine(px)
  const [perY, oy] = fine(py)
  return { perX, offX: centre(px, perX, ox), perY, offY: centre(py, perY, oy) }
}

/** Area-averaged copy, `f` times smaller in each direction. */
export function reduce(img: Raster, f: number): Raster {
  const w = Math.max(1, Math.floor(img.width / f))
  const h = Math.max(1, Math.floor(img.height / f))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * f)
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * f)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * f)
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * f)))
      let r = 0
      let g = 0
      let b = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Grid lines only exist where the chart is, so along each axis we look for the stretch where the
 * lines of the other axis are actually present. Returns whole cells that lie inside the image.
 */
export function findBoard(img: Raster, grid: Grid): Extent {
  const { width: W, height: H, data } = img

  // axis 'rows': which rows have vertical lines; 'cols': which columns have horizontal lines
  const extent = (rows: boolean, per: number, off: number, perOther: number, offOther: number): [number, number] => {
    const along = rows ? H : W
    const across = rows ? W - 1 : H - 1
    const edge = (a: number, x: number) => {
      // gradient across the line direction at position (along=a, across=x)
      const i = rows ? (a * W + x) * 4 : (x * W + a) * 4
      const j = rows ? i + 4 : i + W * 4
      return Math.abs(data[j] - data[i]) + Math.abs(data[j + 1] - data[i + 1]) + Math.abs(data[j + 2] - data[i + 2])
    }
    // Lines get thicker with the cell size (and every 5th/10th one is thicker still), so the
    // window around a line and the gap that still counts as "inside" are fractions of a cell.
    const reach = Math.max(2, Math.round(per * 0.06))
    const tolerance = Math.max(5, Math.round(perOther * 0.35))
    const idx: number[] = []
    for (let k = 0; k <= Math.floor((across - off) / per); k++) {
      const x = Math.round(off + k * per)
      if (x >= reach && x < across - reach) idx.push(x)
    }
    const sig = new Float64Array(along)
    const tmp = new Float64Array(idx.length)
    for (let a = 0; a < along; a++) {
      for (let k = 0; k < idx.length; k++) {
        const x = idx[k]
        let m = 0
        for (let d = -reach; d < reach; d++) m = Math.max(m, edge(a, x + d))
        tmp[k] = m
      }
      sig[a] = percentile(tmp, 65) // a line at a good share of the positions?
    }
    const thr = Math.max(20, 0.25 * percentile(sig, 70))
    let best: [number, number] = [0, 0]
    let start = -1
    let gap = 0
    let cur = 0
    for (let a = 0; a < along + tolerance + 1; a++) {
      const inside = a < along && sig[a] > thr
      if (inside) {
        if (start < 0) start = a
        gap = 0
        cur = a
      } else if (start >= 0) {
        gap++
        if (gap > tolerance) {
          if (cur - start > best[1] - best[0]) best = [start, cur + 1]
          start = -1
        }
      }
    }
    return [Math.round((best[0] - offOther) / perOther), Math.round((best[1] - best[0]) / perOther)]
  }

  let [r0, rows] = extent(true, grid.perX, grid.offX, grid.perY, grid.offY)
  let [c0, cols] = extent(false, grid.perY, grid.offY, grid.perX, grid.offX)
  while (grid.offY + r0 * grid.perY < -0.5) {
    r0++
    rows--
  }
  while (grid.offX + c0 * grid.perX < -0.5) {
    c0++
    cols--
  }
  while (grid.offY + (r0 + rows) * grid.perY > H + 0.5) rows--
  while (grid.offX + (c0 + cols) * grid.perX > W + 0.5) cols--
  return { r0, c0, rows, cols }
}
