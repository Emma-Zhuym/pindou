import { readFileSync } from 'node:fs'
import { FILES, list, path, exists } from './harness'
for (const [name, key] of FILES) {
  if (!exists(`research/out/truth-work/${name}-truth.json`) || (process.argv[2] && !process.argv.slice(2).includes(name))) continue
  const t: (string | null)[] = JSON.parse(readFileSync(path(`research/out/truth-work/${name}-truth.json`), 'utf8')).truth
  const m = new Map<string, number>(); let unk = 0
  for (const c of t) { if (c === null) unk++; else if (c) m.set(c, (m.get(c) ?? 0) + 1) }
  const L = list(key)
  const diffs = [...new Set([...L.map((e) => e.code), ...m.keys()])].map((c) => [c, m.get(c) ?? 0, L.find((e) => e.code === c)?.count ?? 0] as const).filter(([, a, b]) => a !== b)
  console.log(`${name}: unknown ${unk} | differs from legend: ${diffs.map(([c, a, b]) => `${c} ${a}/${b}`).join('  ')}`)
}
