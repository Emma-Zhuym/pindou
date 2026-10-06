// scratch: label cells from the last pair sheet:  _fix.ts "0-15:G11 47:A21"
import { readFileSync, writeFileSync } from 'node:fs'
import { exists, path } from './harness'
const { name, cells } = JSON.parse(readFileSync(path('research/out/truth-work/pair.json'), 'utf8')) as { name: string; cells: number[] }
const file = `research/out/truth-work/${name}-extra.json`
const extra: Record<string, number[]> = exists(file) ? JSON.parse(readFileSync(path(file), 'utf8')) : {}
for (const t of process.argv[2].split(/\s+/).filter(Boolean)) {
  const [range, code] = t.split(':'); const [a, b] = range.split('-').map(Number)
  for (let k = a; k <= (b ?? a); k++) {
    for (const c of Object.keys(extra)) extra[c] = extra[c].filter((i) => i !== cells[k])
    extra[code] = [...(extra[code] ?? []), cells[k]]
  }
}
writeFileSync(path(file), JSON.stringify(extra)); console.log('ok')
