// The full automatic pass: image -> board of colour codes, with the evidence the review screens need.
import { type Cells, clusterByFill, CORE, INK, readCells, stack, stripBorder, unit } from './cells'
import { CODES, fitLabels, hasLabel, type LabelFit, makeReader, pickCode, type Rgb, type TextRenderer } from './glyphs'
import { type Extent, findBoard, findGrid, type Grid, type Raster } from './grid'

export interface Group {
  /** the code the recogniser read off the stacked label */
  code: string
  /** how well the stacked label matched that code, 0..1 */
  score: number
  colour: Rgb
  /** stacked label of all cells first put in this group, INK*INK, 0..1 */
  label: Float32Array
}

export interface Recognition {
  grid: Grid
  extent: Extent
  cells: Cells
  fit: LabelFit
  groups: Group[]
  /** group index per cell, -1 for an empty cell (charts that leave gaps) */
  assign: Int16Array
  /** 0..1 per cell: how clearly the best group beat the runner-up */
  confidence: Float32Array
  /** cells worth a second look */
  unsure: Uint8Array
  /** 1 for a cell left empty (plain background, nothing printed), whatever the groups say */
  empty: Uint8Array
  /** cells of one colour and one print, the most typical first, once a legend list is laid on */
  classes?: number[][]
}

/** below this likeness to the colour's own printed code, ink on a background cell is a watermark */
const WATERMARK_CORR = 0.4
/** the cells on the page's colour that print like the other codes by this much more are the beads */
const LESS_LIKE = 0.15

const rgbOf = (centre: Float64Array, k: number): Rgb => ({ r: centre[k * 3], g: centre[k * 3 + 1], b: centre[k * 3 + 2] })
const colourDist = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

/** `board`: a grid and board the person confirmed; skips finding them (and the border strip). */
export function recognise(img: Raster, render: TextRenderer, onProgress?: (step: string) => void, board?: { grid: Grid; extent: Extent }): Recognition {
  onProgress?.('grid')
  const grid = board?.grid ?? findGrid(img)
  const extent = board?.extent ?? findBoard(img, grid)
  onProgress?.('cells')
  const read = readCells(img, grid, extent)
  const cells = board ? read : stripBorder(read)
  const n = cells.rows * cells.cols

  onProgress?.('colours')
  const cl = clusterByFill(cells.fill)
  const members: number[][] = cl.count.map(() => [])
  for (let i = 0; i < n; i++) members[cl.label[i]].push(i)
  const order = cl.count.map((_, k) => k).sort((a, b) => cl.count[b] - cl.count[a])
  const stacks = new Map<number, Float32Array>()
  const stackOf = (k: number) => {
    let s = stacks.get(k)
    if (!s) {
      s = stack(cells, members[k])
      stacks.set(k, s)
    }
    return s
  }
  // a group this large is a colour of its own, not a tinted fragment of another
  const major = Math.max(8, Math.floor(0.002 * n))
  const seeds = order.filter((k) => cl.count[k] >= major && hasLabel(stackOf(k))).slice(0, 8)
  // a chart that leaves gaps has one big group with nothing printed in it
  const blank = order.find((k) => cl.count[k] >= 0.05 * n && !hasLabel(stackOf(k)))

  onProgress?.('labels')
  const fit = fitLabels(render, seeds.map(stackOf))
  const reader = makeReader(render, fit)

  // name the colour groups, biggest first; same code = same group
  const byCode = new Map<string, number[]>()
  const scoreOf = new Map<string, number>()
  const tmp = new Float32Array(CORE * CORE)
  for (const k of order) {
    if (k === blank) continue
    const big = cl.count[k] >= major
    const st = stackOf(k)
    const scores = reader.all(st, big)
    const colour = rgbOf(cl.centre, k)
    let { code, score, colourOff } = pickCode(scores, colour)
    let keep = false
    if (big) {
      keep = score >= 0.86 && colourOff < 170
    } else {
      // A tinted fragment of an existing colour reads (almost) the same label; a different code
      // in a similar colour (F13 vs F19) reads measurably worse.
      let near: string | null = null
      let nearScore = -1
      for (const [c, ks] of byCode) {
        const d = colourDist(rgbOf(cl.centre, ks[0]), colour)
        const s = scores[CODES.indexOf(c)]
        const gap = score - s
        if (((d < 40 && gap <= 0.06) || (d < 70 && gap <= 0.015)) && s > nearScore) {
          near = c
          nearScore = s
        }
      }
      if (near) {
        code = near
        keep = true
      } else if (score >= 0.9 && colourOff < 120) {
        // do the member cells agree with their own average? watermark debris does not
        let agree = 1
        if (cl.count[k] >= 3) {
          const u = unit(st)
          agree = 0
          for (const m of members[k]) {
            const v = unit(cells.ink, 1 / 255, tmp, m * INK * INK)
            let s = 0
            for (let i = 0; i < u.length; i++) s += u[i] * v[i]
            agree += s
          }
          agree /= members[k].length
        }
        keep = agree >= 0.5
      }
    }
    if (keep) {
      if (!byCode.has(code)) {
        byCode.set(code, [])
        scoreOf.set(code, score)
      }
      byCode.get(code)!.push(k)
    }
  }

  const groups: Group[] = []
  const templates: Float32Array[] = []
  for (const [code, ks] of byCode) {
    const all = ks.flatMap((k) => members[k])
    const label = stack(cells, all)
    let r = 0
    let g = 0
    let b = 0
    let w = 0
    for (const k of ks) {
      r += cl.centre[k * 3] * cl.count[k]
      g += cl.centre[k * 3 + 1] * cl.count[k]
      b += cl.centre[k * 3 + 2] * cl.count[k]
      w += cl.count[k]
    }
    groups.push({ code, score: scoreOf.get(code)!, colour: { r: r / w, g: g / w, b: b / w }, label })
    templates.push(unit(label))
  }

  // every cell picks the group whose colour AND label shape fit it best
  onProgress?.('assign')
  // Empty cells. When most cells carry a printed code, a cell without one is empty, provided it
  // has the background colour (a white bead like H2 shares that colour but carries its code).
  const empty = new Uint8Array(n)
  const bare: number[] = []
  for (let i = 0; i < n; i++) if (cells.share[i] <= 0.06) bare.push(i)
  let background: Rgb | null = blank !== undefined ? rgbOf(cl.centre, blank) : null
  if (!background && bare.length && bare.length < 0.7 * n) {
    const mid = (ch: number) => bare.map((i) => cells.fill[i * 3 + ch]).sort((a, b) => a - b)[bare.length >> 1]
    background = { r: mid(0), g: mid(1), b: mid(2) }
  }
  if (background) {
    const bg = background
    const onPage = (i: number) => colourDist({ r: cells.fill[i * 3], g: cells.fill[i * 3 + 1], b: cells.fill[i * 3 + 2] }, bg) < 26
    for (const i of bare) if (onPage(i)) empty[i] = 1
    // Ink on a background-coloured cell is either the code of a bead in that colour (white H2 on a
    // white page) or a watermark across an empty cell. The codes all look alike; a watermark cuts
    // each cell differently. Compare each with the stack of those that agree, twice over.
    const inked: number[] = []
    for (let i = 0; i < n; i++) if (cells.share[i] > 0.06 && onPage(i)) inked.push(i)
    if (inked.length) {
      const look = (members: number[]) => {
        const t = unit(stack(cells, members))
        return inked.map((i) => {
          const v = unit(cells.ink, 1 / 255, tmp, i * INK * INK)
          let s = 0
          for (let k = 0; k < t.length; k++) s += t[k] * v[k]
          return s
        })
      }
      let corr = look(inked)
      corr = look(inked.filter((_, k) => corr[k] >= 0.5))
      let beads = inked.filter((_, k) => corr[k] >= 0.5)
      // A page drawn with a pattern (the grey and white squares of "transparent") prints alike in
      // every empty cell, so the alike ones can be the page and the rest the beads. The beads print
      // a code like the other colours' codes; a pattern is like none of them.
      const rest = inked.filter((_, k) => corr[k] < 0.5)
      if (rest.length >= 3 && beads.length) {
        const codes = groups.map((g, k) => (colourDist(g.colour, bg) >= 26 ? templates[k] : null)).filter((t): t is Float32Array => !!t)
        const printLike = (members: number[]) => {
          const t = unit(stack(cells, members))
          return Math.max(-1, ...codes.map((c) => c.reduce((s, v, k) => s + v * t[k], 0)))
        }
        if (codes.length && printLike(rest) > printLike(beads) + LESS_LIKE) {
          corr = look(rest)
          beads = inked.filter((_, k) => corr[k] >= 0.5)
        }
      }
      // with hardly any alike, there is no bead of this colour: all of it is watermark
      inked.forEach((i, k) => {
        if (beads.length < 3 || corr[k] < WATERMARK_CORR) empty[i] = 1
      })
    }
  }
  const assign = new Int16Array(n).fill(-1)
  const confidence = new Float32Array(n)
  const unsure = new Uint8Array(n)
  const G = groups.length
  const corr = new Float32Array(G)
  const cd = new Float32Array(G)
  for (let i = 0; i < n; i++) {
    if (!G) break
    const v = unit(cells.ink, 1 / 255, tmp, i * INK * INK)
    let minCd = Infinity
    for (let g = 0; g < G; g++) {
      const t = templates[g]
      let s = 0
      for (let j = 0; j < t.length; j++) s += t[j] * v[j]
      corr[g] = s
      const c = groups[g].colour
      cd[g] = Math.abs(cells.fill[i * 3] - c.r) + Math.abs(cells.fill[i * 3 + 1] - c.g) + Math.abs(cells.fill[i * 3 + 2] - c.b)
      minCd = Math.min(minCd, cd[g])
    }
    // a cell whose colour fits no group is probably under a watermark: its tint is not evidence,
    // so let the label shape decide and only use colour as a weak hint
    const weight = minCd > 45 ? 1 / 500 : 1 / 120
    let best = -1
    let s1 = -Infinity
    let s2 = -Infinity
    for (let g = 0; g < G; g++) {
      const s = corr[g] - cd[g] * weight
      if (s > s1) {
        s2 = s1
        s1 = s
        best = g
      } else if (s > s2) s2 = s
    }
    const margin = G > 1 ? s1 - s2 : 1
    const isBead = blank === undefined || (cells.share[i] > 0.06 && corr[best] > 0.35)
    if (!isBead) continue
    assign[i] = best
    confidence[i] = Math.max(0, Math.min(1, margin))
    if (margin < 0.12 || corr[best] < 0.3 || cd[best] > 90) unsure[i] = 1
  }
  return { grid, extent, cells, fit, groups, assign, confidence, unsure, empty }
}

export function countByCode(rec: Recognition, names?: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const g of rec.assign) {
    if (g < 0) continue
    const code = names ? names[g] : rec.groups[g].code
    out.set(code, (out.get(code) ?? 0) + 1)
  }
  return out
}
