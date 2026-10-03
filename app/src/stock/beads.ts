// Bead amounts: grams and bags as the shops sell them, the standard set, and reading a stock table.
import { CATALOGUE, CODES } from '../engine/glyphs'
import { codeOrder } from '../shared'

/** about this many beads to a gram */
export const PER_GRAM = 100
/** the bag sizes the shop sells, in grams */
export const BAGS = [12, 24, 40, 80]
/** the standard 221-colour set (A to H, M) */
export const SET_221 = CODES.filter((c) => /^[A-HM]\d+$/.test(c)).sort(codeOrder)
/** what the stock page lists even when empty: the set plus the clear L1 */
export const STANDARD = [...SET_221, 'L1']

export const grams = (beads: number) => {
  const g = beads / PER_GRAM
  return g >= 10 || Number.isInteger(g) ? `${Math.round(g)} 克` : `${g.toFixed(1)} 克`
}

/** "a01", "A01", " A1 " → "A1", or null if it is not a MARD code */
export function readCode(text: string): string | null {
  const code = text.toUpperCase().trim().replace(/^([A-Z]+)0+(\d)/, '$1$2')
  return code in CATALOGUE ? code : null
}

/** The bag that tops `missing` beads back up: the smallest that covers it, else the largest. */
export const bagFor = (missing: number) => BAGS.find((g) => g * PER_GRAM >= missing) ?? BAGS[BAGS.length - 1]

export interface TableRead {
  /** beads by code */
  beads: Record<string, number>
  /** lines that had something on them but no code and amount */
  skipped: string[]
}

/**
 * A stock table pasted or exported from a spreadsheet: a code and an amount on each line, split by
 * commas, tabs, semicolons or spaces. Amounts are beads, or grams with `unit` (or "12g", "12克").
 */
export function readTable(text: string, unit: 'beads' | 'grams'): TableRead {
  const beads: Record<string, number> = {}
  const skipped: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim()
    if (!line) continue
    const words = line.split(/[,，\t;；\s]+/).filter(Boolean).map((w) => w.replace(/^"|"$/g, ''))
    let code: string | null = null
    let amount: number | null = null
    for (const w of words) {
      if (!code) {
        code = readCode(w)
        if (code) continue
      }
      const m = /^(\d+(?:\.\d+)?)\s*(g|克)?$/i.exec(w)
      if (code && m) {
        amount = Number(m[1]) * (m[2] || unit === 'grams' ? PER_GRAM : 1)
        break
      }
    }
    if (code && amount !== null) beads[code] = (beads[code] ?? 0) + Math.round(amount)
    else skipped.push(line)
  }
  return { beads, skipped }
}

/** Grams if the table says so in its header or its amounts. */
export const looksLikeGrams = (text: string) => /克|gram|\d\s*g\b/i.test(text)
