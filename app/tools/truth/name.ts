// scratch: name groups of unexplained cells:  npx tsx tests/_name.ts <chart> "0:C23 2:M15 ..."
import { readFileSync, writeFileSync } from 'node:fs'
import { exists, path } from './harness'
const [name, spec] = process.argv.slice(2)
const odd: number[][] = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-odd.json`), 'utf8'))
const file = `research/out/truth-work/${name}-extra.json`
const extra: Record<string, number[]> = exists(file) ? JSON.parse(readFileSync(path(file), 'utf8')) : {}
for (const t of spec.split(/\s+/).filter(Boolean)) {
  const [id, code] = t.split(':')
  extra[code] = [...new Set([...(extra[code] ?? []), ...odd[Number(id)]])]
}
writeFileSync(path(file), JSON.stringify(extra))
console.log(Object.entries(extra).map(([c, v]) => `${c}:${v.length}`).join(' '))
