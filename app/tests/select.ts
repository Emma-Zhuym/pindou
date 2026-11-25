import assert from 'node:assert/strict'
import { piecesOf, putDown } from '../src/edit/select'

// 4×3: a red bead with a blank beside it, and a blue bead to land on
const cols = 4
const rows = 3
// prettier-ignore
const cells = [
  'R', '', '', 'B',
  'R', '', '', 'B',
  '',  '', '', '',
]
// the left two columns of the top two rows picked: the blanks are not taken
const pieces = piecesOf(cells, cols, new Set([5, 0, 1, 4]))
assert.deepEqual(pieces, [{ x: 0, y: 0, code: 'R' }, { x: 0, y: 1, code: 'R' }])

const at = (out: string[]) => [0, 1, 2].map((y) => out.slice(y * cols, y * cols + cols).join(','))
// moved 3 right onto the blues: the lifted beads win, or the ones under them
const over = putDown(cols, rows, { pieces, dx: 3, dy: 0, top: true, keep: false, before: cells })
assert.deepEqual(at(over.cells), [',,,R', ',,,R', ',,,'])
assert.equal(over.overlap, 2)
const under = putDown(cols, rows, { pieces, dx: 3, dy: 0, top: false, keep: false, before: cells })
assert.deepEqual(at(under.cells), [',,,B', ',,,B', ',,,'])
// a copy keeps the beads where they were; one off the bottom is lost
const copy = putDown(cols, rows, { pieces, dx: 1, dy: 1, top: true, keep: true, before: cells })
assert.deepEqual(at(copy.cells), ['R,,,B', 'R,R,,B', ',R,,'])
assert.equal(copy.lost, 0)
const off = putDown(cols, rows, { pieces, dx: 0, dy: 2, top: true, keep: false, before: cells })
assert.equal(off.lost, 1)
assert.deepEqual(at(off.cells), [',,,B', ',,,B', 'R,,,'])

console.log('select: ok')
