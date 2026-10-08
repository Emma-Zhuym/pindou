// From legend to board: which code each cell is.
//   readLocally: find the legend swatches (two finders, keep the one that explains the board
//     better), name them, give every cell its nearest swatch.
//   fitList: the same, starting from a list of codes and counts read off the legend by someone
//     else (a vision model, or the person). Codes are matched to the board's colours by catalogue
//     colour, local swatches and, above all, the printed counts.
// Both return groups in the shape the review screens use: one group per code, cells pointing at it.
import { CORE, INK, stack, unit } from './cells'
import { CATALOGUE, CODES, hasLabel, makeReader, type Reader, type Rgb, type TextRenderer } from './glyphs'
import type { Raster } from './grid'
import { findLegend } from './legendArea'
import { readCounts } from './legendCounts'
import { nameSwatches } from './legendNames'
import { findSwatchesByColour } from './legendPatches'
import { nameClasses, printClasses } from './printClasses'
import { findLegendSwatches, type LegendSwatch } from './legendSwatches'
import type { Group, Recognition } from './recognize'

export interface Reading {
  groups: Group[]
  /** group per cell, -1 for empty */
  assign: Int16Array
  /** per group: the name is a guess worth a look */
  unsureName: boolean[]
  /** share of non-empty cells whose colour a group explains (within NEAR) */
  coverage: number
  swatches: LegendSwatch[]
  /** counts read off the legend print, by code (local reading only; the AI list has its own) */
  printed?: Record<string, number>
  /** per cell: worth a second look (a list's reading; a local one judges by colour and names) */
  doubt?: Uint8Array
  /** cells of one colour and one print, the most typical first (a list's reading) */
  classes?: number[][]
}

export interface LegendEntry {
  code: string
  count?: number
}

const NEAR = 30
const PRINT_MIN_CELLS = 5 // a group this small is read too faintly to rename
const PRINT_READ = 0.6 // a clear reading of a stacked label
const PRINT_MARGIN = 0.03 // ...and this far ahead of the next code and of its current name
const PRINT_COLOUR = 90 // ...naming a code whose catalogue colour is this near the cells (or nearer than the old name's)
const TWIN = 12 // swatch colours this close are one printed colour: only the code tells them apart
const LOOK_ALIKE = 60 // colours this much further than a cell's nearest still compete on the printed code
const LOOK_COLOUR = 120 // colour distance worth one unit of label likeness
const NO_CODE = 0.35 // below this likeness to every code, a cell prints none
const TINTED_GAP = 0.05 // another code's print fitting this much better makes the colour suspect
const TINTED_COLOUR = 500 // ...and then colour weighs this little
const MAX_SWATCHES = 120
const dist = (r: number, g: number, b: number, c: Rgb) => Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)

/** nearest colour per non-empty cell, and the share that is within NEAR */
function nearest(rec: Recognition, colours: Rgb[]): { assign: Int16Array; coverage: number } {
  const { fill } = rec.cells
  const assign = new Int16Array(rec.empty.length).fill(-1)
  let beads = 0
  let near = 0
  for (let i = 0; i < assign.length; i++) {
    if (rec.empty[i]) continue
    beads++
    let best = -1
    let bd = Infinity
    colours.forEach((c, k) => {
      const d = dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], c)
      if (d < bd) {
        bd = d
        best = k
      }
    })
    assign[i] = best
    if (bd < NEAR) near++
  }
  return { assign, coverage: beads ? near / beads : 0 }
}

/**
 * Look-alike colours (several greys, several blues) blur together under JPEG noise, but every cell
 * also prints its code. Each code's look is learnt from its surest cells (the stack of those
 * closest to its colour); then every cell takes the code whose look and colour together fit it
 * best among the colours near its own. Learnt from the chart itself, so no font is assumed.
 */
function refineByLabels(rec: Recognition, colours: Rgb[], assign: Int16Array, examples?: (number[] | null)[]): Int16Array {
  const { fill, share, ink } = rec.cells
  const G = colours.length
  const cd = (i: number, g: number) => dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], colours[g])
  const members: number[][] = colours.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0 && share[i] > 0.06) members[g].push(i)
  })
  const looks = members.map((m, g) => {
    const given = examples?.[g]
    if (given) return unit(stack(rec.cells, given))
    if (m.length < 3) return null
    const sure = [...m].sort((a, b) => cd(a, g) - cd(b, g)).slice(0, Math.max(3, Math.min(400, Math.ceil(m.length / 2))))
    return unit(stack(rec.cells, sure))
  })
  const out = Int16Array.from(assign)
  const v = new Float32Array(CORE * CORE)
  // A chart that leaves cells empty prints a code in every bead, so a cell with no code in it is
  // empty, whatever colour a watermark gave it.
  const gaps = rec.empty.some((e) => e === 1)
  const noCode: number[] = []
  for (let i = 0; i < assign.length; i++) {
    if (assign[i] < 0) continue
    if (share[i] <= 0.06) {
      if (gaps) out[i] = -1
      continue
    }
    unit(ink, 1 / 255, v, i * INK * INK)
    const like = (g: number) => {
      const t = looks[g]!
      let c = 0
      for (let k = 0; k < t.length; k++) c += t[k] * v[k]
      return c
    }
    const own = looks[assign[i]] ? like(assign[i]) : 1
    let nearest = Infinity
    for (let g = 0; g < G; g++) nearest = Math.min(nearest, cd(i, g))
    // Usually only colours near the cell's own compete. When another code's print fits the cell
    // clearly better than its colour's code, the colour itself is suspect (a watermark tints the
    // cell), so every code competes on its look, colour counting little.
    let bestLook = -Infinity
    let bestLookAt = assign[i]
    for (let g = 0; g < G; g++) {
      if (!looks[g]) continue
      const l = like(g)
      if (l > bestLook) {
        bestLook = l
        bestLookAt = g
      }
    }
    if (gaps && bestLook < NO_CODE) {
      // decided below, once the empty cells around it are known; if it stays a bead, its faint
      // print is a better guess than its tinted colour
      noCode.push(i)
      out[i] = bestLookAt
      continue
    }
    const tinted = bestLook - own > TINTED_GAP
    const pool: number[] = []
    for (let g = 0; g < G; g++) if (looks[g] && (tinted || cd(i, g) < nearest + LOOK_ALIKE)) pool.push(g)
    // a near code without a learnt look cannot be compared fairly: leave the cell to colour
    if (pool.length < 2 || (!tinted && pool.length < [...Array(G).keys()].filter((g) => cd(i, g) < nearest + LOOK_ALIKE).length)) continue
    let best = assign[i]
    let top = -Infinity
    for (const g of pool) {
      const sc = like(g) - cd(i, g) / (tinted ? TINTED_COLOUR : LOOK_COLOUR)
      if (sc > top) {
        top = sc
        best = g
      }
    }
    out[i] = best
  }
  // Empty cells lie together around the picture; a cell with beads on most sides is a bead whose
  // code a watermark hides, so it keeps its colour's code.
  const { cols, rows } = rec.cells
  let changed = true
  while (changed) {
    changed = false
    for (const i of noCode) {
      if (out[i] < 0) continue
      const x = i % cols
      const y = (i - x) / cols
      let open = 0
      for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (a < 0 || b < 0 || a >= cols || b >= rows || out[b * cols + a] < 0) open++
      }
      if (open >= 2) {
        out[i] = -1
        changed = true
      }
    }
  }
  return out
}

function groupsFrom(rec: Recognition, codes: string[], colours: Rgb[], assign: Int16Array): Group[] {
  const members: number[][] = codes.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0) members[g].push(i)
  })
  return codes.map((code, g) => ({ code, score: 1, colour: colours[g], label: stack(rec.cells, members[g].slice(0, 400)) }))
}

/**
 * Codes printed in the same colour (H1 and H2 both drawn plain white) cannot be told apart by
 * colour, so the cells nearest each one's colour are a mixture and teach a blurred print. For such
 * twins the cells to learn from are picked by reading: those whose print reads clearly as one twin
 * rather than the others. Only the examples change; every cell is still decided by refineByLabels.
 */
function twinExamples(rec: Recognition, names: string[], colours: Rgb[], assign: Int16Array, reader: Reader): (number[] | null)[] {
  const G = names.length
  const twinOf = names.map((_, g) => g)
  for (let g = 0; g < G; g++)
    for (let h = g + 1; h < G; h++) if (twinOf[h] === h && dist(colours[g].r, colours[g].g, colours[g].b, colours[h]) < TWIN) twinOf[h] = twinOf[g]
  const sets = new Map<number, number[]>()
  twinOf.forEach((t, g) => sets.set(t, [...(sets.get(t) ?? []), g]))
  const out: (number[] | null)[] = names.map(() => null)
  const { ink, share } = rec.cells
  const cell = new Float32Array(INK * INK)
  for (const set of sets.values()) {
    if (set.length < 2 || !set.every((g) => CODES.includes(names[g]))) continue
    const idx = set.map((g) => CODES.indexOf(names[g]))
    const picks: [number, number][][] = set.map(() => [])
    for (let i = 0; i < assign.length; i++) {
      if (!set.includes(assign[i]) || share[i] <= 0.06) continue
      for (let k = 0; k < cell.length; k++) cell[k] = ink[i * INK * INK + k] / 255
      const sc = reader.some(cell, idx)
      let best = 0
      for (let k = 1; k < sc.length; k++) if (sc[k] > sc[best]) best = k
      let second = -Infinity
      for (let k = 0; k < sc.length; k++) if (k !== best) second = Math.max(second, sc[k])
      picks[best].push([i, sc[best] - second])
    }
    set.forEach((g, k) => {
      const clear = picks[k].sort((a, b) => b[1] - a[1]).slice(0, Math.max(3, Math.min(400, Math.ceil(picks[k].length / 2))))
      if (clear.length >= 3) out[g] = clear.map(([i]) => i)
    })
  }
  return out
}

/** Several swatches named alike (a misread) become one group; the first colour stays the reference. */
function merge(rec: Recognition, codes: string[], colours: Rgb[], unsure: boolean[], reader?: Reader) {
  const first = new Map<string, number>()
  const keep: number[] = []
  const to = codes.map((c, k) => {
    if (!first.has(c)) {
      first.set(c, keep.length)
      keep.push(k)
    }
    return first.get(c)!
  })
  const names = keep.map((k) => codes[k])
  const refs = keep.map((k) => colours[k])
  const { assign: raw, coverage } = nearest(rec, colours)
  const byColour = raw.map((k) => (k < 0 ? -1 : to[k]))
  const assign = refineByLabels(rec, refs, byColour, reader ? twinExamples(rec, names, refs, byColour, reader) : undefined)
  return { groups: groupsFrom(rec, names, refs, assign), assign, coverage, unsureName: keep.map((k) => unsure[k]) }
}

export function readLocally(img: Raster, rec: Recognition, render: TextRenderer): Reading | null {
  const area = findLegend(img, rec)
  // a legend lists a handful to a few dozen colours; hundreds of "swatches" are print, not swatches
  const candidates = [findSwatchesByColour(img, rec), area ? findLegendSwatches(img, area, rec.grid.perX) : []].filter((s) => s.length >= 2 && s.length <= MAX_SWATCHES)
  if (!candidates.length) return null
  // Every extra swatch can only raise coverage, so among finders that explain the board about as
  // well, the one with fewer swatches wins.
  const scored = candidates.map((s) => ({ s, coverage: nearest(rec, s.map((w) => w.colour)).coverage }))
  const best = Math.max(...scored.map((c) => c.coverage))
  const swatches = scored.filter((c) => c.coverage >= best - 0.02).sort((a, b) => a.s.length - b.s.length)[0].s
  const { names, swatches: named } = nameSwatches(img, rec, swatches, render)
  if (!named.length) return null
  const m = merge(
    rec,
    names.map((n) => n.code),
    named.map((s) => s.colour),
    names.map((n) => !n.sure),
    makeReader(render, rec.fit),
  )
  // the legend's own counts, read with digits learnt from how many cells each swatch got
  const perSwatch = named.map(() => 0)
  for (const k of nearest(rec, named.map((s) => s.colour)).assign) if (k >= 0) perSwatch[k]++
  const printed: Record<string, number> = {}
  readCounts(img, named, perSwatch).forEach((n, k) => {
    const code = names[k].code
    if (n !== null && !(code in printed) && names.filter((x) => x.code === code).length === 1) printed[code] = n
  })
  return { ...m, swatches: named, printed }
}

/**
 * A legend list (codes, usually with counts) laid onto the board. Each code starts from the colour
 * of the local swatch carrying its name, else its catalogue colour; the colours then settle on the
 * board's actual colours (k-means); finally codes of similar colour swap places whenever that
 * brings the cell counts closer to the printed ones.
 */
export function fitList(rec: Recognition, list: LegendEntry[], local?: Reading | null, render?: TextRenderer): Reading {
  const codes = list.map((e) => e.code)
  const seed = new Map<string, Rgb>()
  local?.groups.forEach((g) => seed.set(g.code, g.colour))
  // A swatch of this chart's own legend whose code was read surely: the colour this chart draws
  // that code in, better than the catalogue's (charts shade codes their own way)
  const sure = new Map<string, Rgb>()
  local?.groups.forEach((g, k) => {
    if (!local.unsureName[k]) sure.set(g.code, g.colour)
  })
  const swatch = codes.map((c) => sure.get(c) ?? null)
  let centres: Rgb[] = codes.map((c) => seed.get(c) ?? CATALOGUE[c] ?? { r: 128, g: 128, b: 128 })
  const { fill } = rec.cells
  let assign = nearest(rec, centres).assign
  for (let it = 0; it < 6; it++) {
    const sum = centres.map(() => [0, 0, 0, 0])
    assign.forEach((g, i) => {
      if (g < 0) return
      sum[g][0] += fill[i * 3]
      sum[g][1] += fill[i * 3 + 1]
      sum[g][2] += fill[i * 3 + 2]
      sum[g][3]++
    })
    // a code with no cells keeps its seed (it may be a colour the chart barely uses)
    centres = centres.map((c, g) => (sum[g][3] ? { r: sum[g][0] / sum[g][3], g: sum[g][1] / sum[g][3], b: sum[g][2] / sum[g][3] } : c))
    assign = nearest(rec, centres).assign
  }

  // printed counts settle look-alike colours
  const want = list.map((e) => e.count)
  if (want.some((n) => n !== undefined)) {
    const have = () => {
      const n = new Array<number>(codes.length).fill(0)
      for (const g of assign) if (g >= 0) n[g]++
      return n
    }
    const off = (n: number[], order: number[]) => order.reduce((a, g, k) => a + (want[k] === undefined ? 0 : Math.abs(n[g] - want[k]!)), 0)
    // order[k] = which colour cluster carries code k
    const order = codes.map((_, k) => k)
    const n = have()
    let improved = true
    while (improved) {
      improved = false
      for (let a = 0; a < codes.length; a++) {
        for (let b = a + 1; b < codes.length; b++) {
          const ca = centres[order[a]]
          const cb = centres[order[b]]
          if (dist(ca.r, ca.g, ca.b, cb) > 120) continue
          const before = off(n, order)
          ;[order[a], order[b]] = [order[b], order[a]]
          if (off(n, order) < before) improved = true
          else [order[a], order[b]] = [order[b], order[a]]
        }
      }
    }
    // cluster order[k] is code k
    const codeOf = new Array<number>(codes.length)
    order.forEach((g, k) => (codeOf[g] = k))
    assign = assign.map((g) => (g < 0 ? -1 : codeOf[g]))
    centres = codes.map((_, k) => centres[order[k]])
  }
  // the print on the cells has the last word on names: colours and counts only guessed
  if (render) {
    const named = nameByPrint(rec, codes, centres, assign, makeReader(render, rec.fit))
    if (named) {
      assign = named
      centres = codes.map((_, k) => meanFill(rec, assign, k) ?? centres[k])
    }
  }
  assign = refineByLabels(rec, centres, assign)
  const coverage = nearest(rec, centres).coverage
  const { assign: byPrint, doubt, classes } = classesNamed(rec, codes, want, centres, assign, swatch)
  assign = byPrint
  centres = codes.map((_, k) => meanFill(rec, assign, k) ?? centres[k])
  // the names came from the list: none is a guess
  return { groups: groupsFrom(rec, codes, centres, assign), assign, coverage, unsureName: codes.map(() => false), swatches: local?.swatches ?? [], doubt, classes }
}

/**
 * The cells in classes of one colour and one print (printClasses.ts), each class named as a whole:
 * whole codes trade places where the printed counts say so, and cells of a code take its name
 * together. Cells worth a second look: those of a class another code would fit nearly as well, and
 * those whose colour is far from every code's with no print to go by.
 */
function classesNamed(rec: Recognition, codes: string[], want: (number | undefined)[], colours: Rgb[], assign: Int16Array, swatch: (Rgb | null)[]) {
  const { share, fill } = rec.cells
  const beads: number[] = []
  const fixed = codes.map(() => 0)
  assign.forEach((g, i) => {
    if (g < 0) return
    if (share[i] > 0.06) beads.push(i)
    else fixed[g]++
  })
  const classes = printClasses(rec.cells, beads)
  const given = classes.map((c) => {
    const n = new Map<number, number>()
    for (const i of c.cells) n.set(assign[i], (n.get(assign[i]) ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1])[0][0]
  })
  const named = nameClasses(classes, codes, given, want, colours, fixed, swatch)
  const out = Int16Array.from(assign)
  const doubt = new Uint8Array(assign.length)
  classes.forEach((c, j) => {
    for (const i of c.cells) {
      out[i] = named.code[j]
      if (named.doubt[j]) doubt[i] = 1
    }
  })
  assign.forEach((g, i) => {
    if (g >= 0 && share[i] <= 0.06 && dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], colours[g]) >= NEAR) doubt[i] = 1
  })
  return { assign: out, doubt, classes: classes.map((c) => c.cells) }
}

/**
 * Each group's cells stacked and read: where the print reads clearly as another code of the list,
 * the group takes that name (two groups reading the same code become one). Colour and printed
 * counts cannot tell pale or dark look-alikes apart (H10, A23 and G18 all near white); the code
 * printed in every cell can. Only a code whose colour fits the cells is taken: small print misreads
 * land on codes of any colour. Null when nothing changes.
 */
function nameByPrint(rec: Recognition, codes: string[], centres: Rgb[], assign: Int16Array, reader: Reader): Int16Array | null {
  const { share } = rec.cells
  const members: number[][] = codes.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0 && share[i] > 0.06) members[g].push(i)
  })
  const idx = codes.map((c) => CODES.indexOf(c))
  const target = codes.map((_, k) => k)
  let changed = false
  codes.forEach((_, k) => {
    if (members[k].length < PRINT_MIN_CELLS) return
    const st = stack(rec.cells, members[k].slice(0, 400))
    if (!hasLabel(st)) return
    const all = reader.all(st)
    const sc = idx.map((c) => (c >= 0 ? all[c] : -1))
    let best = 0
    for (let j = 1; j < sc.length; j++) if (sc[j] > sc[best]) best = j
    let second = -Infinity
    for (let j = 0; j < sc.length; j++) if (j !== best) second = Math.max(second, sc[j])
    // a misreading of small print lands on codes of any colour; the right code looks like its cells
    const c = centres[k]
    const off = (code: string) => (CATALOGUE[code] ? dist(c.r, c.g, c.b, CATALOGUE[code]) : Infinity)
    const plausible = off(codes[best]) <= Math.max(PRINT_COLOUR, off(codes[k]))
    if (best !== k && plausible && sc[best] >= PRINT_READ && sc[best] - second >= PRINT_MARGIN && sc[best] - sc[k] >= PRINT_MARGIN) {
      target[k] = best
      changed = true
    }
  })
  return changed ? assign.map((g) => (g < 0 ? -1 : target[g])) : null
}

/** the mean fill of the cells given code k, or null if none */
function meanFill(rec: Recognition, assign: Int16Array, k: number): Rgb | null {
  const { fill } = rec.cells
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  assign.forEach((a, i) => {
    if (a !== k) return
    r += fill[i * 3]
    g += fill[i * 3 + 1]
    b += fill[i * 3 + 2]
    n++
  })
  return n ? { r: r / n, g: g / n, b: b / n } : null
}

/** The recognition with its groups replaced by a legend reading. A cell is worth a second look
 *  where the reading says so; else when its colour is far from its code's, or its code's name is
 *  a guess. Doubtful cells come first when ordered by confidence. */
export function applyReading(rec: Recognition, reading: Reading): Recognition {
  const { fill } = rec.cells
  const n = reading.assign.length
  const confidence = new Float32Array(n)
  const unsure = new Uint8Array(n)
  reading.assign.forEach((g, i) => {
    if (g < 0) return
    const d = dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], reading.groups[g].colour)
    confidence[i] = Math.max(0, 1 - d / (2 * NEAR))
    if (reading.doubt) {
      unsure[i] = reading.doubt[i]
      confidence[i] = unsure[i] ? confidence[i] / 2 : 0.5 + confidence[i] / 2
    } else if (d >= NEAR || reading.unsureName[g]) unsure[i] = 1
  })
  return { ...rec, groups: reading.groups, assign: reading.assign, confidence, unsure, classes: reading.classes }
}

/** Whether a local reading should be checked by a vision model (when one is set up). */
export function needsHelp(reading: Reading | null): boolean {
  if (!reading) return true
  const guesses = reading.unsureName.filter(Boolean).length
  return reading.coverage < 0.95 || guesses > 0.3 * reading.groups.length
}
