// Is the found grid on the lines? Line strength at the found positions vs half a cell off, per axis
// (on lines: well above 1). With --sheet, a crop of the board with the found lines drawn.
//   npx tsx tools/truth/gridcheck.ts <image> [...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import { findBoard, findGrid, type Raster } from '../../src/engine/grid'
import { OUT } from './harness'
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const draw = process.argv.includes('--sheet')
const load = (f: string): Raster => {
  const d = jpeg.decode(readFileSync(f), { useTArray: true, maxMemoryUsageInMB: 8192 })
  return { width: d.width, height: d.height, data: d.data }
}
for (const f of files) {
  let img: Raster
  try { img = load(f) } catch { console.log(`${f}: not a jpeg`); continue }
  const g = findGrid(img)
  const b = findBoard(img, g)
  const { width: W, height: H, data } = img
  // edge strength along a line of the board, between cells
  const rowEdge = (y: number) => { const yi = Math.round(y); if (yi < 1 || yi >= H - 1) return 0; let s = 0; const x0 = Math.round(g.offX + b.c0 * g.perX), x1 = Math.round(g.offX + (b.c0 + b.cols) * g.perX); for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { const i = (yi * W + x) * 4; s += Math.abs(data[i] - data[i - W * 4]) + Math.abs(data[i] - data[i + W * 4]) } return s }
  const colEdge = (x: number) => { const xi = Math.round(x); if (xi < 1 || xi >= W - 1) return 0; let s = 0; const y0 = Math.round(g.offY + b.r0 * g.perY), y1 = Math.round(g.offY + (b.r0 + b.rows) * g.perY); for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) { const i = (y * W + xi) * 4; s += Math.abs(data[i] - data[i - 4]) + Math.abs(data[i] - data[i + 4]) } return s }
  // darkness along the line (lines are drawn, edges also come from print)
  const ratio = (edge: (v: number) => number, off: number, per: number, k0: number, n: number) => {
    let on = 0, half = 0
    for (let k = k0; k <= k0 + n; k++) { on += edge(off + k * per); half += edge(off + (k + 0.5) * per) }
    return on / (half || 1)
  }
  const ry = ratio(rowEdge, g.offY, g.perY, b.r0, b.rows)
  const rx = ratio(colEdge, g.offX, g.perX, b.c0, b.cols)
  console.log(`${f.split('/').slice(-2).join('/').padEnd(40)} ${W}x${H} cell ${g.perX.toFixed(2)}x${g.perY.toFixed(2)} board ${b.cols}x${b.rows} | columns on-line ${rx.toFixed(2)} rows on-line ${ry.toFixed(2)}${ry < 1.2 || rx < 1.2 ? '  <-- check' : ''}`)
  if (draw) {
    const cw = Math.min(W, Math.round(g.perX * 6)), ch = Math.min(H, Math.round(g.perY * 6))
    const sx = Math.round(g.offX + (b.c0 + Math.floor(b.cols / 2) - 6) * g.perX), sy = Math.round(g.offY + (b.r0 + Math.floor(b.rows / 2) - 6) * g.perY)
    const c = createCanvas(cw, ch); const ctx = c.getContext('2d')
    const id = ctx.createImageData(cw, ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = ((sy + y) * W + sx + x) * 4, di = (y * cw + x) * 4; for (let q = 0; q < 4; q++) id.data[di + q] = data[si + q] ?? 0; id.data[di + 3] = 255 }
    ctx.putImageData(id, 0, 0)
    ctx.strokeStyle = 'rgba(0,200,255,0.9)'; ctx.lineWidth = 1
    for (let k = -1; k < 14; k++) { const x = g.offX + k * g.perX - (sx - Math.floor((sx - g.offX) / g.perX) * g.perX - g.offX) ; void x }
    for (let k = Math.floor((sx - g.offX) / g.perX); g.offX + k * g.perX < sx + cw; k++) { const x = g.offX + k * g.perX - sx; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke() }
    ctx.strokeStyle = 'rgba(255,0,180,0.9)'
    for (let k = Math.floor((sy - g.offY) / g.perY); g.offY + k * g.perY < sy + ch; k++) { const y = g.offY + k * g.perY - sy; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke() }
    const zoom = Math.max(1, Math.floor(600 / cw))
    const z = createCanvas(cw * zoom, ch * zoom); const zc = z.getContext('2d'); zc.imageSmoothingEnabled = false; zc.drawImage(c, 0, 0, cw * zoom, ch * zoom)
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/grid-${f.split('/').pop()}.png`, z.toBuffer('image/png'))
  }
}
