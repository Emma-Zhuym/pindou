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
  /** code -> beads, from `cells` */
  counts: Record<string, number>
  /** counts as printed on the chart's legend, where entered */
  legend: Record<string, number>
  legendRect: Rect | null
  edit: { engine: number; names: string[]; assign: number[] }
  /** where the board lies in the image, as confirmed when saved; `cells` follows it. Missing on
   *  charts saved before it was kept: reopening then has to find it again. */
  board?: { grid: Grid; extent: Extent }
  /** beading progress: pegboard and mirroring chosen, codes ticked off, seconds spent */
  progress?: { board?: number; mirror?: boolean; labels?: boolean; offset?: { x: number; y: number }; done: string[]; seconds: number }
}

const DB = 'pindou'
const STORE = 'charts'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
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
  return new Blob([JSON.stringify({ app: 'pindou', version: 1, exportedAt: Date.now(), charts: out })], { type: 'application/json' })
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
  return result
}
