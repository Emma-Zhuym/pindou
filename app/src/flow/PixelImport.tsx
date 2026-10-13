import { useEffect, useMemo, useRef, useState } from 'react'
import { loadImage, toRaster } from '../browser'
import type { Raster } from '../engine/grid'
import { ALL_CODES, type Box, guessCell, readPixelArt } from '../engine/pixelArt'
import { Icon } from '../Icon'
import { boardThumb, drawBoard, ICONS, newId } from '../shared'
import { STANDARD } from '../stock/beads'
import { type Chart, countCells, putChart } from '../store'
import { SaveSheet } from './Flow'

/** an edge of the box can be picked up this far from the finger (CSS pixels) */
const EDGE_REACH = 28
type Side = 'top' | 'bottom' | 'left' | 'right'

/**
 * Pixel art (no codes printed in it) made into a chart: the person sets how many columns and rows
 * it has and drags the box onto the picture; each cell takes the MARD code nearest its colour.
 */
export function PixelImport({ file, existingTags, onClose, onSaved }: { file: Blob; existingTags: string[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [raster, setRaster] = useState<Raster | null>(null)
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 })
  const [cols, setCols] = useState('')
  const [rows, setRows] = useState('')
  const [dropPage, setDropPage] = useState(true)
  const [all, setAll] = useState(false)
  const [maxCodes, setMaxCodes] = useState('')
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const view = useRef<HTMLCanvasElement>(null)
  const result = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let alive = true
    loadImage(file)
      .then((image) => {
        if (!alive) return
        const r = toRaster(image)
        const k = guessCell(r)
        setImg(image)
        setRaster(r)
        setBox({ x: 0, y: 0, w: r.width, h: r.height })
        setCols(String(Math.max(1, Math.round(r.width / k))))
        setRows(String(Math.max(1, Math.round(r.height / k))))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [file])

  const nc = Math.max(1, Math.min(300, Math.round(Number(cols) || 0)))
  const nr = Math.max(1, Math.min(300, Math.round(Number(rows) || 0)))
  const max = Math.max(0, Math.round(Number(maxCodes) || 0))
  const cells = useMemo(
    () => (raster && cols && rows ? readPixelArt(raster, box, nc, nr, { dropPage, codes: all ? ALL_CODES : STANDARD, maxCodes: max }) : null),
    [raster, box, nc, nr, cols, rows, dropPage, all, max],
  )
  const counts = useMemo(() => (cells ? countCells(cells) : {}), [cells])
  const beads = Object.values(counts).reduce((a, b) => a + b, 0)

  // the picture with the box and its cell lines
  const scale = img ? Math.min(1, 900 / img.naturalWidth) : 1
  useEffect(() => {
    const c = view.current
    if (!c || !img) return
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const x = box.x * scale
    const y = box.y * scale
    const w = box.w * scale
    const h = box.h * scale
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, c.width, y)
    ctx.fillRect(0, y + h, c.width, c.height)
    ctx.fillRect(0, y, x, h)
    ctx.fillRect(x + w, y, c.width, h)
    if (w / nc >= 4 && h / nr >= 4) {
      ctx.strokeStyle = 'rgba(255, 45, 140, 0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let k = 1; k < nc; k++) {
        ctx.moveTo(x + (k * w) / nc, y)
        ctx.lineTo(x + (k * w) / nc, y + h)
      }
      for (let k = 1; k < nr; k++) {
        ctx.moveTo(x, y + (k * h) / nr)
        ctx.lineTo(x + w, y + (k * h) / nr)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = '#007aff'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, w, h)
  }, [img, box, nc, nr, scale])

  useEffect(() => {
    if (result.current && cells) drawBoard(result.current, nc, nr, cells, 900)
  }, [cells, nc, nr])

  // dragging an edge of the box, to the pixel
  const held = useRef<Side | null>(null)
  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = (img?.naturalWidth ?? 1) / r.width
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }
  }
  const pick = (e: React.PointerEvent<HTMLCanvasElement>): Side | null => {
    const { x, y, k } = toImage(e)
    const reach = EDGE_REACH * k
    const within = (v: number, a: number, b: number) => v > a - reach && v < b + reach
    const near: [Side, number][] = [
      ['top', within(x, box.x, box.x + box.w) ? Math.abs(y - box.y) : Infinity],
      ['bottom', within(x, box.x, box.x + box.w) ? Math.abs(y - box.y - box.h) : Infinity],
      ['left', within(y, box.y, box.y + box.h) ? Math.abs(x - box.x) : Infinity],
      ['right', within(y, box.y, box.y + box.h) ? Math.abs(x - box.x - box.w) : Infinity],
    ]
    const [side, d] = near.sort((a, b) => a[1] - b[1])[0]
    return d <= reach ? side : null
  }
  const drag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const side = held.current
    if (!side || !raster) return
    const { x, y } = toImage(e)
    const X = Math.round(Math.min(raster.width, Math.max(0, x)))
    const Y = Math.round(Math.min(raster.height, Math.max(0, y)))
    setBox((b) => {
      if (side === 'top') return { ...b, y: Math.min(Y, b.y + b.h - 2), h: b.y + b.h - Math.min(Y, b.y + b.h - 2) }
      if (side === 'bottom') return { ...b, h: Math.max(2, Y - b.y) }
      if (side === 'left') return { ...b, x: Math.min(X, b.x + b.w - 2), w: b.x + b.w - Math.min(X, b.x + b.w - 2) }
      return { ...b, w: Math.max(2, X - b.x) }
    })
  }

  async function save(meta: { title: string; status: Chart['status']; tags: string[] }) {
    if (!cells) return
    setSaving(true)
    try {
      const now = Date.now()
      const id = newId()
      await putChart({
        id,
        createdAt: now,
        updatedAt: now,
        ...meta,
        source: 'pixel',
        image: file,
        thumb: await boardThumb(nc, nr, cells),
        cols: nc,
        rows: nr,
        cells,
        original: cells,
        counts,
        legend: {},
        legendRect: null,
        edit: { engine: 0, names: [], assign: [] },
      })
      onSaved(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flow">
      <header className="flowbar">
        <button className="circle glass" aria-label="关闭" onClick={() => window.confirm('还没保存，确定离开吗？') && onClose()}>
          <Icon d={ICONS.close} size={20} />
        </button>
        <span className="flowname">像素画转图纸</span>
      </header>
      <div className="page">
        {error && <p className="error">{error}</p>}
        {!img && !error && <p className="hint">正在读取图片…</p>}
        {img && (
          <>
            <section className="card boardcheck">
              <div className="row">
                <b>格子</b>
                <span className="sub">
                  每格约 {(box.w / nc).toFixed(1)} × {(box.h / nr).toFixed(1)} 像素
                </span>
              </div>
              <div className="row">
                <input className="countinput" inputMode="numeric" value={cols} onChange={(e) => setCols(e.target.value.replace(/\D/g, ''))} aria-label="列数" />
                <span className="sub">列 ×</span>
                <input className="countinput" inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value.replace(/\D/g, ''))} aria-label="行数" />
                <span className="sub">行</span>
              </div>
              <canvas
                ref={view}
                className="boardcanvas"
                onPointerDown={(e) => {
                  held.current = pick(e)
                  if (held.current) e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={drag}
                onPointerUp={() => (held.current = null)}
                onPointerCancel={() => (held.current = null)}
              />
              <p className="hint">行列数按图的像素格填（程序先猜了一个）。蓝框要正好框住画，按住边拖动；粉线应该落在色块之间。</p>
            </section>

            <section className="card form">
              <label className="row">
                <input type="checkbox" checked={dropPage} onChange={(e) => setDropPage(e.target.checked)} />
                <span>四周的底色当作空格（不放豆子）</span>
              </label>
              <div className="segmented full" role="radiogroup" aria-label="色号范围">
                <button role="radio" aria-checked={!all} aria-selected={!all} onClick={() => setAll(false)}>
                  221 色 + L1
                </button>
                <button role="radio" aria-checked={all} aria-selected={all} onClick={() => setAll(true)}>
                  全部 MARD
                </button>
              </div>
              <div className="row">
                <span className="sub">最多用</span>
                <input className="countinput" inputMode="numeric" placeholder="不限" value={maxCodes} onChange={(e) => setMaxCodes(e.target.value.replace(/\D/g, ''))} aria-label="最多几种颜色" />
                <span className="sub">种颜色（少见的并进最接近的）</span>
              </div>
            </section>

            <section className="card compare">
              <figure>
                <canvas ref={result} />
                <figcaption>
                  {Object.keys(counts).length} 色 · {beads} 颗（颜色是最接近的 MARD 色号，以实物为准）
                </figcaption>
              </figure>
            </section>
            <div className="nextbar">
              <button className="primary" disabled={!cells || !beads || saving} onClick={() => setAsking(true)}>
                {saving ? '保存中…' : '保存到图纸库'}
              </button>
            </div>
          </>
        )}
      </div>
      {asking && (
        <SaveSheet
          initial={{ title: '像素画', status: 'todo', tags: [] }}
          existingTags={existingTags}
          onCancel={() => setAsking(false)}
          onSave={(meta) => {
            setAsking(false)
            void save(meta)
          }}
        />
      )}
    </div>
  )
}
