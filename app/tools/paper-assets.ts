// The paper look's textures, drawn in code: a fibrous paper tile (seamless), a pencil-drawn frame
// for cards (a nine-slice SVG), and crayon strokes for what is chosen and for the main button.
// Run from app/:  npx tsx tools/paper-assets.ts
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

let seed = 20261005
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const jit = (a: number) => (rnd() - 0.5) * 2 * a

// ------------------------------------------------------------------ paper

const T = 640 // tile side; drawn wrapping round so it repeats without seams
function paper() {
  const c = createCanvas(T, T)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f2efe8'
  ctx.fillRect(0, 0, T, T)
  // copies of a mark at the tile's edges, so it carries across the seam
  const wrap = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) draw(dx, dy)
  }
  // mottling: big soft blotches a shade lighter or darker
  for (let i = 0; i < 46; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const r = 40 + rnd() * 120
    const light = rnd() < 0.5
    wrap((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      g.addColorStop(0, light ? 'rgba(255,255,255,0.1)' : 'rgba(150,125,90,0.018)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r)
    })
  }
  // fine grain
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.08 + rnd() * 0.16})` : `rgba(90,75,55,${0.02 + rnd() * 0.04})`
    ctx.fillRect(rnd() * T, rnd() * T, 1, 1)
  }
  // fibres: short curling strands, most pale, some a little darker
  ctx.lineCap = 'round'
  for (let i = 0; i < 260; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const len = 4 + rnd() * 16
    const a = rnd() * Math.PI * 2
    const bend = jit(1.4)
    const dark = rnd() < 0.45
    const colour = dark ? `rgba(120,100,72,${0.04 + rnd() * 0.06})` : `rgba(255,255,255,${0.12 + rnd() * 0.18})`
    const width = 0.4 + rnd() * 0.7
    wrap((dx, dy) => {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x + dx, y + dy)
      const mx = x + dx + Math.cos(a) * len * 0.5 + Math.cos(a + Math.PI / 2) * bend * 6
      const my = y + dy + Math.sin(a) * len * 0.5 + Math.sin(a + Math.PI / 2) * bend * 6
      ctx.quadraticCurveTo(mx, my, x + dx + Math.cos(a + bend * 0.4) * len, y + dy + Math.sin(a + bend * 0.4) * len)
      ctx.stroke()
    })
  }
  // specks: tiny dark flecks of pulp
  for (let i = 0; i < 110; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const r = 0.35 + rnd() * 0.9
    const alpha = 0.1 + rnd() * 0.3
    wrap((dx, dy) => {
      ctx.fillStyle = `rgba(80,66,48,${alpha})`
      ctx.beginPath()
      ctx.ellipse(x + dx, y + dy, r * (1 + rnd()), r, rnd() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  writeFileSync('src/paper/paper.jpg', c.toBuffer('image/jpeg', 86))
}

// ------------------------------------------------------------------ pencil frame

/** A rounded rectangle gone over twice in pencil, as SVG: stretched by border-image's nine slices. */
function frame(file: string, S: number, R: number, width: number) {
  const path = (j: number) => {
    const p = (x: number, y: number) => `${(x + jit(j)).toFixed(1)} ${(y + jit(j)).toFixed(1)}`
    const m = Math.max(2, S / 30)
    return (
      `M${p(m + R, m)} L${p(S / 2, m)} L${p(S - m - R, m)} Q${p(S - m, m)} ${p(S - m, m + R)} L${p(S - m, S / 2)} L${p(S - m, S - m - R)} ` +
      `Q${p(S - m, S - m)} ${p(S - m - R, S - m)} L${p(S / 2, S - m)} L${p(m + R, S - m)} Q${p(m, S - m)} ${p(m, S - m - R)} L${p(m, S / 2)} L${p(m, m + R)} Q${p(m, m)} ${p(m + R + jit(2), m + jit(1))}`
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g fill="none" stroke="#3a2f27" stroke-linecap="round" stroke-linejoin="round"><path d="${path(S / 150)}" stroke-width="${width}" opacity="0.55"/><path d="${path(S / 100)}" stroke-width="${width * 0.6}" opacity="0.3"/></g></svg>\n`
  writeFileSync(file, svg)
}

// ------------------------------------------------------------------ crayon strokes

/** A crayon swipe filling most of a W×H box: dense short strokes, paper showing through. */
function crayon(file: string, w: number, h: number, rgb: [number, number, number], density: number) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.lineCap = 'round'
  const pad = h * 0.08
  // inside a capsule whose rim wobbles: round ends, as a crayon swipe has
  const r = h / 2 - pad
  const inside = (x: number, y: number) => {
    const cx = Math.min(Math.max(x, pad + r), w - pad - r)
    const d = Math.hypot(x - cx, y - h / 2)
    return d < r * (0.88 + 0.12 * Math.sin(x * 0.09) * Math.cos(y * 0.13)) + jit(2)
  }
  for (let i = 0; i < density * w * h; i++) {
    const x = pad + rnd() * (w - 2 * pad)
    const y = pad + rnd() * (h - 2 * pad)
    if (!inside(x, y)) continue
    const a = 0.08 + rnd() * 0.18
    const len = h * (0.15 + rnd() * 0.35)
    const ang = -1.1 + jit(0.25)
    if (!inside(x + Math.cos(ang) * len, y + Math.sin(ang) * len)) continue
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`
    ctx.lineWidth = 1 + rnd() * 2.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  // wax skipping on the tooth
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 3; i < img.data.length; i += 4) if (rnd() < 0.12) img.data[i] = Math.round(img.data[i] * 0.3)
  ctx.putImageData(img, 0, 0)
  writeFileSync(file, c.toBuffer('image/png'))
}

paper()
frame('src/paper/pencil.svg', 120, 22, 1.5) // cards, sliced at 30 into 12px edges
frame('src/paper/pencil-small.svg', 40, 9, 1.8) // buttons and chips, sliced at 12 into 8px edges
crayon('src/paper/highlight.png', 360, 72, [244, 200, 90], 0.2) // chosen: yellow crayon
crayon('src/paper/caramel.png', 360, 96, [192, 132, 66], 0.3) // main button: caramel crayon
