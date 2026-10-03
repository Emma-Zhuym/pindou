// Automatic legend naming, end to end: find the legend swatches, name them (legendNames.ts),
// give every cell the name of its nearest swatch, and compare with the hand-read legend counts.
// No oracle reaches the engine: the printed order is used afterwards, only to score each name.
// Link versions (research/out/xhs/charts/, not committed) are skipped when missing.
// Run from app/:  node --import tsx tests/legend-names.ts
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import type { Raster } from '../src/engine/grid'
import type { TextRenderer } from '../src/engine/glyphs'
import { findLegend } from '../src/engine/legendArea'
import { nameSwatches } from '../src/engine/legendNames'
import { findLegendSwatches } from '../src/engine/legendSwatches'
import { recognise } from '../src/engine/recognize'

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
const path = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url))
const load = (rel: string): Raster => {
  const img = jpeg.decode(readFileSync(path(rel)), { useTArray: true, maxMemoryUsageInMB: 4096 })
  return { width: img.width, height: img.height, data: img.data }
}

// Hand-read legends, scoring only. Swatch positions come from colour-baseline.ts, in the
// pixel coordinates of the samples/ copy; ?1-?3 in portrait sit under the watermark.
type Row = { codes: string; x0: number; dx: number; y: number }
const CHARTS: Record<string, { file: string; width: number; rows: Row[]; legend?: Record<string, number> }> = {
  tree: { file: 'tree-52x64', width: 1280, rows: [{ codes: 'B11 B15 B17 B22 B23 B29 B32 F11 G17 H2 H7 H16 H17', x0: 38, dx: 97, y: 1835 }], legend: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 } },
  dog: { file: 'dog-104x104', width: 1149, rows: [{ codes: 'A1 H2 H7 F21 G12 A11 E4 B30 E18 B17 C17 C26 B13 F13 M2 M3 F23 F19 F14', x0: 12, dx: 44.15, y: 1246 }], legend: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 } },
  landscape: { file: 'landscape-84x84', width: 1049, rows: [{ codes: 'A3 A6 A7 A8 A15 A22 A26 B1 B7 B8 B9 B11 B13 B15 B18 B19 B21 B26 B29 B32 C3 C19 C24 C27 F8 F10 F11 F13 F19 G7 G8 G13 G17 G19 H12', x0: 16, dx: 20.87, y: 1096 }], legend: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 } },
  portrait: {
    file: 'portrait-50x70',
    width: 962,
    rows: [
      { codes: 'A1 A12 A23 B26 C29 D3 D7 D10 D13 D19 D21 E1 E3 E7 E8 E10 E11 E15 E16 E17 E19 E20 E21 E23 E24 F6 F7 F9 F10 F11', x0: 52, dx: 30.5, y: 1355 },
      { codes: 'F16 F19 F20 F21 F24 G4 G7 G8 G13 G14 G16 G17 G20 H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13 ?1 ?2 ?3 H19', x0: 52, dx: 30.5, y: 1412 },
      { codes: 'H20 H22 H23 M4 M6 M7 M8 M9 M10 M11 M12 M13 M14', x0: 52, dx: 30.5, y: 1468 },
    ],
  },
}
const agreement = (counts: Map<string, number>, legend: Record<string, number>) => {
  let off = 0
  for (const c of new Set([...Object.keys(legend), ...counts.keys()])) off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0))
  return 100 * (1 - off / 2 / Object.values(legend).reduce((a, b) => a + b, 0))
}
const audit = JSON.parse(readFileSync(new URL('./colour-audit.json', import.meta.url), 'utf8')) as { labels: { index: number; code: string }[] }

const only = process.argv.slice(2)
for (const [key, chart] of Object.entries(CHARTS)) {
  if (only.length && !only.includes(key)) continue
  for (const [which, file] of [
    ['chat-copy', `samples/${chart.file}.jpg`],
    ['phone-saved', `samples/originals/${chart.file}.jpg`],
    ['link', `research/out/xhs/charts/${key}.jpg`],
  ]) {
    if (!existsSync(path(file))) continue
    const img = load(file)
    const rec = recognise(img, render)
    const area = findLegend(img, rec)
    const swatches = area ? findLegendSwatches(img, area, rec.grid.perX) : []
    const t = Date.now()
    const { names, ordered, swatchOf } = nameSwatches(img, rec, swatches, render)
    const ms = Date.now() - t
    const cells = Array.from(swatchOf, (k) => (k >= 0 ? names[k].code : ''))
    let line = `${key.padEnd(9)} ${which.padEnd(11)} swatches ${String(swatches.length).padStart(2)} ${ordered ? 'ordered' : 'unordered'} ${String(ms).padStart(5)}ms`
    const k = img.width / chart.width
    const truth = chart.rows.flatMap((r) => r.codes.split(' ').map((code, i) => ({ code, x: (r.x0 + i * r.dx) * k, y: r.y * k })))
    const inside = (i: number) => truth.filter((t) => { const r = swatches[i].rect; return t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h })
    let right = 0
    let scored = 0
    const wrong: string[] = []
    names.forEach((n, i) => {
      const hit = inside(i)
      if (hit.length !== 1 || hit[0].code.startsWith('?')) return
      scored++
      if (n.code === hit[0].code) right++
      else wrong.push(`${hit[0].code}→${n.code}${n.sure ? '' : '?'}${n.options.includes(hit[0].code) ? '' : '!'}`)
    })
    const flagged = names.filter((n) => !n.sure).length
    line += ` | names ${right}/${scored} (of ${truth.length} printed), flagged ${flagged}${wrong.length ? ` [${wrong.join(' ')}]` : ''}`
    if (chart.legend) {
      const counts = new Map<string, number>()
      for (const c of cells) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
      line += ` | counts ${agreement(counts, chart.legend).toFixed(2)}%`
    } else {
      line += ` | spot-check ${audit.labels.filter((l) => cells[l.index] === l.code).length}/${audit.labels.length}`
    }
    console.log(line)
  }
}
console.log('names: wrong ones as truth→read; ? = marked unsure, ! = truth not among the offered options')
