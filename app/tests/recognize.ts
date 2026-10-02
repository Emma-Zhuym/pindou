// Scores the engine on the sample charts:  npx tsx tests/recognize.ts [sample...]
import { createCanvas } from '@napi-rs/canvas'
import type { TextRenderer } from '../src/engine/glyphs'
import { countByCode, recognise } from '../src/engine/recognize'
import { loadSample, SAMPLES } from './load'

const SS = 4
const render: TextRenderer = (text, font, size, box) => {
  const canvas = createCanvas(box * SS, box * SS)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, box * SS, box * SS)
  ctx.fillStyle = '#fff'
  ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))))
  const m = ctx.measureText(text)
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  ctx.fillText(text, (box * SS - w) / 2 + m.actualBoundingBoxLeft, (box * SS - h) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, box * SS, box * SS).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < box * SS; y++)
    for (let x = 0; x < box * SS; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS)
  return out
}

// legends read by hand from the charts; used for scoring only
const TRUTH: Record<string, { size: [number, number]; legend?: Record<string, number> }> = {
  tree: { size: [52, 64], legend: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 } },
  dog: { size: [104, 104], legend: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 } },
  landscape: { size: [84, 84], legend: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 } },
  portrait: { size: [50, 70] },
}

const pick = process.argv.slice(2).filter((a) => !a.startsWith('-'))
for (const key of (pick.length ? pick : Object.keys(SAMPLES)) as (keyof typeof SAMPLES)[]) {
  const t = Date.now()
  const rec = recognise(loadSample(key), render)
  const ms = Date.now() - t
  const found = countByCode(rec)
  const beads = [...found.values()].reduce((a, b) => a + b, 0)
  const { size, legend } = TRUTH[key]
  const sizeOk = rec.cells.cols === size[0] && rec.cells.rows === size[1]
  console.log(`== ${key}: board ${rec.cells.cols}x${rec.cells.rows} ${sizeOk ? 'ok' : 'EXPECTED ' + size.join('x')}, label fit ${rec.fit.score.toFixed(3)} (${rec.fit.font} ${rec.fit.size.toFixed(1)} blur ${rec.fit.blur} shift ${rec.fit.dx},${rec.fit.dy}), ${rec.groups.length} codes, ${beads} beads, ${rec.unsure.reduce((a, b) => a + b, 0)} unsure, ${ms}ms`)
  if (legend) {
    let off = 0
    const lines: string[] = []
    for (const c of new Set([...Object.keys(legend), ...found.keys()])) {
      const g = found.get(c) ?? 0
      const want = legend[c] ?? 0
      off += Math.abs(g - want)
      if (g !== want) lines.push(`${c} ${want}->${g}`)
    }
    const total = Object.values(legend).reduce((a, b) => a + b, 0)
    console.log(`   ${(100 * (1 - off / 2 / total)).toFixed(2)}% right by count (${off / 2} of ${total} off)`)
    if (process.argv.includes('-v')) console.log('   ' + lines.join('  '))
  } else {
    console.log('   ' + [...found].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join('  '))
  }
}
