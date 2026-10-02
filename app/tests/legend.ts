import { createCanvas } from '@napi-rs/canvas'
import { findLegend } from '../src/engine/legendArea'
import { recognise } from '../src/engine/recognize'
import type { TextRenderer } from '../src/engine/glyphs'
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
  ctx.fillText(text, (box * SS - m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 + m.actualBoundingBoxLeft, (box * SS - m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, box * SS, box * SS).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < box * SS; y++) for (let x = 0; x < box * SS; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS)
  return out
}
for (const key of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) {
  const img = loadSample(key)
  const rec = recognise(img, render)
  console.log(key, `image ${img.width}x${img.height}`, 'legend', JSON.stringify(findLegend(img, rec)))
}
