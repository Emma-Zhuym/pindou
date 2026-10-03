// colours must remain original-pixel measurements even when label ink is reduced.
import assert from 'node:assert/strict'
import { readCells, INK } from '../src/engine/cells'
import type { Raster } from '../src/engine/grid'

const extent = { r0: 0, c0: 0, rows: 1, cols: 1 }
for (const pitch of [24, 28, 40, 48, 64]) {
  const colour = [200, 100, 50]
  const data = new Uint8ClampedArray(pitch * pitch * 4).fill(255)
  for (let y = 0; y < pitch; y++) for (let x = 0; x < pitch; x++) {
    const i = (y * pitch + x) * 4
    data.set(colour, i)
  }
  const img: Raster = { width: pitch, height: pitch, data }
  const g = { perX: pitch, perY: pitch, offX: 0, offY: 0 }
  const plain = readCells(img, g, extent)
  assert.deepEqual(Array.from(plain.fill), colour, 'unlabelled original colour survives scale changes')
  assert.equal(plain.share[0], 0)
  assert.equal(plain.ink.length, INK * INK)
  assert.ok(plain.ink.every(v => v === 0), 'flat fill must not generate label ink')
}
// At exactly 48px, reduction to 24px mixes each black dot with its surrounding fill.
// Original-pixel sampling still returns the dominant fill, not the averaged darkened colour.
const pitch = 48, data = new Uint8ClampedArray(pitch * pitch * 4).fill(255)
for (let y = 0; y < pitch; y++) for (let x = 0; x < pitch; x++) {
  const i = (y * pitch + x) * 4
  data.set(x % 2 && y % 2 ? [0, 0, 0] : [200, 100, 50], i)
}
const labelled = readCells({ width: pitch, height: pitch, data },
  { perX: pitch, perY: pitch, offX: 0, offY: 0 }, extent)
assert.deepEqual(Array.from(labelled.fill), [200, 100, 50], 'text averaging must not darken the reference fill')
assert.ok(labelled.ink.some(v => v > 0), 'label path remains active')
console.log('Original fill and separate scaled ink: flat colours, scale boundary, dense black dots passed')
