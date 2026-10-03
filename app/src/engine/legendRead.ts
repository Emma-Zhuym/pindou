// From legend to board: which code each cell is.
//   readLocally: find the legend swatches (two finders, keep the one that explains the board
//     better), name them, give every cell its nearest swatch.
//   fitList: the same, starting from a list of codes and counts read off the legend by someone
//     else (a vision model, or the person). Codes are matched to the board's colours by catalogue
//     colour, local swatches and, above all, the printed counts.
// Both return groups in the shape the review screens use: one group per code, cells pointing at it.
import { CORE, INK, stack, unit } from './cells'
import { CATALOGUE, type Rgb, type TextRenderer } from './glyphs'
import type { Raster } from './grid'
import { findLegend } from './legendArea'
import { nameSwatches } from './legendNames'
import { findSwatchesByColour } from './legendPatches'
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
}

export interface LegendEntry {
  code: string
  count?: number
}

const NEAR = 30
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
function refineByLabels(rec: Recognition, colours: Rgb[], assign: Int16Array): Int16Array {
  const { fill, share, ink } = rec.cells
  const G = colours.length
  const cd = (i: number, g: number) => dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], colours[g])
  const members: number[][] = colours.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0 && share[i] > 0.06) members[g].push(i)
  })
  const looks = members.map((m, g) => {
    if (m.length < 3) return null
    const sure = [...m].sort((a, b) => cd(a, g) - cd(b, g)).slice(0, Math.max(3, Math.min(400, Math.ceil(m.length / 2))))
    return unit(stack(rec.cells, sure))
  })
  const out = Int16Array.from(assign)
  const v = new Float32Array(CORE * CORE)
  // A chart that leaves cells empty prints a code in every bead, so a cell with no code in it is
  // empty, whatever colour a watermark gave it.
  const gaps = rec.empty.some((e) => e === 1)
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
    for (let g = 0; g < G; g++) if (looks[g]) bestLook = Math.max(bestLook, like(g))
    if (gaps && bestLook < NO_CODE) {
      out[i] = -1
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
  return out
}

function groupsFrom(rec: Recognition, codes: string[], colours: Rgb[], assign: Int16Array): Group[] {
  const members: number[][] = codes.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0) members[g].push(i)
  })
  return codes.map((code, g) => ({ code, score: 1, colour: colours[g], label: stack(rec.cells, members[g].slice(0, 400)) }))
}

/** Several swatches named alike (a misread) become one group; the first colour stays the reference. */
function merge(rec: Recognition, codes: string[], colours: Rgb[], unsure: boolean[]) {
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
  const assign = refineByLabels(rec, refs, raw.map((k) => (k < 0 ? -1 : to[k])))
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
  )
  return { ...m, swatches: named }
}

/**
 * A legend list (codes, usually with counts) laid onto the board. Each code starts from the colour
 * of the local swatch carrying its name, else its catalogue colour; the colours then settle on the
 * board's actual colours (k-means); finally codes of similar colour swap places whenever that
 * brings the cell counts closer to the printed ones.
 */
export function fitList(rec: Recognition, list: LegendEntry[], local?: Reading | null): Reading {
  const codes = list.map((e) => e.code)
  const seed = new Map<string, Rgb>()
  local?.groups.forEach((g) => seed.set(g.code, g.colour))
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
  assign = refineByLabels(rec, centres, assign)
  const coverage = nearest(rec, centres).coverage
  const named = new Set(local?.groups.map((g) => g.code))
  return { groups: groupsFrom(rec, codes, centres, assign), assign, coverage, unsureName: codes.map((c) => !named.has(c)), swatches: local?.swatches ?? [] }
}

/** The recognition with its groups replaced by a legend reading. A cell is worth a second look
 *  when its colour is far from its code's, or its code's name is a guess. */
export function applyReading(rec: Recognition, reading: Reading): Recognition {
  const { fill } = rec.cells
  const n = reading.assign.length
  const confidence = new Float32Array(n)
  const unsure = new Uint8Array(n)
  reading.assign.forEach((g, i) => {
    if (g < 0) return
    const d = dist(fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2], reading.groups[g].colour)
    confidence[i] = Math.max(0, 1 - d / (2 * NEAR))
    if (d >= NEAR || reading.unsureName[g]) unsure[i] = 1
  })
  return { ...rec, groups: reading.groups, assign: reading.assign, confidence, unsure }
}

/** Whether a local reading should be checked by a vision model (when one is set up). */
export function needsHelp(reading: Reading | null): boolean {
  if (!reading) return true
  const guesses = reading.unsureName.filter(Boolean).length
  return reading.coverage < 0.95 || guesses > 0.3 * reading.groups.length
}
