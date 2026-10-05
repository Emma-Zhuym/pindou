// The app icon, crayon-drawn in code: a pegboard with a pixel heart in beads. Every mark is
// hatched with short, half-transparent crayon strokes and broken by paper grain, the way wax skips
// on paper. Run from app/:  npx tsx tools/crayon-icon.ts
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const jit = (a: number) => (rnd() - 0.5) * 2 * a

const S = 1024
const PAPER = '#fbf4e6'
const ART = ['.AA.AA.', 'ABBABBA', 'ABCBBBA', '.ABBBA.', '..ABA..', '...A...']
const COL: Record<string, string> = { A: '#e04f45', B: '#f4867c', C: '#ffe9a8' }

function rgb(hex: string, k = 0) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))
  return `rgb(${c.join(',')})`
}

/** hatch the current clip with crayon strokes at an angle */
function hatch(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, colour: string, angle: number, gap: number, width: number, alpha: number) {
  const d = Math.hypot(w, h)
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.lineCap = 'round'
  for (let t = -d / 2; t < d / 2; t += gap * (0.6 + rnd() * 0.8)) {
    const a = angle + jit(0.08)
    const nx = Math.cos(a + Math.PI / 2) * t
    const ny = Math.sin(a + Math.PI / 2) * t
    // each line is a few short strokes, so it breaks up like crayon
    let s = -d / 2
    while (s < d / 2) {
      const len = 20 + rnd() * 60
      ctx.globalAlpha = alpha * (0.5 + rnd() * 0.8)
      ctx.strokeStyle = colour
      ctx.lineWidth = width * (0.6 + rnd() * 0.8)
      ctx.beginPath()
      ctx.moveTo(cx + nx + Math.cos(a) * s + jit(1.5), cy + ny + Math.sin(a) * s + jit(1.5))
      ctx.lineTo(cx + nx + Math.cos(a) * (s + len) + jit(1.5), cy + ny + Math.sin(a) * (s + len) + jit(1.5))
      ctx.stroke()
      s += len + rnd() * 6
    }
  }
}

/** paper specks inside the current clip */
function specks(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, n: number) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.35 + rnd() * 0.5
    ctx.fillStyle = PAPER
    const s = 1 + rnd() * 2.5
    ctx.fillRect(x + rnd() * w, y + rnd() * h, s, s * (0.6 + rnd()))
  }
}

/** a wobbly, broken crayon line round a circle */
function wobblyCircle(ctx: SKRSContext2D, cx: number, cy: number, r: number, colour: string, width: number) {
  ctx.strokeStyle = colour
  ctx.lineCap = 'round'
  for (let pass = 0; pass < 2; pass++) {
    let a = rnd() * Math.PI * 2
    const end = a + Math.PI * 2 + 0.3
    while (a < end) {
      const span = 0.5 + rnd() * 0.9
      ctx.globalAlpha = 0.45 + rnd() * 0.3
      ctx.lineWidth = width * (0.7 + rnd() * 0.6)
      ctx.beginPath()
      for (let b = a; b <= a + span; b += 0.08) {
        const rr = r + jit(r * 0.03)
        const px = cx + Math.cos(b) * rr
        const py = cy + Math.sin(b) * rr
        if (b === a) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      a += span + rnd() * 0.12
    }
  }
}

function bead(ctx: SKRSContext2D, cx: number, cy: number, r: number, colour: string) {
  const hole = r * 0.36
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.arc(cx, cy, hole, 0, Math.PI * 2, true)
  ctx.clip('evenodd')
  // paper under the bead, so the board's blue does not show through
  ctx.globalAlpha = 1
  ctx.fillStyle = PAPER
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)
  hatch(ctx, cx - r, cy - r, 2 * r, 2 * r, rgb(colour), -0.6, 4, 7, 0.6)
  hatch(ctx, cx - r, cy - r, 2 * r, 2 * r, rgb(colour, -0.12), 0.9, 9, 6, 0.3)
  // a lighter crescent where the light falls
  ctx.beginPath()
  ctx.arc(cx - r * 0.25, cy - r * 0.3, r * 0.35, 0, Math.PI * 2)
  ctx.save()
  ctx.clip()
  hatch(ctx, cx - r, cy - r, 2 * r, 2 * r, '#ffffff', -0.6, 7, 5, 0.35)
  ctx.restore()
  specks(ctx, cx - r, cy - r, 2 * r, 2 * r, 220)
  ctx.restore()
  wobblyCircle(ctx, cx, cy, r, rgb(colour, -0.4), r * 0.09)
  wobblyCircle(ctx, cx, cy, hole, rgb(colour, -0.35), r * 0.06)
}

function roundRect(ctx: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, r: number, j = 0) {
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0)
  ctx.lineTo(x1 - r, y0 + jit(j))
  ctx.quadraticCurveTo(x1 + jit(j), y0 + jit(j), x1 + jit(j), y0 + r)
  ctx.lineTo(x1 + jit(j), y1 - r)
  ctx.quadraticCurveTo(x1 + jit(j), y1 + jit(j), x1 - r, y1 + jit(j))
  ctx.lineTo(x0 + r, y1 + jit(j))
  ctx.quadraticCurveTo(x0 + jit(j), y1 + jit(j), x0 + jit(j), y1 - r)
  ctx.lineTo(x0 + jit(j), y0 + r)
  ctx.quadraticCurveTo(x0 + jit(j), y0 + jit(j), x0 + r, y0)
  ctx.closePath()
}

const c = createCanvas(S, S)
const ctx = c.getContext('2d')
ctx.fillStyle = PAPER
ctx.fillRect(0, 0, S, S)
// paper tooth
for (let i = 0; i < 9000; i++) {
  ctx.globalAlpha = 0.05 + rnd() * 0.08
  ctx.fillStyle = '#c9b89a'
  ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2)
}
// the pegboard, crayoned pale blue
const pad = 64
ctx.save()
roundRect(ctx, pad, pad, S - pad, S - pad, 110)
ctx.clip()
hatch(ctx, 0, 0, S, S, '#a9c9ea', -0.6, 8, 9, 0.26)
specks(ctx, 0, 0, S, S, 9000)
ctx.restore()
for (let k = 0; k < 3; k++) {
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = '#6f9ccc'
  ctx.lineWidth = 8 + rnd() * 4
  roundRect(ctx, pad, pad, S - pad, S - pad, 110, 4)
  ctx.stroke()
}
// pegs and beads
const cols = 7
const rows = 6
const step = (S - 2 * pad - 70) / cols
const ox = pad + 35 + step / 2
const oy = S / 2 - ((rows - 1) * step) / 2 + step * 0.05
ART.forEach((row, r) =>
  [...row].forEach((ch, k) => {
    const cx = ox + k * step + jit(4)
    const cy = oy + r * step + jit(4)
    if (ch === '.') {
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#7f9fc2'
      ctx.beginPath()
      ctx.arc(cx, cy, step * 0.08, 0, Math.PI * 2)
      ctx.fill()
    } else bead(ctx, cx, cy, step * 0.46, COL[ch])
  }),
)
// the app icons, from the one 1024px drawing
writeFileSync('tools/icon-1024.png', c.toBuffer('image/png'))
for (const [size, file] of [
  [512, 'public/icon-512.png'],
  [192, 'public/icon-192.png'],
  [180, 'public/apple-touch-icon.png'],
  [64, 'public/favicon.png'],
] as const) {
  const small = createCanvas(size, size)
  const sctx = small.getContext('2d')
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(c, 0, 0, size, size)
  writeFileSync(file, small.toBuffer('image/png'))
}
