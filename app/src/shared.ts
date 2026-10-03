// Small pieces shared by the library and the recognition flow.
import { useEffect, useState } from 'react'
import { CATALOGUE, type Rgb } from './engine/glyphs'

export const GREY: Rgb = { r: 200, g: 200, b: 200 }
export const css = (c: Rgb) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
export const codeColour = (code: string) => css(CATALOGUE[code] ?? GREY)

export const codeOrder = (a: string, b: string) => {
  const pa = /^([A-Z]+)(\d+)$/.exec(a)
  const pb = /^([A-Z]+)(\d+)$/.exec(b)
  if (!pa || !pb) return a.localeCompare(b)
  return pa[1] === pb[1] ? Number(pa[2]) - Number(pb[2]) : pa[1].localeCompare(pb[1])
}

/** The board drawn in bead colours, one square per cell. */
export function drawBoard(canvas: HTMLCanvasElement, cols: number, rows: number, cells: string[], maxSide: number) {
  const px = Math.max(1, Math.floor(maxSide / Math.max(cols, rows)))
  canvas.width = cols * px
  canvas.height = rows * px
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue
    ctx.fillStyle = codeColour(cells[i])
    ctx.fillRect((i % cols) * px, Math.floor(i / cols) * px, px, px)
  }
}

export async function boardThumb(cols: number, rows: number, cells: string[]): Promise<Blob> {
  const c = document.createElement('canvas')
  drawBoard(c, cols, rows, cells, 320)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('缩略图生成失败'))), 'image/png'))
}

export const ICONS = {
  charts: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  stock: 'M4 13.5 6.5 6h11l2.5 7.5M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5M4 13.5h4.5l1 2h5l1-2H20',
  stats: 'M4 20h16M7 20v-7M12 20V5M17 20v-10',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.1L14.8 21h-4l-.3-2.5a7 7 0 0 1-2-1.1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 10l2-3.4 1.9.7a7 7 0 0 1 2-1.1L10.8 3h4l.3 2.5a7 7 0 0 1 2 1.1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
}

// Some browser features exist only on https or localhost ("secure contexts"). Opened from another
// device by address (http://192.168…), the app goes without them; these work either way.

/** A random id for a new record. */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // a version-4 UUID, like randomUUID's
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Puts text on the clipboard; false if the browser would not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the old way
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  return ok
}

/** A blob shown as an <img>, with its object URL released when no longer needed. */
export function useBlobUrl(blob: Blob | undefined) {
  // made and released by the same effect, so a re-run (as in development) never leaves a released URL
  const [url, setUrl] = useState('')
  useEffect(() => {
    const u = blob ? URL.createObjectURL(blob) : ''
    setUrl(u) // oxlint-disable-line react/set-state-in-effect -- the URL is the external thing being kept in step
    return () => void (u && URL.revokeObjectURL(u))
  }, [blob])
  return url
}
