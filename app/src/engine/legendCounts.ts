// Reading the bead counts printed in the legend, with no font assumed.
// Each swatch's count is printed either beside it (the last word before the next swatch: "B1: 90",
// or the white box of "B11 | 214") or under it. The digits are learnt from the chart itself: the
// counts the board gives are mostly right, so their digits label the printed glyphs; averaging
// many labelled glyphs gives this chart's 0-9, and each printed count is then read with them.
import type { Raster } from './grid'
import type { LegendSwatch } from './legendSwatches'

const GW = 10 // glyph samples across
const GH = 14 // glyph samples down

interface Word {
  glyphs: Float32Array[]
  /** width / height of each glyph, a strong cue for 1 */
  aspect: number[]
}

const dist = (a: number[], r: number, g: number, b: number) => Math.abs(a[0] - r) + Math.abs(a[1] - g) + Math.abs(a[2] - b)

/** Ink (0..1, unlike the commonest colour) of a region, row-major. */
function inkOf(img: Raster, x0: number, y0: number, w: number, h: number): Float32Array {
  const { width: W, data } = img
  const tally = new Map<number, number>()
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = ((y0 + y) * W + x0 + x) * 4
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
  }
  const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0xfff
  const page = [((top >> 8) << 4) + 8, (((top >> 4) & 15) << 4) + 8, ((top & 15) << 4) + 8]
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * W + x0 + x) * 4
      out[y * w + x] = Math.min(1, dist(page, data[i], data[i + 1], data[i + 2]) / 255)
    }
  }
  return out
}

/** The words of one text line inside a region, as normalised glyphs. `pickLine` chooses which
 *  band of inked rows is the line. */
function words(img: Raster, x0: number, y0: number, x1: number, y1: number, pickLine: (bands: [number, number][]) => [number, number] | undefined): Word[] {
  x0 = Math.max(0, Math.round(x0))
  y0 = Math.max(0, Math.round(y0))
  x1 = Math.min(img.width, Math.round(x1))
  y1 = Math.min(img.height, Math.round(y1))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 4 || h < 4) return []
  const ink = inkOf(img, x0, y0, w, h)
  // box outlines (count boxes, swatch frames) run across the region: erase them first
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) if (ink[y * w + x] > 0.35) n++
    if (n > 0.8 * w) for (let x = 0; x < w; x++) ink[y * w + x] = 0
  }
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) if (ink[y * w + x] > 0.35) n++
    if (n > 0.8 * h) for (let y = 0; y < h; y++) ink[y * w + x] = 0
  }
  const on = (x: number, y: number) => ink[y * w + x] > 0.35
  // text lines: bands of rows with ink
  const bands: [number, number][] = []
  let start = -1
  for (let y = 0; y <= h; y++) {
    let any = false
    if (y < h) for (let x = 0; x < w && !any; x++) any = on(x, y)
    if (any && start < 0) start = y
    if (!any && start >= 0) {
      if (y - start >= 4) bands.push([start, y])
      start = -1
    }
  }
  const line = pickLine(bands)
  if (!line) return []
  const [ly0, ly1] = line
  const lh = ly1 - ly0
  const colOn = (x: number) => {
    for (let y = ly0; y < ly1; y++) if (on(x, y)) return true
    return false
  }
  // glyphs: runs of inked columns, and touching digits (small print, JPEG blur) split where the
  // column ink is faint; words: glyphs closer than a space
  const mass = new Float32Array(w)
  for (let x = 0; x < w; x++) for (let y = ly0; y < ly1; y++) mass[x] += ink[y * w + x]
  const runs: [number, number][] = []
  for (let x = 0; x < w; ) {
    while (x < w && !colOn(x)) x++
    const s = x
    while (x < w && colOn(x)) x++
    if (x <= s) continue
    let from = s
    const peak = Math.max(...mass.subarray(s, x))
    for (let c = s + 1; c < x - 1; c++) {
      const valley = mass[c] < 0.35 * peak && mass[c] <= mass[c - 1] && mass[c] <= mass[c + 1]
      if (valley && c - from >= 0.3 * lh && x - c >= 0.3 * lh) {
        runs.push([from, c])
        from = c + 1
      }
    }
    runs.push([from, x])
  }
  const out: Word[] = []
  let cur: [number, number][] = []
  const flush = () => {
    if (!cur.length) return
    const glyphs: Float32Array[] = []
    const aspect: number[] = []
    for (const [a, b] of cur) {
      let gy0 = ly1
      let gy1 = ly0
      for (let y = ly0; y < ly1; y++) {
        for (let x = a; x < b; x++) {
          if (on(x, y)) {
            gy0 = Math.min(gy0, y)
            gy1 = Math.max(gy1, y + 1)
            break
          }
        }
      }
      // a glyph keeps its place on the line (digits all reach top and bottom; "." and ":" do not)
      const g = new Float32Array(GW * GH)
      for (let v = 0; v < GH; v++) {
        for (let u = 0; u < GW; u++) {
          const x = Math.min(b - 1, Math.floor(a + ((u + 0.5) * (b - a)) / GW))
          const y = Math.min(ly1 - 1, Math.floor(ly0 + ((v + 0.5) * lh) / GH))
          g[v * GW + u] = ink[y * w + x]
        }
      }
      glyphs.push(g)
      aspect.push((b - a) / Math.max(1, gy1 - gy0))
    }
    out.push({ glyphs, aspect })
    cur = []
  }
  for (const r of runs) {
    if (cur.length && r[0] - cur[cur.length - 1][1] > 0.35 * lh) flush()
    cur.push(r)
  }
  flush()
  return out
}

const unitVec = (g: Float32Array, aspect: number) => {
  const v = new Float32Array(g.length + 1)
  v.set(g)
  v[g.length] = aspect * 3 // narrow 1 apart from the rest
  return normalise(v)
}

const normalise = (src: Float32Array) => {
  const v = Float32Array.from(src)
  let m = 0
  for (const x of v) m += x
  m /= v.length
  let n = 0
  for (let i = 0; i < v.length; i++) {
    v[i] -= m
    n += v[i] * v[i]
  }
  n = Math.sqrt(n) + 1e-6
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

/**
 * The printed count of each swatch, or null where none could be read. `counted[i]` is the number
 * of board cells given to swatch i; it labels the digits but is never copied into the result.
 */
export function readCounts(img: Raster, swatches: LegendSwatch[], counted: number[]): (number | null)[] {
  const N = swatches.length
  if (N < 3) return swatches.map(() => null)
  // candidate words for each swatch, on each side
  const beside: (Word | null)[] = []
  const under: (Word | null)[] = []
  swatches.forEach((s) => {
    const r = s.rect
    const c = s.sampleRect
    let right = r.x + r.w + 8 * r.h
    for (const o of swatches) {
      const overlap = Math.min(o.rect.y + o.rect.h, r.y + r.h) - Math.max(o.rect.y, r.y)
      if (o !== s && overlap > 0.5 * r.h && o.rect.x > r.x + r.w / 2) right = Math.min(right, o.rect.x)
    }
    // beside: right of the coloured part. When the swatch's box is wider than its colour, the
    // count sits in the rest of that box: read only inside it, clear of its outline.
    const boxed = r.w > 1.4 * c.w
    const pad = Math.max(2, 0.08 * r.h)
    const b = boxed
      ? words(img, c.x + c.w + pad, r.y + pad, r.x + r.w - pad, r.y + r.h - pad, (bands) => bands.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0])
      : words(img, c.x + c.w + 1, r.y - 0.1 * r.h, right - 1, r.y + 1.1 * r.h, (bands) => bands.find(([a, z]) => a < 0.9 * r.h && z > 0.25 * r.h))
    beside.push(b.length ? b[b.length - 1] : null)
    // under: the first line below the swatch, across its width
    const u = words(img, r.x - 0.25 * r.w, r.y + r.h + 1, r.x + 1.25 * r.w, r.y + r.h + 1.6 * r.h, (bands) => bands[0])
    under.push(u.length === 1 ? u[0] : u.length ? u.reduce((a, z) => (z.glyphs.length > a.glyphs.length ? z : a)) : null)
  })
  // the side whose words have as many glyphs as the counted numbers have digits
  const fits = (ws: (Word | null)[]) => ws.filter((w, i) => w && w.glyphs.length === String(counted[i]).length).length
  const side = fits(beside) >= fits(under) ? beside : under
  if (fits(side) < 0.5 * N) return swatches.map(() => null)

  // Learn 0-9 from words whose length matches their counted number. Each word is then read with
  // digits learnt from the OTHER words only, so a miscounted swatch cannot teach its own misreading.
  const sum = Array.from({ length: 10 }, () => new Float32Array(GW * GH + 1))
  const seen = new Array<number>(10).fill(0)
  const own: { d: number; v: Float32Array }[][] = side.map(() => [])
  side.forEach((w, i) => {
    const digits = String(counted[i])
    if (!w || w.glyphs.length !== digits.length) return
    w.glyphs.forEach((g, k) => {
      const d = Number(digits[k])
      const v = unitVec(g, w.aspect[k])
      for (let j = 0; j < v.length; j++) sum[d][j] += v[j]
      seen[d]++
      own[i].push({ d, v })
    })
  })
  return side.map((w, i) => {
    if (!w || !w.glyphs.length || w.glyphs.length > 5) return null
    const templates = sum.map((s, d) => {
      const left = Float32Array.from(s)
      let n = seen[d]
      for (const o of own[i]) {
        if (o.d !== d) continue
        for (let j = 0; j < left.length; j++) left[j] -= o.v[j]
        n--
      }
      return n > 0 ? normalise(left) : null
    })
    let text = ''
    for (let k = 0; k < w.glyphs.length; k++) {
      const v = unitVec(w.glyphs[k], w.aspect[k])
      let best = -1
      let bs = -Infinity
      templates.forEach((t, d) => {
        if (!t) return
        let s = 0
        for (let j = 0; j < v.length; j++) s += t[j] * v[j]
        if (s > bs) {
          bs = s
          best = d
        }
      })
      // a glyph like no learnt digit (a letter, a colon): not a count
      if (best < 0 || bs < 0.6) return null
      text += best
    }
    return Number(text)
  })
}
