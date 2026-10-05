// The confirmation boundary must reject bad palettes and preserve the sampled board exactly.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { readCells } from '../src/engine/cells'
import { confirmedEntries, locateBoard, locateLegend } from '../src/flow/stages'

assert.throws(() => confirmedEntries([], {}), /添加/)
assert.throws(() => confirmedEntries(['BAD'], {}), /MARD/)
assert.throws(() => confirmedEntries(['H1', 'H1'], {}), /重复/)
assert.throws(() => confirmedEntries(['H1'], { H1: -1 }), /非负整数/)
assert.throws(() => confirmedEntries(['H1'], { H1: 1.5 }), /非负整数/)
assert.deepEqual(confirmedEntries(['H1', '', 'H2'], { H1: 0 }), [{ code: 'H1', count: 0 }, { code: 'H2', count: undefined }])
for (const file of [
  'samples/originals/tree-52x64.jpg', 'research/out/xhs/charts/tree.jpg',
  'samples/originals/dog-104x104.jpg', 'research/out/xhs/charts/dog.jpg',
  'samples/originals/landscape-84x84.jpg', 'research/out/xhs/charts/landscape.jpg',
  'research/out/xhs/batch2/bled.jpg', 'research/out/xhs/batch2/trevi.jpg',
  'research/out/xhs/batch2/hogwarts.jpg', 'research/out/xhs/batch2/pool.jpg',
  'research/out/xhs/batch2/pool-b.jpg', 'research/out/xhs/batch3/bunny.jpg',
  'research/out/xhs/batch3/hug-2.jpg', 'research/out/xhs/batch3/hug-3.jpg',
]) {
  const decoded = jpeg.decode(readFileSync(new URL(`../../${file}`, import.meta.url)), { useTArray: true })
  const img = { width: decoded.width, height: decoded.height, data: decoded.data }
  const draft = locateBoard(img)
  assert.ok(draft.cells.cols > 1 && draft.cells.rows > 1)
  const confirmed = locateBoard(img, { grid: draft.grid, extent: draft.extent })
  const reread = readCells(img, draft.grid, draft.extent)
  assert.deepEqual(confirmed.cells.fill, draft.cells.fill, 'confirmation must not alter sampled fill colours')
  assert.deepEqual(reread.ink, draft.cells.ink, 'classification must receive the same glyph pixels as the located board')
  assert.deepEqual(confirmed.cells.share, draft.cells.share)
  assert.ok(!('assign' in draft), 'grid stage must not classify cells')
  const legend = locateLegend(img, draft)
  assert.ok(legend && legend.x >= 0 && legend.y >= 0 && legend.x + legend.w <= img.width && legend.y + legend.h <= img.height)
  console.log(`${file}: ${draft.cells.cols}×${draft.cells.rows}, unchanged fill/glyph samples`)
}
console.log('Palette validation and grid-to-classification boundary passed')
