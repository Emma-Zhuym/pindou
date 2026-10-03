// Charts fetched through Xiaohongshu share links (research/out/xhs/charts/, not committed:
// they are other people's work) versus the phone-saved originals in samples/originals/.
// Two methods each: the current label-reading engine, and the automatic legend swatches
// (legendSwatches.ts) with colour names taken from the legend's known order, which only
// applies when every swatch was found. Each image runs as-is and, when it would shrink, with
// cells scaled to about 20px. Run from app/:  npx tsx tests/link-images.ts
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import type { Raster } from '../src/engine/grid'
import type { TextRenderer } from '../src/engine/glyphs'
import { findLegend } from '../src/engine/legendArea'
import { findLegendSwatches } from '../src/engine/legendSwatches'
import { countByCode, recognise } from '../src/engine/recognize'

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
/** Box-filter downscale by an integer-free factor (test-only; the engine is tuned for ~10-25px cells). */
function shrink(img: Raster, f: number): Raster {
  if (f <= 1) return img
  const w = Math.floor(img.width / f)
  const h = Math.floor(img.height / f)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * f), x1 = Math.max(x0 + 1, Math.floor((x + 1) * f))
      const y0 = Math.floor(y * f), y1 = Math.max(y0 + 1, Math.floor((y + 1) * f))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
          n++
        }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  return { width: w, height: h, data: out }
}
const load = (rel: string): Raster => {
  const img = jpeg.decode(readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url))), { useTArray: true, maxMemoryUsageInMB: 4096 })
  return { width: img.width, height: img.height, data: img.data }
}

// legend codes in printed order, and counts (read by hand; scoring and naming oracle only)
const CHARTS: Record<string, { order: string; legend: Record<string, number> }> = {
  tree: { order: 'B11 B15 B17 B22 B23 B29 B32 F11 G17 H2 H7 H16 H17', legend: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 } },
  dog: { order: 'A1 H2 H7 F21 G12 A11 E4 B30 E18 B17 C17 C26 B13 F13 M2 M3 F23 F19 F14', legend: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 } },
  landscape: { order: 'A3 A6 A7 A8 A15 A22 A26 B1 B7 B8 B9 B11 B13 B15 B18 B19 B21 B26 B29 B32 C3 C19 C24 C27 F8 F10 F11 F13 F19 G7 G8 G13 G17 G19 H12', legend: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 } },
}
const agreement = (counts: Map<string, number>, legend: Record<string, number>) => {
  let off = 0
  for (const c of new Set([...Object.keys(legend), ...counts.keys()])) off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0))
  return 100 * (1 - off / 2 / Object.values(legend).reduce((a, b) => a + b, 0))
}

for (const key of Object.keys(CHARTS)) {
  for (const [which, file] of [
    ['phone-saved', `samples/originals/${key === 'tree' ? 'tree-52x64' : key === 'dog' ? 'dog-104x104' : 'landscape-84x84'}.jpg`],
    ['link', `research/out/xhs/charts/${key}.jpg`],
  ]) {
    if (!existsSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)))) {
      console.log(key, which, 'missing', file)
      continue
    }
    const full = load(file)
    for (const mode of ['as-is', 'cells-20px']) {
    // 'cells-20px': a first pass on a small copy learns the cell size, then cells are brought to
    // about 20px (only ever shrinking). Test-only; the engine itself has no scale step yet.
    let img = full
    if (mode === 'cells-20px') {
      const probe = recognise(shrink(full, Math.max(1, full.width / 1100)), render)
      img = shrink(full, Math.max(1, (probe.grid.perX * Math.max(1, full.width / 1100)) / 20))
      if (img === full) continue
    }
    const t = Date.now()
    const rec = recognise(img, render)
    const ms = Date.now() - t
    const { order, legend } = CHARTS[key]
    const codes = order.split(' ')
    const area = findLegend(img, rec)
    const swatches = area ? findLegendSwatches(img, area, rec.grid.perX) : []
    let swatchScore = 'n/a'
    if (swatches.length === codes.length) {
      const counts = new Map<string, number>()
      rec.assign.forEach((g, i) => {
        if (g < 0) return
        const f = rec.cells.fill.subarray(i * 3, i * 3 + 3)
        let best = 0
        let bd = Infinity
        swatches.forEach((s, k) => {
          const d = Math.abs(f[0] - s.colour.r) + Math.abs(f[1] - s.colour.g) + Math.abs(f[2] - s.colour.b)
          if (d < bd) {
            bd = d
            best = k
          }
        })
        counts.set(codes[best], (counts.get(codes[best]) ?? 0) + 1)
      })
      swatchScore = `${agreement(counts, legend).toFixed(2)}%`
    }
    console.log(
      `${key.padEnd(9)} ${which.padEnd(11)} ${mode.padEnd(10)} ${full.width}x${full.height}->${img.width}x${img.height} cell ${rec.grid.perX.toFixed(1)}px board ${rec.cells.cols}x${rec.cells.rows} ${String(ms).padStart(5)}ms | label ${agreement(countByCode(rec), legend).toFixed(2)}% (${rec.groups.length} codes) | swatches found ${swatches.length}/${codes.length}, colour-match ${swatchScore}`,
    )
    }
  }
}
