// The editor's selection: beads picked cell by cell, lifted, moved and put down again.

/** one bead lifted, where it was */
export interface Piece {
  x: number
  y: number
  code: string
}
/** beads lifted by the lasso and being moved: blanks are left behind, so they never cover anything */
export interface Float {
  pieces: Piece[]
  /** how far they have been moved, in cells */
  dx: number
  dy: number
  /** where they overlap other beads: theirs shown (true) or the beads under them */
  top: boolean
  /** a copy: the beads stay where they were too */
  keep: boolean
  /** the cells as they were before lifting */
  before: string[]
}
/** the cells with the lifted beads put down where they have been moved; beads off the chart are lost */
export const putDown = (cols: number, rows: number, f: Float) => {
  const out = [...f.before]
  if (!f.keep) for (const p of f.pieces) out[p.y * cols + p.x] = ''
  let lost = 0
  let overlap = 0
  for (const p of f.pieces) {
    const x = p.x + f.dx
    const y = p.y + f.dy
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      lost++
      continue
    }
    const j = y * cols + x
    if (out[j] && out[j] !== p.code) overlap++
    if (f.top || !out[j]) out[j] = p.code
  }
  return { cells: out, lost, overlap }
}
/** the beads among the cells picked; blanks are not taken */
export const piecesOf = (cells: string[], cols: number, picked: Iterable<number>): Piece[] =>
  [...picked]
    .sort((a, b) => a - b)
    .filter((i) => cells[i])
    .map((i) => ({ x: i % cols, y: Math.floor(i / cols), code: cells[i] }))
