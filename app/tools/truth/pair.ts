// scratch: cells truth-labelled A that look most like B:  _pair.ts <chart> A B
import { readFileSync, writeFileSync } from 'node:fs'
import { recognise } from '../../src/engine/recognize'
import { FILES, load, render, sheet, path } from './harness'
import { features } from './print'
const [name, A, B] = process.argv.slice(2)
const [, , file] = FILES.find(([n]) => n === name)!
const img = load(file); const rec = recognise(img, render)
const t: (string | null)[] = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-truth.json`), 'utf8')).truth
const ia = t.map((c, i) => (c === A ? i : -1)).filter((i) => i >= 0), ib = t.map((c, i) => (c === B ? i : -1)).filter((i) => i >= 0)
const fa = features(rec.cells.ink, ia), fb = features(rec.cells.ink, ib); const D = fa.length / ia.length
const mean = (f: Float32Array, n: number) => { const m = new Float32Array(D); for (let j = 0; j < n; j++) for (let d = 0; d < D; d++) m[d] += f[j * D + d]; return m }
let ma = mean(fa, ia.length), mb = mean(fb, ib.length)
if (process.env.REF) {
  // reference prints from cells named one by one
  const ex: Record<string, number[]> = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-extra.json`), 'utf8'))
  const ra = ex[A].filter((i) => t[i] === A), rb = ex[B].filter((i) => t[i] === B)
  ma = mean(features(rec.cells.ink, ra), ra.length); mb = mean(features(rec.cells.ink, rb), rb.length)
  console.log('refs', ra.length, rb.length)
}
const nrm = (m: Float32Array) => { let q = 0; for (const v of m) q += v * v; q = Math.sqrt(q); return m.map((v) => v / q) }
const na = nrm(ma), nb = nrm(mb)
const fillMed = (is: number[]) => [0, 1, 2].map((ch) => is.map((i) => rec.cells.fill[i * 3 + ch]).sort((a, b) => a - b)[is.length >> 1])
const ca = fillMed(ia), cb = fillMed(ib)
const cdist = (i: number, c: number[]) => Math.abs(rec.cells.fill[i * 3] - c[0]) + Math.abs(rec.cells.fill[i * 3 + 1] - c[1]) + Math.abs(rec.cells.fill[i * 3 + 2] - c[2])
console.log('colours', ca, cb)
const score0 = ia.map((i, j) => { let sa = 0, sb = 0; for (let d = 0; d < D; d++) { sa += fa[j * D + d] * na[d]; sb += fa[j * D + d] * nb[d] } return { i, s: sb - sa } }).sort((x, y) => y.s - x.s)
const hist = new Array(12).fill(0); score0.forEach((x) => hist[Math.max(0, Math.min(11, Math.floor((x.s + 0.3) * 20)))]++)
console.log('hist from -0.30 by 0.05:', hist.join(' '))
const at = Number(process.env.AT ?? 9)
const near = [...score0].sort((x, y) => Math.abs(x.s - at) - Math.abs(y.s - at))
const score = process.env.AT ? near : process.env.BY_COLOUR ? ia.map((i) => ({ i, s: cdist(i, ca) - cdist(i, cb) })).sort((x, y) => y.s - x.s) : score0
sheet(`pair-${name}-${A}-${B}`, img, rec, score.slice(0, 60).map((x, k) => ({ i: x.i, text: `${k} ${x.s.toFixed(2)}` })), 12, 48)
writeFileSync(path('research/out/truth-work/pair.json'), JSON.stringify({ name, cells: score.slice(0, 60).map((x) => x.i) }))
console.log(ia.length, ib.length)
