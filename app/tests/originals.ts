// Same four charts, higher-resolution originals (IMG_* in the project root) versus the
// compressed copies in samples/. Runs two methods on each and prints a comparison:
//   - label: the current engine (fill-colour groups named by stacked-label matching)
//   - swatch: nearest same-image legend swatch colour per cell, the method from the
//     tests/colour-baseline.ts, with its hand-placed swatch positions scaled to each image
// Run from app/:  npx tsx tests/originals.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import { CODES } from '../src/engine/glyphs'
import type { Raster } from '../src/engine/grid'
import type { TextRenderer } from '../src/engine/glyphs'
import { countByCode, recognise, type Recognition } from '../src/engine/recognize'

const SS = 4
const render: TextRenderer = (text, font, size, box) => {
  const canvas = createCanvas(box * SS, box * SS)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, box * SS, box * SS)
  ctx.fillStyle = '#fff'
  ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))))
  const m = ctx.measureText(text)
  ctx.fillText(text, (box * SS - m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 + m.actualBoundingBoxLeft, (box * SS - m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, box * SS, box * SS).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < box * SS; y++) for (let x = 0; x < box * SS; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS)
  return out
}

const load = (rel: string): Raster => {
  const img = jpeg.decode(readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url))), { useTArray: true, maxMemoryUsageInMB: 2048 })
  return { width: img.width, height: img.height, data: img.data }
}

// legends read by hand (same as tests/recognize.ts); scoring only
const LEGEND: Record<string, Record<string, number> | undefined> = {
  tree: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 },
  dog: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 },
  landscape: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 },
  portrait: undefined,
}

// Hand-placed legend swatches, in samples/ pixel coordinates (copied from colour-baseline.ts)
type Row = { codes: string[]; x: number[]; y: number; w: number; h: number }
const seq = (n: number, a: number, d: number) => Array.from({ length: n }, (_, i) => a + i * d)
const SWATCHES: Record<string, Row[]> = {
  tree: [{ codes: 'B11 B15 B17 B22 B23 B29 B32 F11 G17 H2 H7 H16 H17'.split(' '), x: seq(13, 38, 97), y: 1835, w: 30, h: 17 }],
  dog: [{ codes: 'A1 H2 H7 F21 G12 A11 E4 B30 E18 B17 C17 C26 B13 F13 M2 M3 F23 F19 F14'.split(' '), x: seq(19, 12, 44.15), y: 1246, w: 13, h: 10 }],
  landscape: [{ codes: 'A3 A6 A7 A8 A15 A22 A26 B1 B7 B8 B9 B11 B13 B15 B18 B19 B21 B26 B29 B32 C3 C19 C24 C27 F8 F10 F11 F13 F19 G7 G8 G13 G17 G19 H12'.split(' '), x: seq(35, 16, 20.87), y: 1096, w: 14, h: 17 }],
  portrait: [
    { codes: 'A1 A12 A23 B26 C29 D3 D7 D10 D13 D19 D21 E1 E3 E7 E8 E10 E11 E15 E16 E17 E19 E20 E21 E23 E24 F6 F7 F9 F10 F11'.split(' '), x: seq(30, 52, 30.5), y: 1355, w: 22, h: 21 },
    { codes: 'F16 F19 F20 F21 F24 G4 G7 G8 G13 G14 G16 G17 G20 H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13 ?1 ?2 ?3 H19'.split(' '), x: seq(30, 52, 30.5), y: 1412, w: 22, h: 21 },
    { codes: 'H20 H22 H23 M4 M6 M7 M8 M9 M10 M11 M12 M13 M14'.split(' '), x: seq(13, 52, 30.5), y: 1468, w: 22, h: 21 },
  ],
}
const SAMPLE_WIDTH: Record<string, number> = { tree: 1280, dog: 1149, landscape: 1049, portrait: 962 }

function swatchColours(img: Raster, key: string): Map<string, number[]> {
  const k = img.width / SAMPLE_WIDTH[key]
  const refs = new Map<string, number[]>()
  for (const row of SWATCHES[key]) {
    row.codes.forEach((code, i) => {
      if (code.startsWith('?')) return // covered by the watermark
      const px: number[][] = []
      for (let y = Math.round((row.y - row.h / 2) * k); y < (row.y + row.h / 2) * k; y++)
        for (let x = Math.round((row.x[i] - row.w / 2) * k); x < (row.x[i] + row.w / 2) * k; x++) {
          const j = (y * img.width + x) * 4
          px.push([img.data[j], img.data[j + 1], img.data[j + 2]])
        }
      // densest colour in the box, as in the colour-baseline script (subsampled for the larger originals)
      const pool = px.length > 400 ? px.filter((_, n) => n % Math.ceil(px.length / 400) === 0) : px
      let best = pool[0]
      let bestN = 0
      for (const c of pool) {
        const near = pool.filter((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 24)
        if (near.length > bestN) {
          bestN = near.length
          best = [0, 1, 2].map((ch) => near.reduce((a, p) => a + p[ch], 0) / near.length)
        }
      }
      refs.set(code, best)
    })
  }
  return refs
}

function swatchCells(rec: Recognition, refs: Map<string, number[]>): string[] {
  const entries = [...refs]
  return Array.from(rec.assign, (g, i) => {
    if (g < 0) return '' // tree: share the engine's blank mask, as in colour-baseline.ts
    const f = rec.cells.fill.subarray(i * 3, i * 3 + 3)
    let best = ''
    let bd = Infinity
    for (const [code, c] of entries) {
      const d = Math.abs(f[0] - c[0]) + Math.abs(f[1] - c[1]) + Math.abs(f[2] - c[2])
      if (d < bd) {
        bd = d
        best = code
      }
    }
    return best
  })
}

const agreement = (counts: Map<string, number>, legend: Record<string, number>) => {
  let off = 0
  for (const c of new Set([...Object.keys(legend), ...counts.keys()])) off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0))
  const total = Object.values(legend).reduce((a, b) => a + b, 0)
  return 100 * (1 - off / 2 / total)
}
const tally = (cells: string[]) => {
  const m = new Map<string, number>()
  for (const c of cells) if (c) m.set(c, (m.get(c) ?? 0) + 1)
  return m
}

const audit = JSON.parse(readFileSync(new URL('./colour-audit.json', import.meta.url), 'utf8')) as { labels: { index: number; code: string }[] }
const PAIRS: [string, string, string][] = [
  ['tree', 'samples/tree-52x64.jpg', 'IMG_0687.JPG'],
  ['dog', 'samples/dog-104x104.jpg', 'IMG_0728.jpg'],
  ['landscape', 'samples/landscape-84x84.jpg', 'IMG_0643.JPG'],
  ['portrait', 'samples/portrait-50x70.jpg', 'IMG_0697.JPG'],
]
const only = process.argv.slice(2)
for (const [key, sample, original] of PAIRS) {
  if (only.length && !only.includes(key)) continue
  for (const [which, file] of [
    ['sample', sample],
    ['original', original],
  ]) {
    const img = load(file)
    const t = Date.now()
    const rec = recognise(img, render)
    const ms = Date.now() - t
    const labelCells = Array.from(rec.assign, (g) => (g >= 0 ? rec.groups[g].code : ''))
    const swatch = swatchCells(rec, swatchColours(img, key))
    const legend = LEGEND[key]
    const pitch = rec.grid.perX.toFixed(1)
    let line = `${key.padEnd(9)} ${which.padEnd(8)} ${img.width}x${img.height} cell ${pitch}px board ${rec.cells.cols}x${rec.cells.rows} ${String(ms).padStart(5)}ms`
    if (legend) line += ` | label ${agreement(countByCode(rec), legend).toFixed(2)}% (${rec.groups.length} codes) | swatch ${agreement(tally(swatch), legend).toFixed(2)}%`
    else {
      const hit = (cells: string[]) => audit.labels.filter((l) => cells[l.index] === l.code).length
      line += ` | spot-check of ${audit.labels.length} cells: label ${hit(labelCells)}/${audit.labels.length} (${rec.groups.length} codes) | swatch ${hit(swatch)}/${audit.labels.length}`
    }
    console.log(line)
  }
}
void CODES
