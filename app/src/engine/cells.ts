// Reading the cells of the gridded area: fill colour and label ink for each one.
import { type Extent, type Grid, type Raster, reduce } from './grid'

/** Label ink is resampled to INK x INK per cell so cells of any size compare directly. */
export const INK = 40
/** Grid-line ink lives at the cell edge; comparisons ignore this many samples on each side. */
export const EDGE = 4
export const CORE = INK - 2 * EDGE

export interface Cells {
  rows: number
  cols: number
  /** rows*cols*3, the fill colour of each cell */
  fill: Float32Array
  /** rows*cols*INK*INK, 0..255: how unlike the fill each point of the cell is */
  ink: Uint8Array
  /** rows*cols, share of the cell's pixels that are not fill */
  share: Float32Array
  /** position of cell (0,0) in the image grid, for cropping tiles later */
  r0: number
  c0: number
}

/** Only label ink is normalised in scale. Fill/share always come from original pixels. */
const READ_CELL = 24

export function readCells(img: Raster, grid: Grid, ext: Extent, inset = 0.16): Cells {
  const per = (grid.perX + grid.perY) / 2
  const factor = per > READ_CELL * 1.15 ? per / READ_CELL : 1
  const inkImage = factor > 1 ? reduce(img, factor) : img
  const inkGrid = {
    perX: grid.perX / factor, perY: grid.perY / factor,
    offX: grid.offX / factor, offY: grid.offY / factor,
  }
  const { width: iw, height: ih, data: inkData } = inkImage
  const { width: W, height: H, data } = img
  const { rows, cols, r0, c0 } = ext
  const n = rows * cols
  const fill = new Float32Array(n * 3)
  const ink = new Uint8Array(n * INK * INK)
  const share = new Float32Array(n)
  const buf = new Float32Array(160 * 3)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c
      const x0 = grid.offX + (c0 + c) * grid.perX
      const y0 = grid.offY + (r0 + r) * grid.perY
      // fill = the pixel with the most look-alikes among the inner pixels
      const xa = Math.max(0, Math.round(x0 + grid.perX * inset))
      const xb = Math.min(W, Math.round(x0 + grid.perX * (1 - inset)))
      const ya = Math.max(0, Math.round(y0 + grid.perY * inset))
      const yb = Math.min(H, Math.round(y0 + grid.perY * (1 - inset)))
      const total = Math.max(0, xb - xa) * Math.max(0, yb - ya)
      const step = total > 144 ? Math.floor(total / 144) + 1 : 1
      let m = 0
      for (let k = 0; k < total; k += step) {
        const i = ((ya + Math.floor(k / (xb - xa))) * W + xa + (k % (xb - xa))) * 4
        buf[m * 3] = data[i]
        buf[m * 3 + 1] = data[i + 1]
        buf[m * 3 + 2] = data[i + 2]
        m++
      }
      let best = -1
      let bestCount = 0
      for (let a = 0; a < m; a++) {
        let cnt = 0
        for (let b = 0; b < m; b++) {
          const d = Math.abs(buf[a * 3] - buf[b * 3]) + Math.abs(buf[a * 3 + 1] - buf[b * 3 + 1]) + Math.abs(buf[a * 3 + 2] - buf[b * 3 + 2])
          if (d < 30) cnt++
        }
        if (cnt > bestCount) {
          bestCount = cnt
          best = a
        }
      }
      let fr = 0
      let fg = 0
      let fb = 0
      if (best >= 0) {
        let cnt = 0
        for (let b = 0; b < m; b++) {
          const d = Math.abs(buf[best * 3] - buf[b * 3]) + Math.abs(buf[best * 3 + 1] - buf[b * 3 + 1]) + Math.abs(buf[best * 3 + 2] - buf[b * 3 + 2])
          if (d < 30) {
            fr += buf[b * 3]
            fg += buf[b * 3 + 1]
            fb += buf[b * 3 + 2]
            cnt++
          }
        }
        fr /= cnt
        fg /= cnt
        fb /= cnt
        share[cell] = 1 - cnt / m
      }
      fill[cell * 3] = fr
      fill[cell * 3 + 1] = fg
      fill[cell * 3 + 2] = fb

      // Resample only the label image; compare its pixels to the ORIGINAL fill.
      // After scale normalisation square cells need one bilinear sample per point.
      // Multiple samples remain useful if a rectangular cell's long side exceeds INK.
      const base = cell * INK * INK
      const sw = inkGrid.perX / INK
      const sh = inkGrid.perY / INK
      const ix0 = inkGrid.offX + (c0 + c) * inkGrid.perX
      const iy0 = inkGrid.offY + (r0 + r) * inkGrid.perY
      const kx = Math.max(1, Math.ceil(sw))
      const ky = Math.max(1, Math.ceil(sh))
      for (let v = 0; v < INK; v++) {
        for (let u = 0; u < INK; u++) {
          let d = 0
          for (let a = 0; a < ky; a++) {
            const sy = Math.min(ih - 1.001, Math.max(0, iy0 + (v + (a + 0.5) / ky) * sh - 0.5))
            const yi = Math.floor(sy)
            const fy = sy - yi
            for (let b = 0; b < kx; b++) {
              const sx = Math.min(iw - 1.001, Math.max(0, ix0 + (u + (b + 0.5) / kx) * sw - 0.5))
              const xi = Math.floor(sx)
              const fx = sx - xi
              const i00 = (yi * iw + xi) * 4
              const i01 = i00 + 4
              const i10 = i00 + iw * 4
              const i11 = i10 + 4
              for (let ch = 0; ch < 3; ch++) {
                const top = inkData[i00 + ch] * (1 - fx) + inkData[i01 + ch] * fx
                const bot = inkData[i10 + ch] * (1 - fx) + inkData[i11 + ch] * fx
                d += Math.abs(top * (1 - fy) + bot * fy - (ch === 0 ? fr : ch === 1 ? fg : fb))
              }
            }
          }
          ink[base + v * INK + u] = Math.min(255, d / (kx * ky))
        }
      }
    }
  }
  return { rows, cols, fill, ink, share, r0, c0 }
}

/** Remove the numbered border: a flat colour that the picture itself does not use. */
const BORDER_APART = 18

export function stripBorder(cells: Cells): Cells {
  const { rows, cols, fill } = cells
  const colour = (r: number, c: number) => [fill[(r * cols + c) * 3], fill[(r * cols + c) * 3 + 1], fill[(r * cols + c) * 3 + 2]]
  const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  const median = (line: number[][]) => [0, 1, 2].map((ch) => line.map((p) => p[ch]).sort((a, b) => a - b)[Math.floor(line.length / 2)])
  const inner: number[][] = []
  for (let r = 2; r < rows - 2; r++) for (let c = 2; c < cols - 2; c++) inner.push(colour(r, c))
  const isBorder = (line: number[][]) => {
    const med = median(line)
    // a border is one flat colour; pale beads (H10, near-white) sit within 30 of a pale-blue
    // ruler, so the test of "not found inside" is tighter than that
    const flat = line.filter((p) => dist(p, med) < 30).length / line.length
    const inside = inner.filter((p) => dist(p, med) < BORDER_APART).length / inner.length
    return flat > 0.8 && inside < 0.02
  }
  const rowLine = (r: number) => Array.from({ length: cols - 4 }, (_, k) => colour(r, k + 2))
  const colLine = (c: number) => Array.from({ length: rows - 4 }, (_, k) => colour(k + 2, c))
  let t = 0
  let b = rows
  let l = 0
  let rr = cols
  if (isBorder(rowLine(t))) t++
  if (isBorder(rowLine(b - 1))) b--
  if (isBorder(colLine(l))) l++
  if (isBorder(colLine(rr - 1))) rr--
  if (t === 0 && b === rows && l === 0 && rr === cols) return cells

  const nr = b - t
  const nc = rr - l
  const out: Cells = {
    rows: nr,
    cols: nc,
    fill: new Float32Array(nr * nc * 3),
    ink: new Uint8Array(nr * nc * INK * INK),
    share: new Float32Array(nr * nc),
    r0: cells.r0 + t,
    c0: cells.c0 + l,
  }
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const src = (r + t) * cols + (c + l)
      const dst = r * nc + c
      out.fill.set(fill.subarray(src * 3, src * 3 + 3), dst * 3)
      out.ink.set(cells.ink.subarray(src * INK * INK, (src + 1) * INK * INK), dst * INK * INK)
      out.share[dst] = cells.share[src]
    }
  }
  return out
}

export interface Clusters {
  /** cluster id of each cell */
  label: Int32Array
  /** k*3 mean fill colour */
  centre: Float64Array
  count: number[]
}

/** Sequential grouping by fill colour: a cell joins the nearest group within `thr`, else starts one. */
export function clusterByFill(fill: Float32Array, thr = 26): Clusters {
  const n = fill.length / 3
  const label = new Int32Array(n)
  const cents: number[] = []
  const count: number[] = []
  for (let i = 0; i < n; i++) {
    const r = fill[i * 3]
    const g = fill[i * 3 + 1]
    const b = fill[i * 3 + 2]
    let best = -1
    let bd = Infinity
    for (let k = 0; k < count.length; k++) {
      const d = Math.abs(cents[k * 3] - r) + Math.abs(cents[k * 3 + 1] - g) + Math.abs(cents[k * 3 + 2] - b)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    if (best >= 0 && bd < thr) {
      const c = count[best]
      cents[best * 3] = (cents[best * 3] * c + r) / (c + 1)
      cents[best * 3 + 1] = (cents[best * 3 + 1] * c + g) / (c + 1)
      cents[best * 3 + 2] = (cents[best * 3 + 2] * c + b) / (c + 1)
      count[best]++
      label[i] = best
    } else {
      cents.push(r, g, b)
      count.push(1)
      label[i] = count.length - 1
    }
  }
  return { label, centre: Float64Array.from(cents), count }
}

/** Mean ink map (0..1) of the given cells: stacking makes an unreadable small label readable. */
export function stack(cells: Cells, members: number[]): Float32Array {
  const out = new Float32Array(INK * INK)
  for (const m of members) {
    const base = m * INK * INK
    for (let i = 0; i < INK * INK; i++) out[i] += cells.ink[base + i]
  }
  const k = 1 / (255 * Math.max(1, members.length))
  for (let i = 0; i < out.length; i++) out[i] *= k
  return out
}

/** Core of an ink map (edges dropped), mean removed, unit length: ready for correlation. */
export function unit(map: ArrayLike<number>, scale = 1, out = new Float32Array(CORE * CORE), offset = 0): Float32Array {
  let s = 0
  let j = 0
  for (let y = EDGE; y < INK - EDGE; y++) {
    for (let x = EDGE; x < INK - EDGE; x++) {
      const v = map[offset + y * INK + x] * scale
      out[j++] = v
      s += v
    }
  }
  const mean = s / out.length
  let norm = 0
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm) + 1e-6
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}
