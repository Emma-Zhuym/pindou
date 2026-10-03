// independent scale/basis regression tests; no screenshot coordinates or labels.
import assert from 'node:assert/strict'
import { findBoard, findGrid, type Raster } from '../src/engine/grid'

function chart(width: number, height: number, pitch: number, thick = false): Raster {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const vertical = x % pitch < (thick && Math.floor(x / pitch) % 10 === 0 ? 6 : 1)
    const horizontal = y % pitch < (thick && Math.floor(y / pitch) % 10 === 0 ? 6 : 1)
    if (vertical || horizontal) {
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 30
    }
  }
  return { width, height, data }
}
for (const [width, height, pitch, thick] of [
  [1600, 400, 8, false], [1800, 400, 8, false], [1808, 400, 8, false],
  [2000, 400, 8, false], [2002, 420, 7, false], [2400, 2400, 10, false], [3000, 600, 12, false],
  [2000, 2000, 30, false], [3800, 4000, 44, false],
  [2000, 2000, 40, true],
] as const) {
  const img = chart(width, height, pitch, thick)
  const g = findGrid(img)
  console.log(`${width}x${height} true ${pitch} -> ${g.perX.toFixed(3)}/${g.perY.toFixed(3)}${thick ? ' thick guides' : ''}`)
  assert.ok(Math.abs(g.perX - pitch) < .15 && Math.abs(g.perY - pitch) < .15, 'fundamental pitch, not a harmonic')
  if (thick) {
    const board = findBoard(img, g)
    assert.ok(board.rows >= height / pitch - 1 && board.cols >= width / pitch - 1, 'thick guides must not cut the board')
  }
}
