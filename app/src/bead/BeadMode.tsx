import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, ICONS } from '../shared'
import { LABEL_CELL, MAX_SIDE, MIN_CELL, paintChart } from './paint'
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
  const [labels, setLabels] = useState(chart.progress?.labels ?? false)
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
  const latest = useRef({ chart, board, mirror, labels, done, seconds })
  useLayoutEffect(() => {
    latest.current = { chart, board, mirror, labels, done, seconds }
  })
  const save = (patch: Partial<Chart> = {}) => {
    const l = latest.current
    return onChange({ ...l.chart, ...patch, progress: { board: l.board ?? undefined, mirror: l.mirror, labels: l.labels, done: l.done, seconds: l.seconds }, updatedAt: Date.now() })
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
    if (ref.current) paintChart(ref.current, { cells, cols, rows, cell, board, mirror, labels, focus, done })
  }, [cells, cols, rows, board, cell, mirror, labels, focus, done])

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
  const close = async () => {
    setRunning(false)
    await save()
    onClose()
  }

  return (
    <div className="bead">
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
            <button key={n} role="radio" aria-checked={board === n} aria-selected={board === n} disabled={n < Math.max(cols, rows)} onClick={() => setBoard(n)}>
              {n}
            </button>
          ))}
        </div>
        <button className={mirror ? 'chip on' : 'chip'} onClick={() => setMirror(!mirror)}>
          镜像
        </button>
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

      <div className="beadstage">
        <canvas ref={ref} />
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
