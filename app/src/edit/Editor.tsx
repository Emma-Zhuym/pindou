import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cellAt, LABEL_CELL, MAX_SIDE, MIN_CELL, paintChart } from '../bead/paint'
import { CATALOGUE } from '../engine/glyphs'
import { Icon } from '../Icon'
import { boardThumb, codeColour, codeOrder, ICONS } from '../shared'
import { type Chart, countCells } from '../store'

type Tool = 'move' | 'brush' | 'eraser' | 'picker'
const TOOLS: [Tool, string][] = [
  ['move', '移动'],
  ['brush', '画笔'],
  ['eraser', '橡皮'],
  ['picker', '吸管'],
]
const UNDO_DEPTH = 50

/**
 * Editing a saved chart by hand: paint cells with a code, erase them, pick a code off the board,
 * swap one code for another everywhere, undo. Saving rewrites the chart's cells, counts and
 * thumbnail; the recogniser's editing state is dropped so a later "修改识别结果" starts from these
 * cells rather than from the older recognition.
 */
export function Editor({ chart, onClose, onSave }: { chart: Chart; onClose: () => void; onSave: (c: Chart) => Promise<void> }) {
  const { cols, rows } = chart
  const [cells, setCells] = useState<string[]>(chart.cells)
  const [history, setHistory] = useState<string[][]>([])
  const [tool, setTool] = useState<Tool>('move')
  const [code, setCode] = useState<string>(() => Object.keys(chart.counts).sort(codeOrder)[0] ?? 'H2')
  const [labels, setLabels] = useState(chart.progress?.labels ?? false)
  const [other, setOther] = useState('')
  const [swap, setSwap] = useState<{ from: string; to: string } | null>(null)
  const [saving, setSaving] = useState(false)
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

  const opts = { cells, cols, rows, cell, board: null, labels }
  useEffect(() => {
    if (ref.current) paintChart(ref.current, { cells, cols, rows, cell, board: null, labels })
  }, [cells, cols, rows, cell, labels])

  const counts = useMemo(() => Object.entries(countCells(cells)).sort((a, b) => codeOrder(a[0], b[0])), [cells])
  const dirty = cells !== chart.cells

  const commit = (next: string[], before: string[]) => {
    setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), before])
    setCells(next)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(history.slice(0, -1))
    setCells(prev)
  }

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return cellAt(opts, e.clientX - r.left, e.clientY - r.top)
  }
  // the stroke works on `current` directly, so it knows at once what it has changed
  const apply = (i: number) => {
    const s = stroke.current
    if (i < 0 || !s || i === s.last) return
    s.last = i
    const value = tool === 'eraser' ? '' : code
    if (current.current[i] === value) return
    const next = [...current.current]
    next[i] = value
    current.current = next
    s.changed = true
    setCells(next)
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'move') return
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
  const up = () => {
    const s = stroke.current
    stroke.current = null
    if (s?.changed) setHistory((h) => [...h.slice(-UNDO_DEPTH + 1), s.before])
  }

  const otherCode = other.toUpperCase().trim().replace(/^([A-Z]+)0+(\d)/, '$1$2')
  const swapCount = swap ? cells.filter((c) => c === swap.from).length : 0
  const doSwap = () => {
    if (!swap || swap.from === swap.to || !(swap.to in CATALOGUE)) return
    commit(
      cells.map((c) => (c === swap.from ? swap.to : c)),
      cells,
    )
    setSwap(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const counted = countCells(cells)
      await onSave({
        ...chart,
        cells,
        counts: counted,
        thumb: await boardThumb(cols, rows, cells),
        // the recognition's groups no longer describe these cells
        edit: { ...chart.edit, engine: 0 },
        progress: chart.progress ? { ...chart.progress, done: chart.progress.done.filter((c) => c in counted) } : undefined,
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
      <header className="flowbar">
        <button className="circle glass" aria-label="退出编辑" onClick={close}>
          <Icon d={ICONS.close} size={20} />
        </button>
        <div className="beadtitle">
          <b>编辑 · {chart.title}</b>
          <span className="sub">
            {cols}×{rows} · {counts.length} 色 · {counts.reduce((a, [, n]) => a + n, 0)} 颗
          </span>
        </div>
        <button className="small glass" disabled={!history.length} onClick={undo}>
          撤销
        </button>
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
        <button className="chip" onClick={() => setSwap({ from: code, to: code })}>
          批量换色
        </button>
        <button
          className={labels ? 'chip on' : 'chip'}
          onClick={() => {
            if (!labels && cell < LABEL_CELL) setCell(Math.min(maxCell, LABEL_CELL))
            setLabels(!labels)
          }}
        >
          色号
        </button>
        <div className="zoom">
          <button className="link" aria-label="缩小" onClick={() => setCell(Math.max(MIN_CELL, cell - 2))}>
            −
          </button>
          <input type="range" min={MIN_CELL} max={maxCell} value={cell} onChange={(e) => setCell(Number(e.target.value))} aria-label="缩放" />
          <button className="link" aria-label="放大" onClick={() => setCell(Math.min(maxCell, cell + 2))}>
            +
          </button>
        </div>
      </div>

      <div className="beadstage">
        {/* painting takes the touch; moving leaves it to scrolling */}
        <canvas ref={ref} style={{ touchAction: tool === 'move' ? 'auto' : 'none' }} onPointerDown={down} onPointerMove={(e) => stroke.current && apply(at(e))} onPointerUp={up} onPointerCancel={up} />
      </div>

      <nav className="beadpalette" aria-label="色号">
        <div className="focusbar">
          <span className="swatch" style={{ background: codeColour(code) }} />
          <b>{code}</b>
          <span className="sub">{tool === 'move' ? '选"画笔"后在图上点或拖' : tool === 'eraser' ? '点格子变成空格' : tool === 'picker' ? '点一格取它的色号' : '点或拖动涂色'}</span>
          <input className="codeinput" placeholder="其他色号" value={other} onChange={(e) => setOther(e.target.value)} aria-label="其他色号" />
          <button
            className="link"
            disabled={!(otherCode in CATALOGUE)}
            onClick={() => {
              setCode(otherCode)
              setOther('')
              setTool('brush')
            }}
          >
            用这个
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
      </nav>

      {swap && (
        <div className="sheet" onClick={() => setSwap(null)}>
          <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
            <h2>批量换色</h2>
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
            <label className="field">
              <span>全部换成（任意 MARD 色号）</span>
              <input value={swap.to} onChange={(e) => setSwap({ ...swap, to: e.target.value.toUpperCase().trim().replace(/^([A-Z]+)0+(\d)/, '$1$2') })} />
            </label>
            {swap.to && !(swap.to in CATALOGUE) && <p className="sub bad">「{swap.to}」不是 MARD 色号</p>}
            {swap.to in CATALOGUE && swap.from !== swap.to && (
              <p className="hint">
                会把 {swapCount} 颗 {swap.from} 换成 {swap.to}
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
    </div>
  )
}
