// scratch: confirmed seeds -> templates (print + colour) -> every cell classified; the unexplained ones as sheets to name
import { readFileSync, writeFileSync } from 'node:fs'
import { clusterByFill } from '../../src/engine/cells'
import { recognise } from '../../src/engine/recognize'
import { FILES, load, render, sheet, exists, path } from './harness'
import { centre, features, kmeans, mergeClusters } from './print'
// seed row (as named by colour) -> the code its cells actually print ('#' = not a bead)
export const FIX: Record<string, Record<string, string>> = {
  'hug-big': { A12: 'F23', A23: 'G18', C27: 'A23', G11: 'A12', G18: 'A23', H3: 'H7' },
  hogwarts: { G14: 'M15', M15: 'G14', H13: '#' },
  landscape: { B21: 'B12' },
  'pool-b': { C20: 'C24', G21: 'G5', M3: 'H4' },
}
const only = process.argv.slice(2)
for (const [name, , file] of FILES) {
  if ((only.length && !only.includes(name)) || !exists(file) || !exists(`research/out/truth-work/${name}-seeds.json`)) continue
  const img = load(file); const rec = recognise(img, render)
  const raw: Record<string, number[]> = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-seeds.json`), 'utf8'))
  const extra: Record<string, number[]> = exists(`research/out/truth-work/${name}-extra.json`) ? JSON.parse(readFileSync(path(`research/out/truth-work/${name}-extra.json`), 'utf8')) : {}
  const seeds = new Map<string, number[]>()
  for (const [row, cells] of [...Object.entries(raw), ...Object.entries(extra)]) {
    if (!cells.length) continue
    const code = FIX[name]?.[row] ?? row
    seeds.set(code, [...(seeds.get(code) ?? []), ...cells])
  }
  const n = rec.cells.rows * rec.cells.cols
  const beads: number[] = []; for (let i = 0; i < n; i++) if (!rec.empty[i] && rec.cells.share[i] > 0.06) beads.push(i)
  const X = features(rec.cells.ink, beads); if (process.env.CENTRE) centre(X, beads.length); const D = X.length / beads.length
  const at = new Map(beads.map((i, j) => [i, j]))
  const codes = [...seeds.keys()]
  const fillOf = (i: number) => [rec.cells.fill[i * 3], rec.cells.fill[i * 3 + 1], rec.cells.fill[i * 3 + 2]]
  // templates: up to 3 print variants per code, and the code's median colour; relearnt from accepted cells
  let members = codes.map((c) => seeds.get(c)!.filter((i) => at.has(i)))
  let truth: (string | null)[] = []
  let odd: number[] = []
  const tally = new Map<string, number>()
  const psim = new Float32Array(n)
  for (let round = 0; round < 3; round++) {
    const temps: { k: number; v: Float32Array }[] = []
    const col = members.map((ms) => { const fs = ms.map(fillOf); return [0, 1, 2].map((ch) => fs.map((f) => f[ch]).sort((a, b) => a - b)[fs.length >> 1] ?? 0) })
    members.forEach((ms, k) => {
      if (!ms.length) return
      const sub = new Float32Array(ms.length * D); ms.forEach((i, t) => { const j = at.get(i)!; sub.set(X.subarray(j * D, j * D + D), t * D) })
      const kk = Math.min(3, ms.length)
      const m = mergeClusters(sub, ms.length, kmeans(sub, ms.length, kk).lab, kk, 0.97)
      const sizes = new Array(m.k).fill(0); m.lab.forEach((c) => sizes[c]++)
      const main = sizes.indexOf(Math.max(...sizes))
      // a variant must look like the main print: another code hiding in this one's cells does not
      for (let q = 0; q < m.k; q++) {
        let s = 0; for (let d = 0; d < D; d++) s += m.C[q * D + d] * m.C[main * D + d]
        if (q === main || s >= 0.9) temps.push({ k, v: m.C.slice(q * D, q * D + D) })
      }
    })
    truth = new Array(n).fill('')
    odd = []
    tally.clear()
    const next: number[][] = codes.map(() => [])
    const bestPer = new Float32Array(codes.length)
    const printPer = new Float32Array(codes.length)
    // how alike the codes' main prints are, for the margin
    const mainOf = members.map(() => -1); temps.forEach((t, q) => { if (mainOf[t.k] < 0) mainOf[t.k] = q })
    const cosT = (a: number, b: number) => { if (mainOf[a] < 0 || mainOf[b] < 0) return 0; let s = 0; for (let d = 0; d < D; d++) s += temps[mainOf[a]].v[d] * temps[mainOf[b]].v[d]; return s }
    beads.forEach((i, j) => {
      bestPer.fill(-9); printPer.fill(-9)
      const f = fillOf(i)
      for (const t of temps) {
        let s = 0; for (let d = 0; d < D; d++) s += X[j * D + d] * t.v[d]
        const cd = Math.abs(f[0] - col[t.k][0]) + Math.abs(f[1] - col[t.k][1]) + Math.abs(f[2] - col[t.k][2])
        const sc = s - cd / 600
        if (sc > bestPer[t.k]) { bestPer[t.k] = sc; printPer[t.k] = s }
      }
      let b = 0; for (let k = 1; k < codes.length; k++) if (bestPer[k] > bestPer[b]) b = k
      // where the cell sits between the best code and each other one: 1 = on the best, 0 = halfway
      let worst = 9
      for (let k = 0; k < codes.length; k++) if (k !== b && bestPer[k] > -9) worst = Math.min(worst, (bestPer[b] - bestPer[k]) / Math.max(0.02, 1 - cosT(b, k)))
      const cd = Math.abs(f[0] - col[b][0]) + Math.abs(f[1] - col[b][1]) + Math.abs(f[2] - col[b][2])
      if (printPer[b] < 0.85 || cd > 80 || worst < 0.3) { odd.push(i); truth[i] = null; return }
      psim[i] = printPer[b]; truth[i] = codes[b]; tally.set(codes[b], (tally.get(codes[b]) ?? 0) + 1); next[b].push(i)
    })
    members = next.map((ms, k) => (ms.length ? ms : members[k]))
  }
  {
    const picks: { i: number; text: string }[] = []
    members.forEach((ms, k) => {
      const sorted = [...ms].sort((a, b) => psim[a] - psim[b])
      const shown = [...new Set([...sorted.slice(0, 7), ...[0.3, 0.6, 0.9].map((f) => sorted[Math.floor(f * (sorted.length - 1))])])].filter((x) => x !== undefined)
      shown.forEach((i, t) => picks.push({ i, text: t === 0 ? `${codes[k]} ${ms.length}` : psim[i].toFixed(2) }))
      while (picks.length % 10) picks.push({ i: shown[0], text: '·' })
    })
    sheet(`check-${name}`, img, rec, picks, 10, 52)
  }
  // cells named by eye are truth whatever the templates say
  for (const [code, cells] of Object.entries(extra)) for (const i of cells) { if (truth[i] === null) odd.splice(odd.indexOf(i), 1); truth[i] = code === '#' ? '' : code }
  // the unexplained: colour, then print, clusters to name by eye
  const fill = new Float32Array(odd.length * 3); odd.forEach((i, q) => fill.set(rec.cells.fill.subarray(i * 3, i * 3 + 3), q * 3))
  const byColour = clusterByFill(fill, 40)
  const groups: number[][] = []
  byColour.count.forEach((_, c) => {
    const qs = odd.map((_, q) => q).filter((q) => byColour.label[q] === c)
    if (qs.length < 6) { groups.push(qs); return }
    const sub = new Float32Array(qs.length * D); qs.forEach((q, t) => { const j = at.get(odd[q])!; sub.set(X.subarray(j * D, j * D + D), t * D) })
    const k0 = Math.min(qs.length, Math.ceil(qs.length / 30) + 2)
    const m = mergeClusters(sub, qs.length, kmeans(sub, qs.length, k0).lab, k0, 0.85)
    const base = groups.length; for (let t = 0; t < m.k; t++) groups.push([])
    qs.forEach((q, t) => groups[base + m.lab[t]].push(q))
  })
  groups.sort((a, b) => b.length - a.length)
  const picks: { i: number; text: string }[] = []
  const list = groups.map((g) => g.map((q) => odd[q]))
  list.forEach((g, id) => {
    const shown = g.slice(0, 10)
    shown.forEach((i, t) => picks.push({ i, text: t === 0 ? `#${id} n=${g.length}` : '' }))
    while (picks.length % 10) picks.push({ i: shown[0], text: '·' })
  })
  if (picks.length) sheet(`odd-${name}`, img, rec, picks.slice(0, 400), 10, 52)
  writeFileSync(path(`research/out/truth-work/${name}-odd.json`), JSON.stringify(list))
  writeFileSync(path(`research/out/truth-work/${name}-truth.json`), JSON.stringify({ rows: rec.cells.rows, cols: rec.cells.cols, truth }))
  console.log(`${name}: ${beads.length} beads, ${odd.length} unexplained in ${list.length} groups | ${[...tally].sort().map(([c, k]) => `${c}:${k}`).join(' ')}`)
}
