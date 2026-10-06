// Every cell scored against a code read by eye (samples/truth/*.json), not just the totals per code:
// totals hide two codes trading cells. The truths were built from print clusters named by hand and
// checked against the printed legends; cells too hidden to read are left out (null).
//   acc     share of readable beads given their printed code
//   extra   non-beads (ruler numbers, blank cells) given a code
//   flagged wrong cells the review marks unsure, and how many of the marked are wrong
//   asked   wrong cells among those an AI check would be sent (the 300 least sure)
//   +AI     accuracy if a model read each print class's 3 typical cells right (as flow/Flow.tsx asks)
// Images under research/out/xhs/ and samples/ are other people's charts; missing ones are skipped.
// Run from app/:  node --import tsx tests/cells-truth.ts [name ...]
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import type { TextRenderer } from '../src/engine/glyphs'
import type { Raster } from '../src/engine/grid'
import { applyReading, fitList, readLocally } from '../src/engine/legendRead'
import { recognise, type Recognition } from '../src/engine/recognize'

const SS = 4
const render: TextRenderer = (text, font, size, box) => {
  const canvas = createCanvas(box * SS, box * SS)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, box * SS, box * SS)
  ctx.fillStyle = '#fff'
  ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))))
  const m = ctx.measureText(text)
  ctx.fillText(text, (box * SS - m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 + m.actualBoundingBoxLeft, (box * SS - m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, box * SS, box * SS).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < box * SS; y++) for (let x = 0; x < box * SS; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS)
  return out
}
const path = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url))
const load = (rel: string): Raster => {
  const img = jpeg.decode(readFileSync(path(rel)), { useTArray: true, maxMemoryUsageInMB: 8192 })
  return { width: img.width, height: img.height, data: img.data }
}

// the legends as printed (checked against the cells: landscape prints B12 and F15)
const LEGENDS: Record<string, string> = {
  tree: 'B11:214 B15:59 B17:362 B22:3 B23:637 B29:43 B32:66 F11:3 G17:13 H2:5 H7:210 H16:16 H17:1',
  dog: 'A1:3150 H2:1599 H7:1548 F21:1258 G12:738 A11:634 E4:466 B30:345 E18:334 B17:178 C17:155 C26:116 B13:96 F13:64 M2:36 M3:33 F23:31 F19:19 F14:16',
  landscape: 'A3:118 A6:176 A7:287 A8:320 A15:757 A22:24 A26:48 B1:267 B7:80 B8:557 B9:447 B11:143 B12:100 B15:55 B18:78 B19:125 B21:60 B26:171 B29:151 B32:499 C3:190 C19:77 C24:731 C27:76 F8:138 F10:94 F11:132 F13:328 F15:29 G7:206 G8:135 G13:35 G17:22 G19:265 H12:135',
  bled: 'A23:35 C3:415 C6:857 C7:43 C13:129 C24:306 D2:159 D4:54 G4:53 G14:112 G17:110 G18:64 H2:185 H5:309 H6:175 H20:71 M9:26 M14:33',
  trevi: 'C2:144 C19:94 C22:189 C23:117 G4:845 H4:889 H5:215 H11:69 H19:1421 H20:51 M3:103 M4:1389 M7:1241 M9:249 M15:481',
  hogwarts: 'C12:3941 H7:2450 C18:1314 H6:747 C29:626 H16:295 F11:252 C19:216 H5:202 A11:187 M6:128 G14:124 G5:122 G21:107 M15:68 H13:37',
  bunny: 'C13:183 E17:6 H1:368 H2:232 H7:5',
  hug: 'A9:22 A12:21 A18:6 A21:29 A23:355 A24:1 B13:39 B16:7 C6:4 C24:20 C27:6 D9:7 E1:434 E11:4 F19:2 F23:12 G11:21 G12:351 G18:325 H2:175 H3:5 H7:655 H10:516',
  pool: 'A15:8 A4:96 A6:1 B1:90 B15:113 B8:100 C13:93 C20:8 C24:999 C8:490 F4:13 G21:2 G5:9 G6:6 G8:40 G9:198 H11:319 H19:34 H2:342 H3:201 H5:468 H7:204 M3:137',
  // its legend was not saved: the codes it prints, without counts
  'pool-b': 'A15 A4 A6 B1 B15 B8 C13 C20 C24 C8 F4 G21 G5 G6 G8 G9 H19 H2 H3 H4 H5 H7 M3',
}
// [truth name, legend, image]
const FILES: [string, string, string][] = [
  ['tree', 'tree', 'research/out/xhs/charts/tree.jpg'],
  ['tree-phone', 'tree', 'samples/originals/tree-52x64.jpg'],
  ['dog', 'dog', 'research/out/xhs/charts/dog.jpg'],
  ['dog-phone', 'dog', 'samples/originals/dog-104x104.jpg'],
  ['landscape', 'landscape', 'research/out/xhs/charts/landscape.jpg'],
  ['landscape-phone', 'landscape', 'samples/originals/landscape-84x84.jpg'],
  ['bled', 'bled', 'research/out/xhs/batch2/bled.jpg'],
  ['trevi', 'trevi', 'research/out/xhs/batch2/trevi.jpg'],
  ['hogwarts', 'hogwarts', 'research/out/xhs/batch2/hogwarts.jpg'],
  ['pool', 'pool', 'research/out/xhs/batch2/pool.jpg'],
  ['pool-b', 'pool-b', 'research/out/xhs/batch2/pool-b.jpg'],
  ['bunny', 'bunny', 'research/out/xhs/batch3/bunny.jpg'],
  ['hug', 'hug', 'research/out/xhs/batch3/hug-2.jpg'],
  ['hug-big', 'hug', 'research/out/xhs/batch3/hug-3.jpg'],
]

/** the cells an AI check is sent, as the review page picks them (flow/Flow.tsx) */
const AI_CELLS = 300
function asked(rec: Recognition, assign: Int16Array): number[] {
  const { cols, rows, share } = rec.cells
  const around = (i: number) => {
    const x = i % cols
    const y = (i - x) / cols
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && assign[b * cols + a] >= 0).length
  }
  const out: number[] = []
  for (let i = 0; i < assign.length; i++) if (assign[i] >= 0 ? rec.unsure[i] : share[i] > 0.06 && around(i) >= 2) out.push(i)
  return out.sort((a, b) => rec.confidence[a] - rec.confidence[b]).slice(0, AI_CELLS)
}

const only = process.argv.slice(2)
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-')
let allKnown = 0
let allRight = 0
let allAi = 0
for (const [name, key, file] of FILES) {
  if ((only.length && !only.includes(name)) || !existsSync(path(file)) || !existsSync(path(`samples/truth/${name}.json`))) continue
  const { rows, cols, truth } = JSON.parse(readFileSync(path(`samples/truth/${name}.json`), 'utf8')) as { rows: number; cols: number; truth: (string | null)[] }
  const img = load(file)
  const t0 = Date.now()
  const first = recognise(img, render)
  if (first.cells.rows !== rows || first.cells.cols !== cols) {
    console.log(`${name.padEnd(15)} board ${first.cells.cols}x${first.cells.rows}, truth is ${cols}x${rows}: not scored`)
    continue
  }
  const list = LEGENDS[key].split(' ').map((t) => ({ code: t.split(':')[0], count: t.includes(':') ? Number(t.split(':')[1]) : undefined }))
  const rec = applyReading(first, fitList(first, list, readLocally(img, first, render), render))
  const ms = Date.now() - t0
  const code = (i: number) => (rec.assign[i] >= 0 ? rec.groups[rec.assign[i]].code : '')
  let known = 0
  let right = 0
  let extra = 0
  let flagged = 0
  let flaggedWrong = 0
  const wrong: number[] = []
  truth.forEach((want, i) => {
    if (rec.assign[i] >= 0 && rec.unsure[i]) flagged++
    if (want === null) return
    if (want === '') {
      if (rec.assign[i] >= 0) extra++
      return
    }
    known++
    if (code(i) === want) right++
    else {
      wrong.push(i)
      if (rec.assign[i] >= 0 && rec.unsure[i]) flaggedWrong++
    }
  })
  const ask = new Set(asked(rec, rec.assign))
  const caught = wrong.filter((i) => ask.has(i)).length
  // the commonest mistakes, as want>got
  const pairs = new Map<string, number>()
  for (const i of wrong) pairs.set(`${truth[i]}>${code(i) || '空'}`, (pairs.get(`${truth[i]}>${code(i) || '空'}`) ?? 0) + 1)
  const top = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p} ${n}`).join(', ')
  // the review page's class reading, with the truth standing in for the model
  const after = Int16Array.from(rec.assign)
  const classes = (rec.classes ?? []).filter((c) => c.length >= 3).sort((a, b) => rec.unsure[b[0]] - rec.unsure[a[0]] || b.length - a.length).slice(0, 60)
  for (const cells of classes) {
    const votes = new Map<string, number>()
    for (const i of cells.slice(0, 3)) if (truth[i]) votes.set(truth[i]!, (votes.get(truth[i]!) ?? 0) + 1)
    const [best, n] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
    const to = rec.groups.findIndex((g) => g.code === best)
    if (n >= 2 && to >= 0) for (const i of cells) after[i] = to
  }
  let rightAi = 0
  truth.forEach((want, i) => {
    if (want && after[i] >= 0 && rec.groups[after[i]].code === want) rightAi++
  })
  allKnown += known
  allRight += right
  allAi += rightAi
  console.log(
    `${name.padEnd(15)} acc ${pct(right, known).padStart(6)} (${known - right} wrong of ${known}) +AI ${pct(rightAi, known)} extra ${extra} | flagged ${flagged}: ${flaggedWrong}/${wrong.length} wrong caught, ${pct(flaggedWrong, flagged)} of flagged wrong | asked ${caught}/${wrong.length} | ${ms}ms | ${top}`,
  )
}
console.log(`all: ${pct(allRight, allKnown)} of ${allKnown} readable beads, ${pct(allAi, allKnown)} with the classes read right`)
