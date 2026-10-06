// Building a truth (samples/truth/<chart>.json: the printed code of every readable cell), by eye:
//   1. truth1.ts <chart>        one typical print per legend code -> sheet seed-<chart>.png; read it,
//                               and note in truth2.ts FIX the rows whose cells print another code
//   2. truth2.ts <chart>        templates from the seeds classify every cell; sheets check-<chart>.png
//                               (each code's least sure cells) and odd-<chart>.png (the rest, grouped)
//   3. name.ts <chart> "0:C23 2:#" names whole odd groups (# = not a bead); cells.ts <chart> show /
//                               apply "A23 G18 -" goes one cell at a time; pair.ts <chart> A B (with
//                               BY_COLOUR=1 or REF=1) ranks A's cells by likeness to B, fixed with fix.ts
//   4. repeat 2-3; tally.ts compares with the printed legend; copy research/out/truth-work/<chart>-truth.json
//      to samples/truth/; map.ts carries a truth to another image of the same chart (phone, mirrored)
// Sheets go to research/out/truth-work/sheets. Codes alike in print and colour (C12/C18, G11/G12)
// need pair.ts: a group's first ten tiles do not show them.
//
// This step: one typical print per legend code (largest print cluster among the cells coloured as it).
import { writeFileSync } from 'node:fs'
import { applyReading, fitList, readLocally } from '../../src/engine/legendRead'
import { recognise } from '../../src/engine/recognize'
import { FILES, list, load, render, sheet, exists, path } from './harness'
import { centre, features, kmeans, mergeClusters } from './print'
const only = process.argv.slice(2)
for (const [name, key, file] of FILES) {
  if ((only.length && !only.includes(name)) || !exists(file)) continue
  const img = load(file); const rec = recognise(img, render); const L = list(key)
  const r = applyReading(rec, fitList(rec, L, readLocally(img, rec, render), render))
  const beads: number[] = []; r.assign.forEach((g, i) => { if (g >= 0 && rec.cells.share[i] > 0.06) beads.push(i) })
  const X = features(rec.cells.ink, beads); centre(X, beads.length); const D = X.length / beads.length
  const picks: { i: number; text: string }[] = []
  const seeds: Record<string, number[]> = {}
  L.forEach((e, row) => {
    const g = r.groups.findIndex((x) => x.code === e.code)
    const js = beads.map((_, j) => j).filter((j) => r.assign[beads[j]] === g)
    let core: number[] = []
    if (js.length) {
      const sub = new Float32Array(js.length * D); js.forEach((j, q) => sub.set(X.subarray(j * D, j * D + D), q * D))
      const k0 = Math.min(js.length, 4)
      const m = mergeClusters(sub, js.length, kmeans(sub, js.length, k0).lab, k0, 0.9)
      const sizes = new Array(m.k).fill(0); m.lab.forEach((c) => sizes[c]++)
      const big = sizes.indexOf(Math.max(...sizes))
      const members = js.map((j, q) => ({ j, q })).filter(({ q }) => m.lab[q] === big).sort((a, b) => m.sim[b.q] - m.sim[a.q])
      core = members.slice(0, Math.max(1, Math.ceil(members.length / 2))).map(({ j }) => beads[j])
    }
    seeds[e.code] = core
    const shown = Array.from({ length: Math.min(9, core.length) }, (_, q) => core[Math.floor((q * core.length) / Math.min(9, core.length))])
    shown.forEach((i, t) => picks.push({ i, text: t === 0 ? `${row} ${e.code} ${js.length}/${e.count}` : '' }))
    while (picks.length % 9) picks.push({ i: shown[0] ?? 0, text: shown.length ? '·' : `${row} ${e.code} none` })
  })
  sheet(`seed-${name}`, img, rec, picks, 9, 52)
  writeFileSync(path(`research/out/truth-work/${name}-seeds.json`), JSON.stringify(seeds))
  console.log(name, 'ok')
}
