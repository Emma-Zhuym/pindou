import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cellAt, LABEL_CELL, layout, MAX_SIDE, MIN_CELL, paintChart } from '../bead/paint'
import { usePinchZoom } from '../bead/pinch'
import { CATALOGUE } from '../engine/glyphs'
import { Icon } from '../Icon'
import { boardThumb, codeColour, codeOrder, ICONS } from '../shared'
import { type Chart, countCells } from '../store'
import { ColourCard } from './ColourCard'

type Tool = 'move' | 'brush' | 'eraser' | 'picker'
const TOOLS: [Tool, string][] = [
  ['move', '移动'],
  ['brush', '画笔'],
  ['eraser', '橡皮'],
  ['picker', '吸管'],
]
const UNDO_DEPTH = 50
/** brush sizes, in cells a side */
const BRUSHES = [1, 2, 3, 5]
/** an edge of the crop box can be picked up this far from the finger (CSS pixels) */
const EDGE_REACH = 28

/** what one undo step puts back: a crop changes the size, and the recognised version with it */
interface Snap {
  cells: string[]
  cols: number
  rows: number
  original: string[]
  /** every crop so far, as the offset of these cells from the chart as saved */
  shift: { x: number; y: number }
}
/** the box kept by a crop, in cells */
interface Box {
  t: number
  b: number
  l: number
  r: number
}
type Side = 't' | 'b' | 'l' | 'r'
/** rows t..b-1 and columns l..r-1 */
const cut = (cells: string[], cols: number, { t, b, l, r }: Box) => {
  const out: string[] = []
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) out.push(cells[y * cols + x])
  return out
}
/** the box round every bead (all of it when there are none) */
const beadsBox = (cells: string[], cols: number, rows: number): Box => {
  let box: Box | null = null
  cells.forEach((c, i) => {
    if (!c) return
    const x = i % cols
    const y = (i - x) / cols
    box = box ? { t: Math.min(box.t, y), b: Math.max(box.b, y + 1), l: Math.min(box.l, x), r: Math.max(box.r, x + 1) } : { t: y, b: y + 1, l: x, r: x + 1 }
  })
  return box ?? { t: 0, b: rows, l: 0, r: cols }
}

/**
 * Editing a saved chart by hand: paint cells with a code (a square brush of one or more cells),
 * erase them, pick a code off the board, swap one code for another everywhere, crop, undo. Saving rewrites the chart's cells, counts and
 * thumbnail; the recogniser's editing state is dropped so a later "修改识别结果" starts from these
 * cells rather than from the older recognition. The recognised version is kept beside them: it can
 * be shown in place of the edits for a moment, or put back (an undo step like any other).
 */
export function Editor({ chart, onClose, onSave }: { chart: Chart; onClose: () => void; onSave: (c: Chart) => Promise<void> }) {
  const [cells, setCells] = useState<string[]>(chart.cells)
  const [{ cols, rows }, setSize] = useState({ cols: chart.cols, rows: chart.rows })
  // the recognised version (or, on older charts, the cells as first opened), cropped with the cells
  const [original, setOriginal] = useState(() => (chart.original?.length === chart.cells.length ? chart.original : chart.cells))
  const [history, setHistory] = useState<Snap[]>([])
  // what undo took back, for redo; any new change clears it
  const [future, setFuture] = useState<Snap[]>([])
  const [brush, setBrush] = useState(1)
  // the box a crop keeps, while cropping
  const [crop, setCrop] = useState<Box | null>(null)
  // every crop made, as offsets from the chart as saved: the board and pegboard place follow it
  const [shift, setShift] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState<Tool>('move')
  const [code, setCode] = useState<string>(() => Object.keys(chart.counts).sort(codeOrder)[0] ?? 'H2')
  const [labels, setLabels] = useState(chart.progress?.labels ?? true)
  // the colour card, open for the brush or for the swap's target
  const [card, setCard] = useState<'brush' | 'swap' | null>(null)
  // every cell of one code changed to another (replace), or two codes trading places (exchange)
  const [swap, setSwap] = useState<{ from: string; to: string; exchange?: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [comparing, setComparing] = useState(false)
  const changed = useMemo(() => cells.reduce((n, c, i) => n + (c !== original[i] ? 1 : 0), 0), [cells, original])
  const fitCell = Math.floor(Math.min(document.documentElement.clientWidth - 40, 900) / (Math.max(cols, rows) + 2))
  const [cell, setCell] = useState(Math.max(MIN_CELL, fitCell))
  const maxCell = Math.max(MIN_CELL, Math.floor(MAX_SIDE / (Math.max(cols, rows) + 2)))
  const ref = useRef<HTMLCanvasElement>(null)
  // one stroke (pointer down to up) is one undo step
  const stroke = useRef<{ before: string[]; last: number; changed: boolean } | null>(null)
  const current = useRef(cells)
  useLayoutEffect(() => {
    current.current = cells
  })

  const shown = comparing ? original : cells
  const opts = { cells: shown, cols, rows, cell, board: null, labels }
  useEffect(() => {
    const c = ref.current
    if (!c) return
    paintChart(c, { cells: shown, cols, rows, cell, board: null, labels })
    if (!crop) return
    // the part cropped away greyed out, the box kept in blue with a handle on each edge
    const { x0, y0 } = layout(opts)
    const ctx = c.getContext('2d')!
    const x = x0 + crop.l * cell
    const y = y0 + crop.t * cell
    const w = (crop.r - crop.l) * cell
    const h = (crop.b - crop.t) * cell
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.fillRect(x0, y0, cols * cell, y - y0)
    ctx.fillRect(x0, y + h, cols * cell, y0 + rows * cell - y - h)
    ctx.fillRect(x0, y, x - x0, h)
    ctx.fillRect(x + w, y, x0 + cols * cell - x - w, h)
    ctx.strokeStyle = '#007aff'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = '#007aff'
    for (const [hx, hy] of [[x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) {
      ctx.beginPath()
      ctx.arc(hx, hy, 7, 0, Math.PI * 2)
      ctx.fill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, cols, rows, cell, labels, crop])
  const stageRef = useRef<HTMLDivElement>(null)
  const pinching = usePinchZoom(stageRef, ref, cell, setCell, MIN_CELL, maxCell)

  const counts = useMemo(() => Object.entries(countCells(cells)).sort((a, b) => codeOrder(a[0], b[0])), [cells])
  const dirty = cells !== chart.cells || cols !== chart.cols || rows !== chart.rows

  const snap = (c = cells): Snap => ({ cells: c, cols, rows, original, shift })
  const put = (s: Snap) => {
    current.current = s.cells
    setCells(s.cells)
    setSize({ cols: s.cols, rows: s.rows })
    setOriginal(s.original)
    setShift(s.shift)
  }
  const commit = (next: string[], before: string[]) => {
    setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), snap(before)])
    setFuture([])
    setCells(next)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(history.slice(0, -1))
    setFuture((f) => [...f, snap()])
    put(prev)
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    setFuture(future.slice(0, -1))
    setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), snap()])
    put(next)
  }

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return cellAt(opts, e.clientX - r.left, e.clientY - r.top)
  }
  // the stroke works on `current` directly, so it knows at once what it has changed; a brush of
  // n cells paints the n x n square with the cell under the finger at its centre (top left of
  // centre for an even n)
  const apply = (i: number) => {
    const s = stroke.current
    if (i < 0 || !s || i === s.last) return
    s.last = i
    const value = tool === 'eraser' ? '' : code
    const x = i % cols
    const y = (i - x) / cols
    const from = Math.floor((brush - 1) / 2)
    let next: string[] | null = null
    for (let dy = -from; dy < brush - from; dy++)
      for (let dx = -from; dx < brush - from; dx++) {
        const cx = x + dx
        const cy = y + dy
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue
        const j = cy * cols + cx
        if (current.current[j] === value) continue
        next ??= [...current.current]
        next[j] = value
      }
    if (!next) return
    current.current = next
    s.changed = true
    setCells(next)
  }

  // cropping: the edge nearest the finger follows it, a whole cell at a time
  const held = useRef<Side | null>(null)
  const cropAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const { x0, y0 } = layout(opts)
    return { x: (e.clientX - r.left - x0) / cell, y: (e.clientY - r.top - y0) / cell }
  }
  const cropDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!crop) return
    const { x, y } = cropAt(e)
    const reach = EDGE_REACH / cell
    const within = (v: number, a: number, b: number) => v > a - reach && v < b + reach
    const near: [Side, number][] = [
      ['t', within(x, crop.l, crop.r) ? Math.abs(y - crop.t) : Infinity],
      ['b', within(x, crop.l, crop.r) ? Math.abs(y - crop.b) : Infinity],
      ['l', within(y, crop.t, crop.b) ? Math.abs(x - crop.l) : Infinity],
      ['r', within(y, crop.t, crop.b) ? Math.abs(x - crop.r) : Infinity],
    ]
    const [side, d] = near.sort((a, b) => a[1] - b[1])[0]
    if (d > reach) return
    held.current = side
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const cropMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const side = held.current
    if (!side || !crop) return
    const { x, y } = cropAt(e)
    const X = Math.max(0, Math.min(cols, Math.round(x)))
    const Y = Math.max(0, Math.min(rows, Math.round(y)))
    setCrop((b) => {
      if (!b) return b
      if (side === 't') return { ...b, t: Math.min(Y, b.b - 1) }
      if (side === 'b') return { ...b, b: Math.max(Y, b.t + 1) }
      if (side === 'l') return { ...b, l: Math.min(X, b.r - 1) }
      return { ...b, r: Math.max(X, b.l + 1) }
    })
  }
  const doCrop = () => {
    if (!crop) return
    const { t, b, l, r } = crop
    if (t === 0 && l === 0 && b === rows && r === cols) {
      setCrop(null)
      return
    }
    setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), snap()])
    setFuture([])
    put({ cells: cut(cells, cols, crop), cols: r - l, rows: b - t, original: cut(original, cols, crop), shift: { x: shift.x + l, y: shift.y + t } })
    setCrop(null)
    // what is left, filling the width again
    const side = Math.max(r - l, b - t) + 2
    setCell(Math.max(MIN_CELL, Math.min(Math.floor(MAX_SIDE / side), Math.floor(Math.min(document.documentElement.clientWidth - 40, 900) / side))))
  }

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (crop) {
      cropDown(e)
      return
    }
    if (comparing || tool === 'move' || pinching()) return
    const i = at(e)
    if (i < 0) return
    if (tool === 'picker') {
      if (cells[i]) {
        setCode(cells[i])
        setTool('brush')
      }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    stroke.current = { before: cells, last: -1, changed: false }
    apply(i)
  }
  // a second finger came down mid-stroke: it was a pinch, so the stroke's marks are taken back
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (crop) {
      cropMove(e)
      return
    }
    const s = stroke.current
    if (!s) return
    if (pinching()) {
      stroke.current = null
      current.current = s.before
      setCells(s.before)
      return
    }
    apply(at(e))
  }
  const up = () => {
    held.current = null
    const s = stroke.current
    stroke.current = null
    if (s?.changed) {
      setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), snap(s.before)])
      setFuture([])
    }
  }

  const swapCount = swap ? cells.filter((c) => c === swap.from).length : 0
  const toCount = swap ? cells.filter((c) => c === swap.to).length : 0
  const doSwap = () => {
    if (!swap || swap.from === swap.to || !(swap.to in CATALOGUE)) return
    const { from, to, exchange } = swap
    commit(
      cells.map((c) => (c === from ? to : exchange && c === to ? from : c)),
      cells,
    )
    setSwap(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const counted = countCells(cells)
      const cropped = cols !== chart.cols || rows !== chart.rows || shift.x || shift.y
      await onSave({
        ...chart,
        cols,
        rows,
        cells,
        counts: counted,
        thumb: await boardThumb(cols, rows, cells),
        // the recognition's groups no longer describe these cells
        edit: { ...chart.edit, engine: 0 },
        original,
        // a crop keeps the board in the image on the cells that are left
        board: chart.board && cropped ? { ...chart.board, extent: { r0: chart.board.extent.r0 + shift.y, c0: chart.board.extent.c0 + shift.x, rows, cols } } : chart.board,
        progress: chart.progress
          ? {
              ...chart.progress,
              done: chart.progress.done.filter((c) => c in counted),
              // the beads stay on the same pegs
              offset: chart.progress.offset && cropped ? { x: chart.progress.offset.x + shift.x, y: chart.progress.offset.y + shift.y } : chart.progress.offset,
            }
          : undefined,
        updatedAt: Date.now(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }
  const close = () => {
    if (!dirty || window.confirm('改动还没保存，确定离开吗？')) onClose()
  }

  return (
    <div className="bead editor">
      <div className="beadtop">
      <header className="flowbar">
        <button className="circle glass" aria-label="退出编辑" onClick={close}>
          <Icon d={ICONS.close} size={20} />
        </button>
        <div className="beadtitle">
          <b>编辑 · {chart.title}</b>
          <span className="sub">
            {comparing ? `识别时的原版 · 之后改了 ${changed} 格` : `${cols}×${rows} · ${counts.length} 色 · ${counts.reduce((a, [, n]) => a + n, 0)} 颗`}
          </span>
        </div>
        <button className="primary small" disabled={!dirty || saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </header>

      <div className="beadtools">
        <div className="segmented small" role="radiogroup" aria-label="工具">
          {TOOLS.map(([t, label]) => (
            <button key={t} role="radio" aria-checked={tool === t} aria-selected={tool === t} onClick={() => setTool(t)}>
              {label}
            </button>
          ))}
        </div>
        {(tool === 'brush' || tool === 'eraser') && (
          <div className="segmented small" role="radiogroup" aria-label="笔刷大小">
            {BRUSHES.map((n) => (
              <button key={n} role="radio" aria-checked={brush === n} aria-selected={brush === n} aria-label={`笔刷 ${n}×${n} 格`} onClick={() => setBrush(n)}>
                {n === 1 ? '1格' : `${n}×${n}`}
              </button>
            ))}
          </div>
        )}
        <button className="chip" disabled={comparing || !!crop} onClick={() => setSwap({ from: code, to: code })}>
          批量换色
        </button>
        <button
          className={crop ? 'chip on' : 'chip'}
          disabled={comparing}
          onClick={() => {
            if (crop) {
              setCrop(null)
              return
            }
            // the whole chart in view, so every edge can be reached
            setCell(Math.max(MIN_CELL, Math.min(cell, fitCell)))
            setCrop({ t: 0, b: rows, l: 0, r: cols })
          }}
        >
          裁剪
        </button>
        {changed > 0 && (
          <>
            <button className={comparing ? 'chip on' : 'chip'} aria-pressed={comparing} onClick={() => setComparing(!comparing)}>
              {comparing ? '看修改后' : '对比原版'}
            </button>
            <button
              className="chip"
              onClick={() => {
                if (!window.confirm(`把改过的 ${changed} 格还原成识别时的样子？还原后可以点右下角的撤销拿回来。`)) return
                commit(original, cells)
                setComparing(false)
              }}
            >
              还原
            </button>
          </>
        )}
        <button
          className={labels ? 'chip on' : 'chip'}
          onClick={() => {
            if (!labels && cell < LABEL_CELL) setCell(Math.min(maxCell, LABEL_CELL))
            setLabels(!labels)
          }}
        >
          色号
        </button>
        <div className="zoombar">
          <button className="link" aria-label="缩小" onClick={() => setCell(Math.max(MIN_CELL, cell - 2))}>
            −
          </button>
          <input type="range" min={MIN_CELL} max={maxCell} value={cell} onChange={(e) => setCell(Number(e.target.value))} aria-label="缩放" />
          <button className="link" aria-label="放大" onClick={() => setCell(Math.min(maxCell, cell + 2))}>
            +
          </button>
        </div>
      </div>

      </div>

      <div className="beadstage" ref={stageRef}>
        {/* painting takes the touch; moving leaves it to scrolling */}
        <canvas ref={ref} style={{ touchAction: tool === 'move' && !crop ? 'auto' : 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>

      <nav className="beadpalette" aria-label="色号">
        {/* undo and redo on the palette's shoulder, near the thumb */}
        <div className="undodock">
          <button className="roundbtn" aria-label="撤销" disabled={comparing || !history.length} onClick={undo}>
            <Icon d={ICONS.undo} size={22} />
          </button>
          <button className="roundbtn" aria-label="重做" disabled={comparing || !future.length} onClick={redo}>
            <Icon d={ICONS.redo} size={22} />
          </button>
        </div>
        {crop ? (
          <div className="focusbar cropbar">
            <b>
              {crop.r - crop.l}×{crop.b - crop.t}
            </b>
            <span className="sub">拖蓝框的边，一次一格</span>
            <button className="chip" onClick={() => setCrop(beadsBox(cells, cols, rows))}>
              去掉空白
            </button>
            <button className="link" onClick={() => setCrop(null)}>
              取消
            </button>
            <button className="primary small" onClick={doCrop}>
              裁剪
            </button>
          </div>
        ) : (
        <>
        <div className="focusbar">
          <span className="swatch" style={{ background: codeColour(code) }} />
          <b>{code}</b>
          <span className="sub">{tool === 'move' ? '选"画笔"后在图上点或拖' : tool === 'eraser' ? (brush > 1 ? `点或拖动，一次擦 ${brush}×${brush} 格` : '点格子变成空格') : tool === 'picker' ? '点一格取它的色号' : brush > 1 ? `点或拖动，一次涂 ${brush}×${brush} 格` : '点或拖动涂色'}</span>
          <button className="chip" onClick={() => setCard('brush')}>
            色卡
          </button>
        </div>
        <div className="beadchips">
          {counts.map(([c, n]) => (
            <button
              key={c}
              className={`chip${code === c ? ' on' : ''}`}
              onClick={() => {
                setCode(c)
                if (tool === 'move' || tool === 'picker') setTool('brush')
              }}
            >
              <span className="swatch" style={{ background: codeColour(c) }} />
              {c}
              <span className="sub">{n}</span>
            </button>
          ))}
        </div>
        </>
        )}
      </nav>

      {swap && (
        <div className="sheet" onClick={() => setSwap(null)}>
          <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
            <h2>批量换色</h2>
            <div className="segmented full" role="radiogroup" aria-label="换法">
              <button role="radio" aria-checked={!swap.exchange} aria-selected={!swap.exchange} onClick={() => setSwap({ ...swap, exchange: false })}>
                全部换成
              </button>
              <button role="radio" aria-checked={!!swap.exchange} aria-selected={!!swap.exchange} onClick={() => setSwap({ ...swap, exchange: true })}>
                两色互换
              </button>
            </div>
            <label className="field">
              <span>把这个色号</span>
              <select value={swap.from} onChange={(e) => setSwap({ ...swap, from: e.target.value })}>
                {counts.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c}（{n} 颗）
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>{swap.exchange ? '和这个色号互换' : '全部换成（任意 MARD 色号）'}</span>
              <div className="row">
                <input value={swap.to} onChange={(e) => setSwap({ ...swap, to: e.target.value.toUpperCase().trim().replace(/^([A-Z]+)0+(\d)/, '$1$2') })} aria-label="换成的色号" />
                <button className="chip" onClick={() => setCard('swap')}>
                  从色卡选
                </button>
              </div>
            </div>
            {swap.to && !(swap.to in CATALOGUE) && <p className="sub bad">「{swap.to}」不是 MARD 色号</p>}
            {swap.to in CATALOGUE && swap.from !== swap.to && (
              <p className="hint">
                {swap.exchange ? `${swapCount} 颗 ${swap.from} 和 ${toCount} 颗 ${swap.to} 互换` : `会把 ${swapCount} 颗 ${swap.from} 换成 ${swap.to}`}
                <span className="swatch" style={{ background: codeColour(swap.from), marginLeft: 8 }} /> →
                <span className="swatch" style={{ background: codeColour(swap.to), marginLeft: 4 }} />
              </p>
            )}
            <div className="row end">
              <button className="link" onClick={() => setSwap(null)}>
                取消
              </button>
              <button className="primary small" disabled={!(swap.to in CATALOGUE) || swap.from === swap.to} onClick={doSwap}>
                换
              </button>
            </div>
          </div>
        </div>
      )}
      {/* above the swap sheet when opened from it */}
      {card && (
        <ColourCard
          title={card === 'brush' ? '选画笔颜色' : `把 ${swap?.from} 换成…`}
          near={card === 'brush' ? code : swap?.from}
          value={card === 'brush' ? code : swap?.to}
          onPick={(c) => {
            if (card === 'brush') {
              setCode(c)
              setTool('brush')
            } else if (swap) setSwap({ ...swap, to: c })
            setCard(null)
          }}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  )
}
