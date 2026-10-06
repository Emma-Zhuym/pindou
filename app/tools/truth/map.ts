// scratch: carry a truth from one image of a chart to another image of the same chart (same board, maybe shifted)
import { readFileSync, writeFileSync } from 'node:fs'
import { recognise } from '../../src/engine/recognize'
import { FILES, load, render, path } from './harness'
for (const [to, from] of [['tree-phone', 'tree'], ['dog-phone', 'dog'], ['landscape-phone', 'landscape'], ['hug', 'hug-big']]) {
  const fa = FILES.find(([n]) => n === from)![2], fb = FILES.find(([n]) => n === to)![2]
  const a = recognise(load(fa), render).cells, b = recognise(load(fb), render).cells
  const t = JSON.parse(readFileSync(path(`research/out/truth-work/${from}-truth.json`), 'utf8'))
  let best = { d: Infinity, dr: 0, dc: 0, m: false }
  for (const m of [false, true]) for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
    let s = 0, n = 0
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
      const ra = r + dr, ca = (m ? b.cols - 1 - c : c) + dc
      if (ra < 0 || ca < 0 || ra >= a.rows || ca >= a.cols) continue
      const i = r * b.cols + c, j = ra * a.cols + ca
      s += Math.abs(a.fill[j * 3] - b.fill[i * 3]) + Math.abs(a.fill[j * 3 + 1] - b.fill[i * 3 + 1]) + Math.abs(a.fill[j * 3 + 2] - b.fill[i * 3 + 2]); n++
    }
    if (n > 0.8 * b.rows * b.cols && s / n < best.d) best = { d: s / n, dr, dc, m }
  }
  const truth: (string | null)[] = new Array(b.rows * b.cols).fill(null)
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
    const ra = r + best.dr, ca = (best.m ? b.cols - 1 - c : c) + best.dc
    if (ra >= 0 && ca >= 0 && ra < a.rows && ca < a.cols) truth[r * b.cols + c] = t.truth[ra * a.cols + ca]
  }
  writeFileSync(path(`samples/truth/${to}.json`), JSON.stringify({ rows: b.rows, cols: b.cols, truth, from, shift: [best.dr, best.dc], mirrored: best.m }))
  console.log(`${to} <- ${from}: ${b.cols}x${b.rows} vs ${a.cols}x${a.rows}, shift ${best.dr},${best.dc}, mirrored ${best.m}, mean colour diff ${best.d.toFixed(1)}`)
}
