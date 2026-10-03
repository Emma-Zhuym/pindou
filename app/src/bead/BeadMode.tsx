import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, ICONS } from '../shared'
import type { Chart } from '../store'

/** The pegboards sold: square, this many pegs a side. */
const BOARDS = [52, 78, 104] as const
const MIN_CELL = 4
const MAX_SIDE = 4000 // canvas pixels a side, within what phones allow

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (s: number) => `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`

/** Text colour that reads on a bead colour. */
const inkOn = (code: string) => {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(codeColour(code))
  if (!m) return '#000'
  const [r, g, b] = m.slice(1).map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)'
}

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
  const latest = useRef({ chart, board, mirror, done, seconds })
  useLayoutEffect(() => {
    latest.current = { chart, board, mirror, done, seconds }
  })
  const save = (patch: Partial<Chart> = {}) => {
    const l = latest.current
    return onChange({ ...l.chart, ...patch, progress: { board: l.board ?? undefined, mirror: l.mirror, done: l.done, seconds: l.seconds }, updatedAt: Date.now() })
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
    const c = ref.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_SIDE / ((side + 2) * cell))
    const css = (side + 2) * cell
    c.width = Math.round(css * dpr)
    c.height = Math.round(css * dpr)
    c.style.width = `${css}px`
    c.style.height = `${css}px`
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, css, css)
    const m = 2 * cell // ruler margin
    // the pegboard, and the chart centred on it
    const ox = Math.floor((side - cols) / 2)
    const oy = Math.floor((side - rows) / 2)
    ctx.fillStyle = '#f2f2f4'
    ctx.fillRect(m, m, side * cell, side * cell)
    if (cell >= 8) {
      ctx.fillStyle = '#d8d8de'
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) ctx.fillRect(m + (x + 0.5) * cell - 1, m + (y + 0.5) * cell - 1, 2, 2)
    }
    const at = (c0: number) => (mirror ? cols - 1 - c0 : c0)
    const text = cell >= 18
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${Math.floor(cell * 0.36)}px -apple-system, sans-serif`
    for (let r = 0; r < rows; r++) {
      for (let c0 = 0; c0 < cols; c0++) {
        const code = cells[r * cols + c0]
        if (!code) continue
        const x = m + (ox + at(c0)) * cell
        const y = m + (oy + r) * cell
        const dim = focus ? code !== focus : done.includes(code)
        ctx.globalAlpha = dim ? (focus ? 0.12 : 0.3) : 1
        ctx.fillStyle = codeColour(code)
        ctx.fillRect(x, y, cell, cell)
        if (text && !dim) {
          ctx.fillStyle = inkOn(code)
          ctx.fillText(code, x + cell / 2, y + cell / 2)
        }
      }
    }
    ctx.globalAlpha = 1
    // guide lines over the chart, from its own first row and column: dashed every 5, solid every 10
    const x0 = m + ox * cell
    const y0 = m + oy * cell
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    for (let k = 0; k <= cols; k += 5) {
      const x = x0 + (mirror ? cols - k : k) * cell
      ctx.lineWidth = k % 10 === 0 ? 1.5 : 1
      ctx.setLineDash(k % 10 === 0 ? [] : [4, 3])
      ctx.beginPath()
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y0 + rows * cell)
      ctx.stroke()
    }
    for (let k = 0; k <= rows; k += 5) {
      const y = y0 + k * cell
      ctx.lineWidth = k % 10 === 0 ? 1.5 : 1
      ctx.setLineDash(k % 10 === 0 ? [] : [4, 3])
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x0 + cols * cell, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    // the chart's edge, and the pegboard's
    ctx.lineWidth = 2
    ctx.strokeStyle = '#000'
    ctx.strokeRect(x0, y0, cols * cell, rows * cell)
    if (board) {
      ctx.strokeStyle = '#8e8e93'
      ctx.strokeRect(m, m, side * cell, side * cell)
    }
    // rulers: the chart's column and row numbers every 5
    ctx.fillStyle = '#6e6e73'
    ctx.font = `${Math.max(9, Math.floor(cell * 0.7))}px -apple-system, sans-serif`
    for (let k = 5; k <= cols; k += 5) ctx.fillText(String(k), x0 + ((mirror ? cols - k : k - 1) + 0.5) * cell, m - cell * 0.8)
    for (let k = 5; k <= rows; k += 5) ctx.fillText(String(k), m - cell * 0.9, y0 + (k - 0.5) * cell)
  }, [cells, cols, rows, side, board, cell, mirror, focus, done])

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
