// Naming a colour group: compare its stacked label with every MARD code drawn as text.
// A chart prints all labels in one font, size and position, so those are fitted once per chart.
import mard from '../data/mard.json'
import { CORE, EDGE, INK, unit } from './cells'

export interface Rgb {
  r: number
  g: number
  b: number
}

const normalise = (c: string) => {
  const m = /^([A-Z]+)0*(\d+)$/.exec(c)
  return m ? m[1] + m[2] : c
}

/** MARD code -> catalogue colour. Source: Zippland/perler-beads (AGPL-3.0), personal use. */
export const CATALOGUE: Record<string, Rgb> = {}
for (const [hex, v] of Object.entries(mard as Record<string, { MARD: string }>)) {
  CATALOGUE[normalise(v.MARD)] = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}
// L1, the clear bead, is sold separately and missing from that table; charts draw it near white.
CATALOGUE.L1 ??= { r: 236, g: 240, b: 243 }
export const CODES = Object.keys(CATALOGUE).sort()

/** Draws `text` centred in a box*box square and returns coverage 0..1. Canvas-backed; injected so
 *  the engine also runs under node for tests. */
export type TextRenderer = (text: string, font: string, sizePx: number, box: number) => Float32Array

export const FONTS = ['bold SIZEpx Arial', 'SIZEpx Arial']

export interface LabelFit {
  font: string
  size: number
  blur: number
  dx: number
  dy: number
  score: number
}

function blur(src: Float32Array, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 2.5)
  const k: number[] = []
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k.push(v)
    sum += v
  }
  const tmp = new Float32Array(INK * INK)
  const out = new Float32Array(INK * INK)
  for (let y = 0; y < INK; y++)
    for (let x = 0; x < INK; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(INK - 1, Math.max(0, x + i))
        s += src[y * INK + xx] * k[i + r]
      }
      tmp[y * INK + x] = s / sum
    }
  for (let y = 0; y < INK; y++)
    for (let x = 0; x < INK; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(INK - 1, Math.max(0, y + i))
        s += tmp[yy * INK + x] * k[i + r]
      }
      out[y * INK + x] = s / sum
    }
  return out
}

/** stack moved by (dx, dy) with wrap-around, then reduced to its unit core */
function shiftedUnit(stack: Float32Array, dx: number, dy: number, out: Float32Array): Float32Array {
  let s = 0
  let j = 0
  for (let y = EDGE; y < INK - EDGE; y++) {
    const sy = (((y - dy) % INK) + INK) % INK
    for (let x = EDGE; x < INK - EDGE; x++) {
      const sx = (((x - dx) % INK) + INK) % INK
      const v = stack[sy * INK + sx]
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

/** Where the label sits in a stack: height and centre of the inked band. */
function labelBox(stack: Float32Array): { h: number; cx: number; cy: number } | null {
  const vals = Array.from(stack).sort((a, b) => a - b)
  const med = vals[vals.length >> 1]
  let max = 0
  for (let y = EDGE; y < INK - EDGE; y++) for (let x = EDGE; x < INK - EDGE; x++) max = Math.max(max, stack[y * INK + x])
  const on = (x: number, y: number) => (stack[y * INK + x] - med) / (max - med + 1e-6) > 0.38
  const rows: number[] = []
  for (let y = EDGE; y < INK - EDGE; y++) {
    let c = 0
    for (let x = EDGE; x < INK - EDGE; x++) if (on(x, y)) c++
    if (c >= 2) rows.push(y)
  }
  if (rows.length < 4) return null
  let best: [number, number] = [rows[0], rows[0]]
  let start = rows[0]
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i] - rows[i - 1] > 1) {
      if (rows[i - 1] - start > best[1] - best[0]) best = [start, rows[i - 1]]
      if (i < rows.length) start = rows[i]
    }
  }
  let x0 = INK
  let x1 = 0
  for (let y = best[0]; y <= best[1]; y++)
    for (let x = EDGE; x < INK - EDGE; x++)
      if (on(x, y)) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
      }
  return { h: best[1] - best[0] + 1, cx: (x0 + x1) / 2, cy: (best[0] + best[1]) / 2 }
}

export function hasLabel(stack: Float32Array): boolean {
  const core: number[] = []
  for (let y = EDGE; y < INK - EDGE; y++) for (let x = EDGE; x < INK - EDGE; x++) core.push(stack[y * INK + x])
  core.sort((a, b) => a - b)
  return core[core.length - 1] - core[core.length >> 1] > 0.25
}

function bank(render: TextRenderer, font: string, size: number, sigma: number, cache: Map<string, Float32Array[]>): Float32Array {
  const key = `${font}|${size.toFixed(2)}`
  let raw = cache.get(key)
  if (!raw) {
    raw = CODES.map((c) => render(c, font, size, INK))
    cache.set(key, raw)
  }
  const out = new Float32Array(CODES.length * CORE * CORE)
  raw.forEach((g, i) => out.set(unit(blur(g, sigma)), i * CORE * CORE))
  return out
}

function bestMatch(b: Float32Array, v: Float32Array): number {
  const n = CORE * CORE
  let best = -1
  for (let c = 0; c < CODES.length; c++) {
    let s = 0
    const o = c * n
    for (let i = 0; i < n; i++) s += b[o + i] * v[i]
    if (s > best) best = s
  }
  return best
}

/** Font, size, blur and offset that explain the given (large) stacks best. */
export function fitLabels(render: TextRenderer, stacks: Float32Array[]): LabelFit {
  const boxes = stacks.map(labelBox).filter((b): b is NonNullable<typeof b> => !!b)
  const mid = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]
  const h = boxes.length ? mid(boxes.map((b) => b.h)) : INK * 0.3
  const dx0 = boxes.length ? Math.round((INK - 1) / 2 - mid(boxes.map((b) => b.cx))) : 0
  const dy0 = boxes.length ? Math.round((INK - 1) / 2 - mid(boxes.map((b) => b.cy))) : 0
  const cache = new Map<string, Float32Array[]>()
  const tmp = new Float32Array(CORE * CORE)
  let best: LabelFit = { font: FONTS[0], size: h / 0.72, blur: 2, dx: dx0, dy: dy0, score: -1 }
  // the measured label height includes blur, so the true font size is at or below h / cap-height
  for (const font of FONTS) {
    for (const f of [0.7, 0.8, 0.9, 1.0, 1.1]) {
      const size = (h / 0.72) * f
      for (const sigma of [1.0, 1.6, 2.4, 3.2]) {
        const b = bank(render, font, size, sigma, cache)
        for (let ex = -1; ex <= 1; ex++) {
          for (let ey = -1; ey <= 1; ey++) {
            let s = 0
            for (const st of stacks) s += bestMatch(b, shiftedUnit(st, dx0 + ex, dy0 + ey, tmp))
            s /= stacks.length
            if (s > best.score) best = { font, size, blur: sigma, dx: dx0 + ex, dy: dy0 + ey, score: s }
          }
        }
      }
    }
  }
  return best
}

export interface Reader {
  /** score of every code (index = CODES index); `jitter` tries the 8 neighbouring offsets too */
  all(stack: Float32Array, jitter?: boolean): Float32Array
  /** scores of just these codes (CODES indices), in that order: cheap enough for every cell */
  some(stack: Float32Array, codes: number[], jitter?: boolean): Float32Array
}

export function makeReader(render: TextRenderer, fit: LabelFit): Reader {
  const b = bank(render, fit.font, fit.size, fit.blur, new Map())
  const n = CORE * CORE
  const tmp = new Float32Array(n)
  return {
    all(stack, jitter = true) {
      const out = new Float32Array(CODES.length).fill(-1)
      const range = jitter ? [-1, 0, 1] : [0]
      for (const ex of range) {
        for (const ey of range) {
          const v = shiftedUnit(stack, fit.dx + ex, fit.dy + ey, tmp)
          for (let c = 0; c < CODES.length; c++) {
            let s = 0
            const o = c * n
            for (let i = 0; i < n; i++) s += b[o + i] * v[i]
            if (s > out[c]) out[c] = s
          }
        }
      }
      return out
    },
    some(stack, codes, jitter = true) {
      const out = new Float32Array(codes.length).fill(-1)
      const range = jitter ? [-1, 0, 1] : [0]
      for (const ex of range) {
        for (const ey of range) {
          const v = shiftedUnit(stack, fit.dx + ex, fit.dy + ey, tmp)
          codes.forEach((c, k) => {
            let s = 0
            const o = c * n
            for (let i = 0; i < n; i++) s += b[o + i] * v[i]
            if (s > out[k]) out[k] = s
          })
        }
      }
      return out
    },
  }
}

/** The label decides; catalogue colour only settles look-alike digits and vetoes codes whose bead
 *  colour is nowhere near this fill. */
export function pickCode(scores: Float32Array, colour: Rgb): { code: string; score: number; colourOff: number } {
  let best = -Infinity
  let bi = 0
  let bcd = 0
  for (let c = 0; c < CODES.length; c++) {
    const k = CATALOGUE[CODES[c]]
    const cd = Math.abs(k.r - colour.r) + Math.abs(k.g - colour.g) + Math.abs(k.b - colour.b)
    const total = scores[c] - cd / 1500 - (cd > 170 ? 1 : 0)
    if (total > best) {
      best = total
      bi = c
      bcd = cd
    }
  }
  return { code: CODES[bi], score: scores[bi], colourOff: bcd }
}
