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

/**
 * A rounded rectangle drawn in pencil, as a PNG for border-image's nine slices: each pass is
 * graphite grain laid along the outline, heavier and lighter as the hand presses, and the two
 * passes start in different places and overrun their ends, so joins and corners never quite meet.
 * `S` is the drawn size in CSS pixels (the PNG is twice that), `R` the corner radius.
 */
function frame(file: string, S: number, R: number, width: number) {
  const K = 2
  const c = createCanvas(S * K, S * K)
  const ctx = c.getContext('2d')
  const m = width * 1.6 + 1
  // the outline as points, a little wobbly
  const outline = (j: number) => {
    j *= 1.6
    const pts: [number, number][] = []
    const side = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6)
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n + jit(j), y0 + ((y1 - y0) * k) / n + jit(j)])
    }
    const arc = (cx: number, cy: number, a0: number) => {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k / 8) * (Math.PI / 2)
        pts.push([cx + Math.cos(a) * R + jit(j * 0.6), cy + Math.sin(a) * R + jit(j * 0.6)])
      }
    }
    side(m + R, m, S - m - R, m)
    arc(S - m - R, m + R, -Math.PI / 2)
    side(S - m, m + R, S - m, S - m - R)
    arc(S - m - R, S - m - R, 0)
    side(S - m - R, S - m, m + R, S - m)
    arc(m + R, S - m - R, Math.PI / 2)
    side(m, S - m - R, m, m + R)
    arc(m + R, m + R, Math.PI)
    return pts
  }
  const pass = (pts: [number, number][], start: number, overrun: number, weight: number, alpha: number) => {
    const n = pts.length
    const steps = n + overrun
    let phase = rnd() * 10
    for (let k = 0; k < steps; k++) {
      const [x0, y0] = pts[(start + k) % n]
      const [x1, y1] = pts[(start + k + 1) % n]
      const len = Math.hypot(x1 - x0, y1 - y0)
      // lighter where the stroke starts and lifts off
      const ends = Math.min(1, k / 4, (steps - k) / 4)
      for (let t = 0; t < len; t += 0.35) {
        phase += 0.035
        const press = (0.65 + 0.35 * Math.sin(phase) + jit(0.12)) * ends
        const x = x0 + ((x1 - x0) * t) / len
        const y = y0 + ((y1 - y0) * t) / len
        const r = width * 0.5 * (0.55 + 0.45 * press)
        // graphite: a few grains across the line, not a solid fill
        for (let g = 0; g < 4; g++) {
          ctx.fillStyle = `rgba(58,47,39,${Math.max(0, alpha * press * (0.35 + rnd() * 0.65))})`
          ctx.fillRect((x + jit(r)) * K, (y + jit(r)) * K, K * (0.5 + rnd() * 0.7), K * (0.5 + rnd() * 0.7))
        }
      }
    }
  }
  const a = outline(S / 160)
  pass(a, Math.floor(rnd() * a.length), 3, width, 0.75)
  const b = outline(S / 110)
  pass(b, Math.floor(rnd() * b.length), 2, width * 0.75, 0.4)
  writeFileSync(file, c.toBuffer('image/png'))
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
frame('src/paper/pencil.png', 120, 20, 2.4) // cards: sliced at 2 × 24 into 10px edges
frame('src/paper/pencil-small.png', 48, 10, 2.1) // buttons and chips: sliced at 2 × 14 into 6px edges
crayon('src/paper/highlight.png', 360, 72, [244, 200, 90], 0.2) // chosen: yellow crayon
crayon('src/paper/caramel.png', 360, 96, [192, 132, 66], 0.3) // main button: caramel crayon
