import assert from 'node:assert/strict'
import { BOARD_INSET, boardGuideMarks, layout } from '../src/bead/paint'

for (const [side, inset, interior] of [[52, 1, 50], [78, 4, 70], [104, 2, 100]] as const) {
  assert.equal(BOARD_INSET[side], inset)
  const guides = boardGuideMarks(side)
  assert.deepEqual(guides.map((g) => g.cell), Array.from({ length: interior / 5 + 1 }, (_, i) => inset + i * 5))
  assert.ok(guides.every((g, i) => g.strong === (i % 2 === 0)), `${side} guide styles alternate from a solid line`)
  assert.equal(guides[0].cell, inset)
  assert.equal(guides.at(-1)?.cell, side - inset)

  const centred = layout({ cols: 20, rows: 30, cell: 10, board: side, rulers: false })
  const moved = layout({ cols: 20, rows: 30, cell: 10, board: side, offset: { x: 7, y: 9 }, rulers: false })
  assert.notEqual(centred.x0, moved.x0)
  assert.notEqual(centred.y0, moved.y0)
  // Board guides use the board origin (margin), not either chart origin.
  assert.equal(centred.margin, moved.margin)
}

console.log('paint board guide geometry: ok')
