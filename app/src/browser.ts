// Browser glue for the engine: canvas text rendering and image decoding.
import { INK } from './engine/cells'
import type { TextRenderer } from './engine/glyphs'
import type { Raster } from './engine/grid'

const SS = 4
let scratch: HTMLCanvasElement | null = null

export const renderText: TextRenderer = (text, font, size, box) => {
  scratch ??= document.createElement('canvas')
  const side = box * SS
  if (scratch.width !== side) scratch.width = scratch.height = side
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, side, side)
  ctx.fillStyle = '#fff'
  ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))))
  const m = ctx.measureText(text)
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  ctx.fillText(text, (side - w) / 2 + m.actualBoundingBoxLeft, (side - h) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, side, side).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * side + x) * 4] / (255 * SS * SS)
  return out
}

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

export function toRaster(img: HTMLImageElement): Raster {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: d.width, height: d.height, data: d.data }
}

/** Draw a stacked label (0..1 ink) as dark text on white. */
export function paintLabel(canvas: HTMLCanvasElement, label: Float32Array, px: number) {
  const small = document.createElement('canvas')
  small.width = small.height = INK
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(INK, INK)
  let max = 0
  const sorted = Array.from(label).sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1]
  for (const v of label) max = Math.max(max, v)
  for (let i = 0; i < label.length; i++) {
    const v = 255 - Math.round(Math.max(0, Math.min(1, (label[i] - med) / (max - med + 1e-6))) * 255)
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, px, px)
}
