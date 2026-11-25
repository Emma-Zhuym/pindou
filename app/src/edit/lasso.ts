// The editor's lasso: beads drawn round, lifted, moved and put down again.

/** a point in cells from the chart's top left, fractions allowed */
export interface Pt {
  x: number
  y: number
}
/** one bead lifted by the lasso, where it was */
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
/** the cells with a lasso's beads put down where they have been moved; beads off the chart are lost */
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
/** whether a point is inside a closed path (even-odd) */
const inside = (pt: Pt, path: Pt[]) => {
  let inn = false
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]
    const b = path[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inn = !inn
  }
  return inn
}
/** the beads whose centres a lasso goes round; blanks are not taken */
export const lassoPieces = (cells: string[], cols: number, rows: number, path: Pt[]): Piece[] => {
  if (path.length < 3) return []
  const out: Piece[] = []
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const code = cells[y * cols + x]
      if (code && inside({ x: x + 0.5, y: y + 0.5 }, path)) out.push({ x, y, code })
    }
  return out
}
