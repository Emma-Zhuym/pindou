import { clusterByFill, readCells, stripBorder, trimBlank } from '../engine/cells'
import { CATALOGUE } from '../engine/glyphs'
import { findBoard, findGrid, type Extent, type Grid, type Raster } from '../engine/grid'
import type { LegendEntry } from '../engine/legendRead'
import type { Recognition } from '../engine/recognize'
import { findLegend, outsideBoard } from '../engine/legendArea'

export type BoardDraft = Pick<Recognition, 'grid' | 'extent' | 'cells'> & {
  /** the board's size before the blank paper round it was trimmed, when some was */
  untrimmed?: { cols: number; rows: number }
}

/** Locate and sample the board without assigning any cell a colour code. Found by itself, the
 *  board loses its numbered border and the blank paper round it; one the person set is kept. */
export function locateBoard(img: Raster, board?: { grid: Grid; extent: Extent }): BoardDraft {
  const grid = board?.grid ?? findGrid(img)
  const found = board?.extent ?? findBoard(img, grid)
  const sampled = readCells(img, grid, found)
  const bordered = board ? sampled : stripBorder(sampled)
  const cells = board ? sampled : trimBlank(bordered)
  const untrimmed = cells !== bordered ? { cols: bordered.cols, rows: bordered.rows } : undefined
  return { grid, cells, extent: { r0: cells.r0, c0: cells.c0, rows: cells.rows, cols: cells.cols }, untrimmed }
}

/** Locate the legend using unnamed fill colours, without reading any board labels. */
export function locateLegend(img: Raster, board: BoardDraft) {
  const cl = clusterByFill(board.cells.fill)
  const groups = cl.count.map((_, i) => ({ colour: { r: cl.centre[i * 3], g: cl.centre[i * 3 + 1], b: cl.centre[i * 3 + 2] } }))
  return findLegend(img, { grid: board.grid, extent: board.extent, groups }) ?? outsideBoard(board, img.width, img.height)
}

/** Validate the user's palette before letting it reach the cell classifier. */
export function confirmedEntries(names: string[], counts: Record<string, number>): LegendEntry[] {
  const codes = names.filter(Boolean)
  if (!codes.length) throw new Error('请先添加图例色号')
  if (codes.some((code) => !(code in CATALOGUE))) throw new Error('请先改正不是 MARD 色号的条目')
  if (new Set(codes).size !== codes.length) throw new Error('有重复色号，请先合并或删除重复条目')
  return codes.map((code) => {
    const count = counts[code]
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) throw new Error(`${code} 的颗数需要是非负整数`)
    return { code, count }
  })
}
