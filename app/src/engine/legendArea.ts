// Where the legend is: a bead chart is the grid plus a legend strip above or below it.
import type { Raster } from './grid'
import type { Recognition } from './recognize'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The strip above or below the grid that shows more of the board's colours, with blank margins
 *  trimmed. Returns null when neither strip looks like a legend. */
export function findLegend(img: Raster, rec: Recognition): Rect | null {
  const { width: W, height: H, data } = img
  const top = Math.max(0, Math.round(rec.grid.offY + rec.extent.r0 * rec.grid.perY))
  const bottom = Math.min(H, Math.round(rec.grid.offY + (rec.extent.r0 + rec.extent.rows) * rec.grid.perY))

  const coloursSeen = (y0: number, y1: number) => {
    const hits = new Int32Array(rec.groups.length)
    for (let y = y0; y < y1; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4
        // page background (near-white) cannot tell a legend from a title
        if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) continue
        for (let g = 0; g < rec.groups.length; g++) {
          const c = rec.groups[g].colour
          if (Math.abs(data[i] - c.r) + Math.abs(data[i + 1] - c.g) + Math.abs(data[i + 2] - c.b) < 26) {
            hits[g]++
            break
          }
        }
      }
    }
    return hits.reduce((a, n) => a + (n >= 6 ? 1 : 0), 0)
  }
  // legends are almost always under the grid; the strip above is only used when the one below
  // does not look like a legend at all
  const need = Math.min(3, rec.groups.length)
  const below = H - bottom > 12 ? coloursSeen(bottom, H) : 0
  const above = below < need && top > 12 ? coloursSeen(0, top) : 0
  if (Math.max(above, below) < need) return null
  let [y0, y1] = below >= need ? [bottom, H] : [0, top]

  // trim rows that are a single flat colour (blank margin)
  const blank = (y: number) => {
    const i0 = y * W * 4
    for (let x = 4; x < W; x += 4) {
      const i = i0 + x * 4
      if (Math.abs(data[i] - data[i0]) + Math.abs(data[i + 1] - data[i0 + 1]) + Math.abs(data[i + 2] - data[i0 + 2]) > 40) return false
    }
    return true
  }
  while (y0 < y1 - 1 && blank(y0)) y0++
  while (y1 > y0 + 1 && blank(y1 - 1)) y1--
  y0 = Math.max(0, y0 - 4)
  y1 = Math.min(H, y1 + 4)
  return { x: 0, y: y0, w: W, h: y1 - y0 }
}
