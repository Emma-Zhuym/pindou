import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, ICONS } from '../shared'
import { LABEL_CELL, MAX_SIDE, MIN_CELL, paintChart } from './paint'
import { statusPatch } from '../status'
import type { Chart } from '../store'

/** The pegboards sold: square, this many pegs a side. */
const BOARDS = [52, 78, 104] as const
const pad = (n: number) => String(n).padStart(2, '0')
const clock = (s: number) => `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`

/**
 * Beading a saved chart: the board in bead colours on its pegboard, guide lines every 5 (dashed)
 * and 10 (solid) cells, one code highlighted at a time, codes ticked off when done, mirrored for
 * ironing from the back, and a timer. Progress is kept with the chart.
 */
export function BeadMode({ chart, onClose, onChange }: { chart: Chart; onClose: () => void; onChange: (c: Chart) => Promise<void> }) {
  const { cols, rows, cells } = chart
  const fits = BOARDS.filter((n) => n >= Math.max(cols, rows))
  const [board, setBoard] = useState<number | null>(chart.progress?.board ?? fits[0] ?? null)
  const [mirror, setMirror] = useState(chart.progress?.mirror ?? false)
  const [labels, setLabels] = useState(chart.progress?.labels ?? true)
  // where the chart sits on the pegboard (pegs from its top left); null: centred
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(chart.progress?.offset ?? null)
  const [moving, setMoving] = useState(false)
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null)
  const [done, setDone] = useState<string[]>(chart.progress?.done ?? [])
  const [focus, setFocus] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(chart.progress?.seconds ?? 0)
  const [running, setRunning] = useState(false)
  const side = board ?? Math.max(cols, rows)
  // a ruler margin of two cells on the top and left
  // start with the whole pegboard on screen (page gutters and scrollbar left out)
  const fitCell = Math.floor(Math.min(document.documentElement.clientWidth - 40, 900) / (side + 2))
  const [cell, setCell] = useState(Math.max(MIN_CELL, fitCell))
  const maxCell = Math.max(MIN_CELL, Math.floor(MAX_SIDE / (side + 2)))
  const ref = useRef<HTMLCanvasElement>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) if (c) m.set(c, (m.get(c) ?? 0) + 1)
    return [...m].sort((a, b) => codeOrder(a[0], b[0]))
  }, [cells])
  const total = counts.reduce((a, [, n]) => a + n, 0)
  const placed = counts.reduce((a, [c, n]) => a + (done.includes(c) ? n : 0), 0)

  // keep progress with the chart; latest values through a ref so the timer can save too
  const latest = useRef({ chart, board, mirror, labels, offset, done, seconds })
  useLayoutEffect(() => {
    latest.current = { chart, board, mirror, labels, offset, done, seconds }
  })
  const save = (patch: Partial<Chart> = {}) => {
    const l = latest.current
    return onChange({ ...l.chart, ...patch, progress: { board: l.board ?? undefined, mirror: l.mirror, labels: l.labels, offset: l.offset ?? undefined, done: l.done, seconds: l.seconds }, updatedAt: Date.now() })
  }
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    const keep = setInterval(() => save(), 30000)
    return () => {
      clearInterval(t)
      clearInterval(keep)
    }
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ref.current) paintChart(ref.current, { cells, cols, rows, cell, board, mirror, labels, focus, done, offset: offset ?? undefined })
  }, [cells, cols, rows, board, cell, mirror, labels, focus, done, offset])

  // dragging the chart across the pegboard, a whole peg at a time, never off it
  const centred = (n: number) => ({ x: Math.floor((n - cols) / 2), y: Math.floor((n - rows) / 2) })
  const place = (p: { x: number; y: number }) => board && setOffset({ x: Math.min(board - cols, Math.max(0, p.x)), y: Math.min(board - rows, Math.max(0, p.y)) })
  const grab = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!moving || !board) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: offset ?? centred(board) }
  }
  const slide = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    place({ x: d.from.x + Math.round((e.clientX - d.x) / cell), y: d.from.y + Math.round((e.clientY - d.y) / cell) })
  }

  const toggleDone = (code: string) => {
    const next = done.includes(code) ? done.filter((c) => c !== code) : [...done, code]
    setDone(next)
    latest.current.done = next
    save()
  }
  const startStop = () => {
    if (running) {
      setRunning(false)
      save()
    } else {
      setRunning(true)
      // starting to bead: the chart is now in progress
      if (chart.status === 'todo') save({ status: 'doing' })
    }
  }
  // the whole chart done at once: every code ticked, the timer stopped, the chart marked 已拼
  const finish = async () => {
    if (!window.confirm('整张图都拼完了？会勾上所有色号、停止计时，并把图纸标成"已拼"。')) return
    setRunning(false)
    const all = counts.map(([c]) => c)
    setDone(all)
    latest.current.done = all
    const patch = await statusPatch(chart, 'done')
    delete patch.progress // save() writes the progress, every code ticked
    await save(patch)
    onClose()
  }
  const close = async () => {
    setRunning(false)
    await save()
    onClose()
  }

  return (
    <div className="bead">
      <div className="beadtop">
      <header className="flowbar">
        <button className="circle glass" aria-label="退出拼豆模式" onClick={close}>
          <Icon d={ICONS.close} size={20} />
        </button>
        <div className="beadtitle">
          <b>{chart.title}</b>
          <span className="sub">
            {cols}×{rows}
            {board ? ` · ${board} 板` : ''} · 已完成 {done.length}/{counts.length} 色，{placed}/{total} 颗
          </span>
        </div>
        <button className={running ? 'primary small' : 'small glass'} onClick={startStop}>
          {running ? '暂停' : '计时'} {clock(seconds)}
        </button>
      </header>

      <div className="beadtools">
        <div className="segmented small" role="radiogroup" aria-label="豆板">
          {BOARDS.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={board === n}
              aria-selected={board === n}
              disabled={n < Math.max(cols, rows)}
              onClick={() => {
                setBoard(n)
                setOffset(null)
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <button className={mirror ? 'chip on' : 'chip'} onClick={() => setMirror(!mirror)}>
          镜像
        </button>
        {board && (
          <>
            <button className={moving ? 'chip on' : 'chip'} onClick={() => setMoving(!moving)}>
              {moving ? '挪好了' : '挪位置'}
            </button>
            {offset && (
              <button className="chip" onClick={() => setOffset(null)}>
                居中
              </button>
            )}
          </>
        )}
        <button
          className={labels ? 'chip on' : 'chip'}
          onClick={() => {
            // codes need room: zoom in far enough to read them
            if (!labels && cell < LABEL_CELL) setCell(Math.min(maxCell, LABEL_CELL))
            setLabels(!labels)
          }}
        >
          色号
        </button>
        {chart.status !== 'done' && (
          <button className="primary small" onClick={finish}>
            整张拼完
          </button>
        )}
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

      <div className="beadstage">
        {moving && <p className="hint">在图上拖动，把图案挪到豆板上想放的位置；红线是豆板上印的线，不会跟着动。</p>}
        <canvas ref={ref} style={{ touchAction: moving ? 'none' : 'auto' }} onPointerDown={grab} onPointerMove={slide} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} />
      </div>

      <nav className="beadpalette" aria-label="色号">
        {focus && (
          <div className="focusbar">
            <span className="swatch" style={{ background: codeColour(focus) }} />
            <b>{focus}</b>
            <span className="sub">{counts.find(([c]) => c === focus)?.[1]} 颗</span>
            <button className={done.includes(focus) ? 'small glass' : 'primary small'} onClick={() => toggleDone(focus)}>
              {done.includes(focus) ? '取消完成' : '这个颜色拼完了'}
            </button>
            <button className="link" onClick={() => setFocus(null)}>
              看全部
            </button>
          </div>
        )}
        <div className="beadchips">
          {counts.map(([code, n]) => (
            <button key={code} className={`chip${focus === code ? ' on' : ''}${done.includes(code) ? ' done' : ''}`} onClick={() => setFocus(focus === code ? null : code)}>
              <span className="swatch" style={{ background: codeColour(code) }} />
              {code}
              <span className="sub">{done.includes(code) ? '✓' : n}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
