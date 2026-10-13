// Pixel art (no codes printed) to a chart: each cell's colour, given the nearest MARD code.
//   guessCell: how many image pixels one cell spans, from how long runs of one colour are
//   readPixelArt: a box on the image cut into cols x rows, each cell's commonest colour, the page
//     colour round the picture left empty, codes chosen by colour as the eye sees it (CIE Lab),
//     at most `maxCodes` of them (the rarest merged into the nearest kept)
import { CATALOGUE, CODES, type Rgb } from './glyphs'
import type { Raster } from './grid'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** sRGB to CIE Lab (D65), where distance follows what the eye sees. */
export function labOf({ r, g, b }: Rgb): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const labDist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const near = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 24

/**
 * Pixel art is usually drawn scaled up, each art pixel a square of k x k image pixels. Runs of one
 * colour along rows are then whole multiples of k: the commonest short run is k. 1 for art at its
 * own size.
 */
export function guessCell(img: Raster): number {
  const { width: W, height: H, data } = img
  const runs = new Map<number, number>()
  const step = Math.max(1, Math.floor(H / 200))
  for (let y = 0; y < H; y += step) {
    let start = 0
    for (let x = 1; x <= W; x++) {
      const i = (y * W + x) * 4
      const j = i - 4
      const same = x < W && Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) < 24
      if (same) continue
      const len = x - start
      if (len > 0 && len < W / 4) runs.set(len, (runs.get(len) ?? 0) + 1)
      start = x
    }
  }
  // the run length that most other runs are a whole multiple of, weighted by how often it occurs
  let best = 1
  let bestScore = -1
  for (const [k, n] of runs) {
    if (k < 2) continue
    let score = 0
    for (const [len, m] of runs) if (len % k === 0 || (len + 1) % k === 0 || (len - 1) % k === 0) score += m
    score *= Math.min(1, n / 20)
    if (score > bestScore || (score === bestScore && k < best)) {
      best = k
      bestScore = score
    }
  }
  return bestScore > 0 ? best : 1
}

export interface PixelOptions {
  /** the commonest colour round the box's edge counts as no bead */
  dropPage: boolean
  /** codes allowed (the 221 set, or every MARD code) */
  codes: string[]
  /** at most this many codes; 0 for no limit */
  maxCodes: number
}

/** Each cell's commonest colour among the pixels in its middle; null where it is see-through. */
function cellColours(img: Raster, box: Box, cols: number, rows: number): (Rgb | null)[] {
  const { width: W, data } = img
  const pw = box.w / cols
  const ph = box.h / rows
  const out: (Rgb | null)[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(box.x + (c + 0.25) * pw)
      const x1 = Math.max(x0 + 1, Math.ceil(box.x + (c + 0.75) * pw))
      const y0 = Math.floor(box.y + (r + 0.25) * ph)
      const y1 = Math.max(y0 + 1, Math.ceil(box.y + (r + 0.75) * ph))
      const seen: { c: Rgb; n: number }[] = []
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4
          if (data[i + 3] < 128) continue
          const px = { r: data[i], g: data[i + 1], b: data[i + 2] }
          const hit = seen.find((s) => near(s.c, px))
          if (hit) hit.n++
          else seen.push({ c: px, n: 1 })
        }
      seen.sort((a, b) => b.n - a.n)
      out.push(seen[0]?.c ?? null)
    }
  return out
}

/** The box cut into cols x rows cells, each given a code ('' for none). */
export function readPixelArt(img: Raster, box: Box, cols: number, rows: number, opts: PixelOptions): string[] {
  const colours = cellColours(img, box, cols, rows)
  // the page: the commonest colour of the outermost cells
  let page: Rgb | null = null
  if (opts.dropPage) {
    const edge: Rgb[] = []
    colours.forEach((c, i) => {
      const x = i % cols
      const y = (i - x) / cols
      if (c && (x === 0 || y === 0 || x === cols - 1 || y === rows - 1)) edge.push(c)
    })
    const tally: { c: Rgb; n: number }[] = []
    for (const c of edge) {
      const hit = tally.find((t) => near(t.c, c))
      if (hit) hit.n++
      else tally.push({ c, n: 1 })
    }
    tally.sort((a, b) => b.n - a.n)
    if (tally[0] && tally[0].n >= edge.length / 2) page = tally[0].c
  }
  const allowed = opts.codes.filter((c) => c in CATALOGUE)
  const labs = new Map(allowed.map((c) => [c, labOf(CATALOGUE[c])]))
  const nearest = (lab: [number, number, number], among: string[]) => {
    let best = among[0]
    let bd = Infinity
    for (const c of among) {
      const d = labDist(lab, labs.get(c)!)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }
  const cache = new Map<string, string>()
  let cells = colours.map((c) => {
    if (!c || (page && near(c, page))) return ''
    const key = `${c.r >> 2},${c.g >> 2},${c.b >> 2}`
    let code = cache.get(key)
    if (!code) {
      code = nearest(labOf(c), allowed)
      cache.set(key, code)
    }
    return code
  })
  // too many codes: the rarest goes to the nearest of the others, until few enough are left
  if (opts.maxCodes > 0) {
    for (;;) {
      const counts = new Map<string, number>()
      for (const c of cells) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
      if (counts.size <= opts.maxCodes) break
      const [rare] = [...counts].sort((a, b) => a[1] - b[1])[0]
      const to = nearest(labs.get(rare)!, [...counts.keys()].filter((c) => c !== rare))
      cells = cells.map((c) => (c === rare ? to : c))
    }
  }
  return cells
}

/** every MARD code, for "全部 MARD" */
export const ALL_CODES = CODES
