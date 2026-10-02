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
  const per = pers[i]

  const fine = (p: Float64Array): [number, number] => {
    let best = -1
    let bp = per
    let bo = 0
    for (let dp = -0.08; dp < 0.08; dp += 0.002) {
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
  // starts and ends on line centres and labels are not clipped.
  const centre = (p: Float64Array, per: number, off: number) => {
    const fold = [-2, -1, 0, 1, 2].map((d) => (off + d >= 0 ? mean(lineValues(p, per, off + d)) : 0))
    const main = fold[2]
    fold[2] = 0
    let j = 0
    for (let k = 1; k < 5; k++) if (fold[k] > fold[j]) j = k
    const d2 = fold[j] >= 0.35 * main ? j - 2 : 0
    return (((off + d2 / 2 + 0.5) % per) + per) % per
  }
  const [perX, ox] = fine(px)
  const [perY, oy] = fine(py)
  return { perX, offX: centre(px, perX, ox), perY, offY: centre(py, perY, oy) }
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
    const idx: number[] = []
    for (let k = 0; k <= Math.floor((across - off) / per); k++) {
      const x = Math.round(off + k * per)
      if (x >= 2 && x < across - 2) idx.push(x)
    }
    const sig = new Float64Array(along)
    const tmp = new Float64Array(idx.length)
    for (let a = 0; a < along; a++) {
      for (let k = 0; k < idx.length; k++) {
        const x = idx[k]
        tmp[k] = Math.max(edge(a, x - 2), edge(a, x - 1), edge(a, x), edge(a, x + 1))
      }
      sig[a] = percentile(tmp, 65) // a line at a good share of the positions?
    }
    const thr = 0.3 * percentile(sig, 70)
    let best: [number, number] = [0, 0]
    let start = -1
    let gap = 0
    let cur = 0
    for (let a = 0; a < along + 6; a++) {
      const inside = a < along && sig[a] > thr
      if (inside) {
        if (start < 0) start = a
        gap = 0
        cur = a
      } else if (start >= 0) {
        gap++
        if (gap > 5) {
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
