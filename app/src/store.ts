// The chart library, kept in this browser's IndexedDB. Each chart keeps the original image, the
// final code of every cell, and the editing state so it can be reopened and corrected later.
import type { Extent, Grid } from './engine/grid'
import type { Rect } from './engine/legendArea'

export type Status = 'todo' | 'doing' | 'done'
export const STATUS_LABEL: Record<Status, string> = { todo: '未拼', doing: '在拼', done: '已拼' }

/** Bumped whenever the recogniser changes how it groups cells: an editing state saved by an older
 *  recogniser cannot be laid back onto a fresh run, and the per-cell codes are used instead. */
export const ENGINE_VERSION = 2

export interface Chart {
  id: string
  title: string
  /** The page link used to import the chart, when it came from an external source. */
  sourceUrl?: string
  status: Status
  tags: string[]
  createdAt: number
  updatedAt: number
  image: Blob
  thumb: Blob
  cols: number
  rows: number
  /** final code of each cell, row by row; '' for an empty cell */
  cells: string[]
  /** the cells as recognised and saved from the recognition, before any hand editing (missing
   *  on charts saved before it was kept: the editor keeps the cells it first opened instead) */
  original?: string[]
  /** code -> beads, from `cells` */
  counts: Record<string, number>
  /** counts as printed on the chart's legend, where entered */
  legend: Record<string, number>
  legendRect: Rect | null
  edit: { engine: number; names: string[]; assign: number[] }
  /** where the board lies in the image, as confirmed when saved; `cells` follows it. Missing on
   *  charts saved before it was kept: reopening then has to find it again. */
  board?: { grid: Grid; extent: Extent }
  /** its beads were taken out of the stock when it was marked done (so they are not taken twice) */
  stockTaken?: boolean
  /** when it was marked done (missing on charts finished before this was kept) */
  doneAt?: number
  /** beading progress: pegboard and mirroring chosen, codes ticked off, seconds spent */
  progress?: { board?: number; mirror?: boolean; labels?: boolean; offset?: { x: number; y: number }; done: string[]; seconds: number }
}

const DB = 'pindou'
const STORE = 'charts'
/** single records by id: the bead stock */
const META = 'meta'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      // another tab opening a newer version must not wait on this connection
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, store = STORE): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => {
      d.close()
      resolve(req.result as T)
    }
    tx.onerror = () => {
      d.close()
      reject(tx.error)
    }
    tx.onabort = () => {
      d.close()
      reject(tx.error)
    }
  })
}

export const listCharts = async () => (await run<Chart[]>('readonly', (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt)
export const getChart = (id: string) => run<Chart | undefined>('readonly', (s) => s.get(id))
export const putChart = (c: Chart) => run<IDBValidKey>('readwrite', (s) => s.put(c))
export const deleteChart = (id: string) => run<undefined>('readwrite', (s) => s.delete(id))

/** Ask the browser not to evict the library under storage pressure or after a period of disuse. */
export async function persist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export function countCells(cells: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cells) if (c) out[c] = (out[c] ?? 0) + 1
  return out
}

// ------------------------------------------------------------------ stock

export interface StockEntry {
  at: number
  kind: 'restock' | 'used' | 'returned' | 'set'
  /** what it was, for the record: "补货", a chart's title */
  note: string
  /** beads added (positive) or taken (negative), by code */
  delta: Record<string, number>
  chartId?: string
}

export interface Stock {
  id: 'stock'
  /** beads on hand, by code */
  beads: Record<string, number>
  /** newest first */
  log: StockEntry[]
  updatedAt: number
}

const LOG_KEEP = 300

export async function getStock(): Promise<Stock> {
  return (await run<Stock | undefined>('readonly', (s) => s.get('stock'), META)) ?? { id: 'stock', beads: {}, log: [], updatedAt: 0 }
}

export const putStock = (s: Stock) => run<IDBValidKey>('readwrite', (st) => st.put(s), META)

/** Adds (or with negative numbers takes) beads and records it; counts never go below zero. */
export async function changeStock(entry: Omit<StockEntry, 'at'>): Promise<Stock> {
  const stock = await getStock()
  const beads = { ...stock.beads }
  for (const [code, n] of Object.entries(entry.delta)) beads[code] = Math.max(0, (beads[code] ?? 0) + n)
  const next: Stock = { ...stock, beads, log: [{ ...entry, at: Date.now() }, ...stock.log].slice(0, LOG_KEEP), updatedAt: Date.now() }
  await putStock(next)
  return next
}

/** Takes back the newest record. */
export async function undoStock(): Promise<Stock> {
  const stock = await getStock()
  const [last, ...rest] = stock.log
  if (!last) return stock
  const beads = { ...stock.beads }
  for (const [code, n] of Object.entries(last.delta)) beads[code] = Math.max(0, (beads[code] ?? 0) - n)
  const next: Stock = { ...stock, beads, log: rest, updatedAt: Date.now() }
  await putStock(next)
  return next
}

// ------------------------------------------------------------------ backup

const toDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

/** Everything in one JSON file, images included, so it can be restored on any device. */
export async function exportBackup(): Promise<Blob> {
  const charts = await listCharts()
  const out = []
  for (const c of charts) out.push({ ...c, image: await toDataUrl(c.image), thumb: await toDataUrl(c.thumb) })
  return new Blob([JSON.stringify({ app: 'pindou', version: 2, exportedAt: Date.now(), charts: out, stock: await getStock() })], { type: 'application/json' })
}

/** Adds the charts from a backup; a chart that is already here is kept if it is newer. */
export async function importBackup(file: Blob): Promise<{ added: number; updated: number; skipped: number }> {
  const data = JSON.parse(await file.text())
  if (data?.app !== 'pindou' || !Array.isArray(data.charts)) throw new Error('这不是拼豆图纸的备份文件')
  const result = { added: 0, updated: 0, skipped: 0 }
  for (const raw of data.charts) {
    const chart: Chart = { ...raw, image: await (await fetch(raw.image)).blob(), thumb: await (await fetch(raw.thumb)).blob() }
    const existing = await getChart(chart.id)
    if (existing && existing.updatedAt >= chart.updatedAt) {
      result.skipped++
      continue
    }
    await putChart(chart)
    if (existing) result.updated++
    else result.added++
  }
  // the stock comes along when the backup's is newer than this device's
  if (data.stock?.id === 'stock' && data.stock.updatedAt > (await getStock()).updatedAt) await putStock(data.stock)
  return result
}
