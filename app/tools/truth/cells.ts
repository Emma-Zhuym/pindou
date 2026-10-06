// scratch: every still-unexplained cell numbered, to read one by one; then  _cells.ts <chart> apply "A23 G18 ..." (one code per number, - to skip)
import { readFileSync, writeFileSync } from 'node:fs'
import { recognise } from '../../src/engine/recognize'
import { FILES, load, render, sheet, exists, path } from './harness'
const [name, mode, codes] = process.argv.slice(2)
const odd: number[][] = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-odd.json`), 'utf8'))
const cells = odd.flat()
if (mode === 'apply') {
  const file = `research/out/truth-work/${name}-extra.json`
  const extra: Record<string, number[]> = exists(file) ? JSON.parse(readFileSync(path(file), 'utf8')) : {}
  const list = codes.split(/\s+/).filter(Boolean)
  if (list.length !== cells.length) throw new Error(`${list.length} codes for ${cells.length} cells`)
  list.forEach((c, k) => { if (c !== '-') extra[c] = [...new Set([...(extra[c] ?? []), cells[k]])] })
  writeFileSync(path(file), JSON.stringify(extra))
  console.log('applied', list.filter((c) => c !== '-').length)
} else {
  const [, , file] = FILES.find(([n]) => n === name)!
  const img = load(file); const rec = recognise(img, render)
  const from = Number(process.env.FROM ?? 0), to = Number(process.env.TO ?? cells.length)
  sheet(`cells-${name}`, img, rec, cells.slice(from, to).map((i, k) => ({ i, text: String(from + k) })), Number(process.env.PER ?? 12), Number(process.env.T ?? 48))
  console.log(cells.length, 'cells')
}
