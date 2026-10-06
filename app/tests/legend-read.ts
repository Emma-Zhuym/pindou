// Board codes from the legend, end to end, two ways:
//   local: readLocally (swatch finders + automatic names), nothing given
//   list:  fitList with the hand-read legend (codes + counts) standing in for what a vision model
//          returns; measures the matching, not any model
// Scored by count agreement with the hand-read legend. Images under research/out/xhs/ are not
// committed (other people's charts) and are skipped when missing.
// Run from app/:  node --import tsx tests/legend-read.ts [name ...]
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import jpeg from 'jpeg-js'
import type { TextRenderer } from '../src/engine/glyphs'
import type { Raster } from '../src/engine/grid'
import { fitList, readLocally } from '../src/engine/legendRead'
import { recognise } from '../src/engine/recognize'

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

// hand-read legends, in printed order: "CODE:count ..." (landscape's B12 and F15 checked against
// the cells; pool-b is a variant of pool with its own legend, scored here against pool's)
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
}
const FILES: [string, string, string][] = [
  ['tree', 'phone-saved', 'samples/originals/tree-52x64.jpg'],
  ['tree', 'link', 'research/out/xhs/charts/tree.jpg'],
  ['dog', 'phone-saved', 'samples/originals/dog-104x104.jpg'],
  ['dog', 'link', 'research/out/xhs/charts/dog.jpg'],
  ['landscape', 'phone-saved', 'samples/originals/landscape-84x84.jpg'],
  ['landscape', 'link', 'research/out/xhs/charts/landscape.jpg'],
  ['bled', 'link', 'research/out/xhs/batch2/bled.jpg'],
  ['trevi', 'link', 'research/out/xhs/batch2/trevi.jpg'],
  ['hogwarts', 'link', 'research/out/xhs/batch2/hogwarts.jpg'],
  ['pool', 'link', 'research/out/xhs/batch2/pool.jpg'],
  ['pool', 'link-b', 'research/out/xhs/batch2/pool-b.jpg'],
  ['bunny', 'link', 'research/out/xhs/batch3/bunny.jpg'],
  ['hug', 'link', 'research/out/xhs/batch3/hug-2.jpg'],
  ['hug', 'link-big', 'research/out/xhs/batch3/hug-3.jpg'],
]
const agreement = (counts: Map<string, number>, legend: Record<string, number>) => {
  let off = 0
  for (const c of new Set([...Object.keys(legend), ...counts.keys()])) off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0))
  return 100 * (1 - off / 2 / Object.values(legend).reduce((a, b) => a + b, 0))
}
const tally = (r: { groups: { code: string }[]; assign: Int16Array }) => {
  const m = new Map<string, number>()
  for (const g of r.assign) if (g >= 0) m.set(r.groups[g].code, (m.get(r.groups[g].code) ?? 0) + 1)
  return m
}
const only = process.argv.slice(2)
for (const [key, which, file] of FILES) {
  if ((only.length && !only.includes(key)) || !existsSync(path(file))) continue
  const list = LEGENDS[key].split(' ').map((t) => ({ code: t.split(':')[0], count: Number(t.split(':')[1]) }))
  const truth = Object.fromEntries(list.map((e) => [e.code, e.count]))
  const img = load(file)
  const rec = recognise(img, render)
  const t = Date.now()
  const local = readLocally(img, rec, render)
  const t1 = Date.now()
  const fitted = fitList(rec, list, local, render)
  const t2 = Date.now()
  const printed = local?.printed ?? {}
  const readRight = Object.entries(printed).filter(([c, n]) => truth[c] === n).length
  const loc = local ? `${agreement(tally(local), truth).toFixed(2)}% (${local.swatches.length} swatches, ${local.groups.length} codes, cover ${(local.coverage * 100).toFixed(0)}%, unsure ${local.unsureName.filter(Boolean).length}; counts read ${readRight}/${Object.keys(printed).length} right of ${list.length})` : 'no legend found'
  console.log(`${key.padEnd(9)} ${which.padEnd(11)} board ${rec.cells.cols}x${rec.cells.rows} | local ${loc} ${t1 - t}ms | list ${agreement(tally(fitted), truth).toFixed(2)}% cover ${(fitted.coverage * 100).toFixed(0)}% ${t2 - t1}ms`)
}
