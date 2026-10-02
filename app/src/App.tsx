import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { type AiSettings, loadAiSettings, readCodesWithAi, saveAiSettings } from './ai'
import { loadImage, paintLabel, renderText, toRaster } from './browser'
import { CATALOGUE, type Rgb } from './engine/glyphs'
import { findLegend, type Rect } from './engine/legendArea'
import { recognise, type Recognition } from './engine/recognize'

type Tab = 'import' | 'codes' | 'wall' | 'list'
const TABS: [Tab, string][] = [
  ['import', '导入'],
  ['codes', '色号'],
  ['wall', '核对'],
  ['list', '清单'],
]
const SAMPLES = ['tree-52x64', 'landscape-84x84', 'portrait-50x70', 'dog-104x104']
const GREY: Rgb = { r: 200, g: 200, b: 200 }

const css = (c: Rgb) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
const codeOrder = (a: string, b: string) => {
  const pa = /^([A-Z]+)(\d+)$/.exec(a)
  const pb = /^([A-Z]+)(\d+)$/.exec(b)
  if (!pa || !pb) return a.localeCompare(b)
  return pa[1] === pb[1] ? Number(pa[2]) - Number(pb[2]) : pa[1].localeCompare(pb[1])
}

export default function App() {
  const [tab, setTab] = useState<Tab>('import')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [rec, setRec] = useState<Recognition | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [assign, setAssign] = useState<Int16Array>(new Int16Array(0))
  const [legend, setLegend] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [legendRect, setLegendRect] = useState<Rect | null>(null)
  const bar = useRef<HTMLElement>(null)

  // the legend panel sticks just under the top bar, whose height depends on the layout
  useLayoutEffect(() => {
    const set = () => bar.current && document.documentElement.style.setProperty('--bar-h', `${bar.current.offsetHeight}px`)
    set()
    window.addEventListener('resize', set)
    return () => window.removeEventListener('resize', set)
  }, [])

  async function open(src: Blob | string) {
    setError('')
    setBusy('正在识别…')
    try {
      const image = await loadImage(src)
      // let the "working" state paint before the main thread is busy
      await new Promise((r) => setTimeout(r, 30))
      const raster = toRaster(image)
      const result = recognise(raster, renderText)
      if (!result.groups.length) throw new Error('没有识别出带色号的格子，这张图可能不是带色号的图纸')
      setImg(image)
      setRec(result)
      setNames(result.groups.map((g) => g.code))
      setAssign(Int16Array.from(result.assign))
      setLegend({})
      setLegendRect(findLegend(raster, result))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of assign) if (g >= 0) m.set(names[g], (m.get(names[g]) ?? 0) + 1)
    return m
  }, [assign, names])

  return (
    <div className="app">
      <header className="bar" ref={bar}>
        <h1>拼豆图纸</h1>
        <nav className="segmented" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} disabled={t !== 'import' && !(img && rec)} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'import' && <ImportPage img={img} rec={rec} names={names} assign={assign} busy={busy} error={error} onOpen={open} onNext={() => setTab('codes')} />}
        {tab === 'codes' && img && rec && (
          <CodesPage img={img} rec={rec} names={names} counts={counts} legend={legend} legendRect={legendRect} onNames={setNames} onLegend={setLegend} onLegendRect={setLegendRect} onNext={() => setTab('wall')} />
        )}
        {tab === 'wall' && img && rec && <WallPage img={img} rec={rec} names={names} assign={assign} counts={counts} legend={legend} onAssign={setAssign} onNames={setNames} />}
        {tab === 'list' && img && rec && <ListPage counts={counts} legend={legend} />}
      </main>
    </div>
  )
}

function colourOf(rec: Recognition, names: string[], g: number): string {
  return css(CATALOGUE[names[g]] ?? rec.groups[g]?.colour ?? GREY)
}

// ------------------------------------------------------------------ import

function ImportPage(props: {
  img: HTMLImageElement | null
  rec: Recognition | null
  names: string[]
  assign: Int16Array
  busy: string
  error: string
  onOpen: (src: Blob | string) => void
  onNext: () => void
}) {
  const { img, rec, names, assign, busy, error, onOpen, onNext } = props
  const board = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) onOpen(file)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  useEffect(() => {
    const canvas = board.current
    if (!canvas || !rec) return
    const { rows, cols } = rec.cells
    const px = Math.max(3, Math.floor(640 / Math.max(rows, cols)))
    canvas.width = cols * px
    canvas.height = rows * px
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < assign.length; i++) {
      if (assign[i] < 0) continue
      ctx.fillStyle = colourOf(rec, names, assign[i])
      ctx.fillRect((i % cols) * px, Math.floor(i / cols) * px, px, px)
    }
  }, [rec, names, assign])

  const unsure = rec ? rec.unsure.reduce((a, b) => a + b, 0) : 0
  const beads = assign.reduce((a, g) => a + (g >= 0 ? 1 : 0), 0)
  return (
    <div className="page">
      <label
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) onOpen(f)
        }}
      >
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onOpen(e.target.files[0])} />
        <strong>{busy || '选择图纸图片'}</strong>
        <span>也可以把图片拖进来，或直接粘贴</span>
      </label>
      <div className="samples">
        <span>样本图：</span>
        {SAMPLES.map((s) => (
          <button key={s} className="link" disabled={!!busy} onClick={() => onOpen(`/samples/${s}.jpg`)}>
            {s}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {rec && img && (
        <>
          <section className="card stats">
            <div>
              <b>
                {rec.cells.cols} × {rec.cells.rows}
              </b>
              <span>格子</span>
            </div>
            <div>
              <b>{rec.groups.length}</b>
              <span>种颜色</span>
            </div>
            <div>
              <b>{beads}</b>
              <span>颗</span>
            </div>
            <div>
              <b>{unsure}</b>
              <span>格待确认</span>
            </div>
          </section>
          <section className="card compare">
            <figure>
              <img src={img.src} alt="原图" />
              <figcaption>原图</figcaption>
            </figure>
            <figure>
              <canvas ref={board} />
              <figcaption>识别结果</figcaption>
            </figure>
          </section>
          <button className="primary" onClick={onNext}>
            下一步：确认色号
          </button>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ codes

function Label({ label, px = 96 }: { label: Float32Array; px?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) paintLabel(ref.current, label, px * 2)
  }, [label, px])
  return <canvas ref={ref} className="label" style={{ width: px, height: px }} />
}

function CodesPage(props: {
  img: HTMLImageElement
  rec: Recognition
  names: string[]
  counts: Map<string, number>
  legend: Record<string, number>
  onNames: (n: string[]) => void
  legendRect: Rect | null
  onLegend: (l: Record<string, number>) => void
  onLegendRect: (r: Rect | null) => void
  onNext: () => void
}) {
  const { img, rec, names, counts, legend, legendRect, onNames, onLegend, onLegendRect, onNext } = props
  const [cropping, setCropping] = useState(false)
  const [ai, setAi] = useState<AiSettings>(loadAiSettings)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [showAi, setShowAi] = useState(false)

  // order is fixed when the page opens so cards do not jump around while names are edited
  const [order] = useState(() => rec.groups.map((_, i) => i).sort((a, b) => (counts.get(names[b]) ?? 0) - (counts.get(names[a]) ?? 0)))
  const dupes = new Set(names.filter((n, i) => names.indexOf(n) !== i))

  async function askAi() {
    setBusy(true)
    setNote('')
    saveAiSettings(ai)
    try {
      const reading = await readCodesWithAi(img, rec, legendRect, ai)
      let changed = 0
      const next = names.map((n, i) => {
        const c = reading.codes[i]
        if (c && c !== n) changed++
        return c ?? n
      })
      onNames(next)
      onLegend(reading.legend)
      const missed = reading.codes.filter((c) => !c).length
      const read = Object.keys(reading.legend).length
      setNote(`AI 改了 ${changed} 个色号${missed ? `，有 ${missed} 个没读出来（保留原判断）` : ''}${read ? `，并读到图例上 ${read} 个色号的颗数` : ''}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <section className="card legendpanel">
        <div className="row">
          <b>原图图例</b>
          <button className="link" onClick={() => setCropping(true)}>
            {legendRect ? '重新框选' : '框选图例'}
          </button>
        </div>
        {legendRect ? <LegendView img={img} rect={legendRect} /> : <p className="hint">没有自动找到图例。点"框选图例"自己框一下。</p>}
      </section>
      {cropping && (
        <CropSheet
          img={img}
          onDone={(r) => {
            onLegendRect(r)
            setCropping(false)
          }}
          onCancel={() => setCropping(false)}
        />
      )}
      <p className="hint">每张卡片是一种颜色：左边是这种颜色所有格子叠在一起后的色号，右边是程序读出的名字。名字不对就直接改，整组一起改。</p>
      <section className="card ai">
        <button className="link" onClick={() => setShowAi(!showAi)}>
          {showAi ? '收起' : '让 AI 读色号（可选）'}
        </button>
        {showAi && (
          <div className="aiform">
            <input placeholder="OpenRouter API Key" type="password" autoComplete="off" value={ai.key} onChange={(e) => setAi({ ...ai, key: e.target.value })} />
            <input placeholder="模型 ID（在 OpenRouter 模型页复制）" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} />
            <button className="primary small" disabled={busy || !ai.key || !ai.model} onClick={askAi}>
              {busy ? '读取中…' : '读色号'}
            </button>
            <p className="hint">只发送这一页的色号小图和图纸底部的图例，不发整张图纸。Key 只存在这台设备上。</p>
          </div>
        )}
        {note && <p className="hint">{note}</p>}
      </section>
      <div className="codes">
        {order.map((i) => {
          const g = rec.groups[i]
          const valid = names[i] in CATALOGUE
          const n = counts.get(names[i]) ?? 0
          const want = legend[names[i]]
          return (
            <div key={i} className="card code">
              <Label label={g.label} />
              <div className="codeinfo">
                <div className="row">
                  <span className="swatch" style={{ background: css(g.colour) }} />
                  <input
                    className={!valid ? 'bad' : dupes.has(names[i]) ? 'warn' : ''}
                    value={names[i]}
                    onChange={(e) => onNames(names.map((v, k) => (k === i ? e.target.value.toUpperCase().trim() : v)))}
                    aria-label="色号"
                  />
                </div>
                <span className="sub">
                  {n} 颗{want !== undefined && (want === n ? '，与图例一致' : `，图例 ${want}`)}
                </span>
                {!valid && <span className="sub bad">不是 MARD 色号</span>}
                {valid && dupes.has(names[i]) && <span className="sub">与另一组同名，会合并</span>}
              </div>
            </div>
          )
        })}
      </div>
      <button className="primary" onClick={onNext}>
        下一步：逐格核对
      </button>
    </div>
  )
}

/** The legend cut from the original image, enlarged so its small print can be read. */
function LegendView({ img, rect }: { img: HTMLImageElement; rect: Rect }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // a legend is a thin strip: start zoomed in far enough that its print is about readable size
  const [zoom, setZoom] = useState(() => Math.min(4, Math.max(1, Math.round((4 * 90) / ((720 * rect.h) / rect.w)) / 4)))
  useEffect(() => {
    const c = ref.current
    if (!c) return
    // enlarged for sharp zooming, but kept under the canvas size phones allow
    const scale = Math.min(2 * (window.devicePixelRatio || 1), 4096 / rect.w)
    c.width = Math.round(rect.w * scale)
    c.height = Math.round(rect.h * scale)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  }, [img, rect])
  return (
    <>
      <div className="legendscroll">
        <canvas ref={ref} style={{ width: `${100 * zoom}%`, aspectRatio: `${rect.w} / ${rect.h}` }} />
      </div>
      <div className="row zoomrow">
        <span className="sub">放大</span>
        <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="图例放大倍数" />
      </div>
    </>
  )
}

/** Drag a box around the legend on the full image. */
function CropSheet({ img, onDone, onCancel }: { img: HTMLImageElement; onDone: (r: Rect) => void; onCancel: () => void }) {
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const ok = box && Math.abs(box.x1 - box.x0) > 0.02 && Math.abs(box.y1 - box.y0) > 0.005
  return (
    <div className="sheet" onClick={onCancel}>
      <div className="sheetbody wide" onClick={(e) => e.stopPropagation()}>
        <p className="hint">在图上拖一个框，把图例框住。</p>
        <div
          className="cropstage"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = at(e)
            start.current = p
            setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerMove={(e) => {
            if (!start.current) return
            const p = at(e)
            setBox({ x0: start.current.x, y0: start.current.y, x1: p.x, y1: p.y })
          }}
          onPointerUp={() => (start.current = null)}
        >
          <img src={img.src} alt="原图" draggable={false} />
          {box && (
            <div
              className="cropbox"
              style={{
                left: `${Math.min(box.x0, box.x1) * 100}%`,
                top: `${Math.min(box.y0, box.y1) * 100}%`,
                width: `${Math.abs(box.x1 - box.x0) * 100}%`,
                height: `${Math.abs(box.y1 - box.y0) * 100}%`,
              }}
            />
          )}
        </div>
        <div className="row">
          <button className="link" onClick={onCancel}>
            取消
          </button>
          <button
            className="primary small"
            disabled={!ok}
            onClick={() =>
              box &&
              onDone({
                x: Math.round(Math.min(box.x0, box.x1) * img.naturalWidth),
                y: Math.round(Math.min(box.y0, box.y1) * img.naturalHeight),
                w: Math.round(Math.abs(box.x1 - box.x0) * img.naturalWidth),
                h: Math.round(Math.abs(box.y1 - box.y0) * img.naturalHeight),
              })
            }
          >
            用这个范围
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ wall

const TILE = 44

function Tiles(props: { img: HTMLImageElement; rec: Recognition; cells: number[]; selected: Set<number>; onPick: (cell: number) => void }) {
  const { img, rec, cells, selected, onPick } = props
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [perRow, setPerRow] = useState(8)

  useLayoutEffect(() => {
    const measure = () => wrap.current && setPerRow(Math.max(4, Math.floor(wrap.current.clientWidth / TILE)))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const rows = Math.ceil(cells.length / perRow)
    c.width = perRow * TILE * dpr
    c.height = rows * TILE * dpr
    c.style.width = `${perRow * TILE}px`
    c.style.height = `${rows * TILE}px`
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.imageSmoothingQuality = 'high'
    const { grid, cells: board } = rec
    cells.forEach((cell, k) => {
      const sx = grid.offX + (board.c0 + (cell % board.cols)) * grid.perX
      const sy = grid.offY + (board.r0 + Math.floor(cell / board.cols)) * grid.perY
      const x = (k % perRow) * TILE
      const y = Math.floor(k / perRow) * TILE
      ctx.drawImage(img, sx, sy, grid.perX, grid.perY, x + 1, y + 1, TILE - 2, TILE - 2)
      if (rec.unsure[cell]) {
        ctx.strokeStyle = '#ff9500'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4)
      }
      if (selected.has(cell)) {
        ctx.fillStyle = 'rgba(0, 122, 255, 0.28)'
        ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2)
        ctx.strokeStyle = '#007aff'
        ctx.lineWidth = 3
        ctx.strokeRect(x + 2.5, y + 2.5, TILE - 5, TILE - 5)
      }
    })
  }, [img, rec, cells, perRow, selected])

  return (
    <div ref={wrap} className="tiles">
      <canvas
        ref={canvas}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const k = Math.floor((e.clientY - r.top) / TILE) * perRow + Math.floor((e.clientX - r.left) / TILE)
          if (k >= 0 && k < cells.length) onPick(cells[k])
        }}
      />
    </div>
  )
}

function WallPage(props: {
  img: HTMLImageElement
  rec: Recognition
  names: string[]
  assign: Int16Array
  counts: Map<string, number>
  legend: Record<string, number>
  onAssign: (a: Int16Array) => void
  onNames: (n: string[]) => void
}) {
  const { img, rec, names, assign, counts, legend, onAssign, onNames } = props
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [onlyUnsure, setOnlyUnsure] = useState(false)
  const LIMIT = 160

  const byCode = useMemo(() => {
    const m = new Map<string, number[]>()
    for (let i = 0; i < assign.length; i++) {
      if (assign[i] < 0) continue
      const code = names[assign[i]]
      if (!m.has(code)) m.set(code, [])
      m.get(code)!.push(i)
    }
    // least certain first: mistakes are most likely at the top of each wall
    for (const list of m.values()) list.sort((a, b) => rec.unsure[b] - rec.unsure[a] || rec.confidence[a] - rec.confidence[b])
    return [...m].sort((a, b) => codeOrder(a[0], b[0]))
  }, [assign, names, rec])

  const codes = [...new Set(names)].sort(codeOrder)
  const toggle = (cell: number) => {
    const next = new Set(selected)
    if (!next.delete(cell)) next.add(cell)
    setSelected(next)
  }
  const move = (code: string | null) => {
    let g = code === null ? -1 : names.indexOf(code)
    if (code !== null && g < 0) {
      // a colour the recogniser never found: it becomes a new group
      g = names.length
      onNames([...names, code])
    }
    const next = Int16Array.from(assign)
    for (const cell of selected) next[cell] = g
    onAssign(next)
    setSelected(new Set())
    setPicking(false)
    setCustom('')
  }
  const first = selected.size ? [...selected][0] : null
  const customCode = custom.toUpperCase().trim()

  return (
    <div className="page">
      <p className="hint">每一面墙是被认成同一个色号的全部格子，直接从原图裁出来。混进去的错格子点一下改掉。橙色框是程序没把握的，排在最前面。</p>
      <label className="toggle">
        <input type="checkbox" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} /> 只看没把握的
      </label>
      {byCode.map(([code, all]) => {
        const cells = onlyUnsure ? all.filter((c) => rec.unsure[c]) : all
        if (!cells.length) return null
        const open = expanded.has(code)
        const shown = open ? cells : cells.slice(0, LIMIT)
        const want = legend[code]
        return (
          <section key={code} className="card wall">
            <header>
              <span className="swatch" style={{ background: css(CATALOGUE[code] ?? GREY) }} />
              <b>{code}</b>
              <span className="sub">
                {counts.get(code)} 颗{want !== undefined && (want === counts.get(code) ? '，与图例一致' : `，图例 ${want}`)}
              </span>
            </header>
            <Tiles img={img} rec={rec} cells={shown} selected={selected} onPick={toggle} />
            {cells.length > LIMIT && (
              <button className="link" onClick={() => setExpanded(new Set(open ? [...expanded].filter((c) => c !== code) : [...expanded, code]))}>
                {open ? '收起' : `显示全部 ${cells.length} 格`}
              </button>
            )}
          </section>
        )
      })}
      {selected.size > 0 && !picking && (
        <div className="actionbar">
          <span>已选 {selected.size} 格</span>
          <button className="link" onClick={() => setSelected(new Set())}>
            取消
          </button>
          <button className="primary small" onClick={() => setPicking(true)}>
            改为…
          </button>
        </div>
      )}
      {picking && first !== null && (
        <div className="sheet" onClick={() => setPicking(false)}>
          <div className="sheetbody" onClick={(e) => e.stopPropagation()}>
            <Zoom img={img} rec={rec} cell={first} />
            <p className="hint">{selected.size > 1 ? `这 ${selected.size} 格应该是：` : '这一格应该是：'}</p>
            <div className="choices">
              {codes.map((c) => (
                <button key={c} className="choice" onClick={() => move(c)}>
                  <span className="swatch" style={{ background: css(CATALOGUE[c] ?? GREY) }} />
                  {c}
                </button>
              ))}
              <button className="choice" onClick={() => move(null)}>
                空格
              </button>
            </div>
            <div className="row newcode">
              <input placeholder="其他色号，如 A22" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="其他色号" />
              <button className="primary small" disabled={!(customCode in CATALOGUE)} onClick={() => move(customCode)}>
                用这个
              </button>
            </div>
            <button className="link" onClick={() => setPicking(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The cell with its neighbours, large, so the label can be read. */
function Zoom({ img, rec, cell }: { img: HTMLImageElement; rec: Recognition; cell: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const { grid, cells } = rec
    const side = 240
    c.width = c.height = side
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    const sx = grid.offX + (cells.c0 + (cell % cells.cols) - 1) * grid.perX
    const sy = grid.offY + (cells.r0 + Math.floor(cell / cells.cols) - 1) * grid.perY
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, side, side)
    ctx.drawImage(img, sx, sy, grid.perX * 3, grid.perY * 3, 0, 0, side, side)
    ctx.strokeStyle = '#007aff'
    ctx.lineWidth = 3
    ctx.strokeRect(side / 3, side / 3, side / 3, side / 3)
  }, [img, rec, cell])
  return <canvas ref={ref} className="zoom" />
}

// ------------------------------------------------------------------ list

function ListPage(props: { counts: Map<string, number>; legend: Record<string, number> }) {
  const { counts, legend } = props
  const rows = [...counts].sort((a, b) => codeOrder(a[0], b[0]))
  const total = rows.reduce((a, [, n]) => a + n, 0)
  const [copied, setCopied] = useState(false)
  const text = rows.map(([c, n]) => `${c}\t${n}`).join('\n')
  return (
    <div className="page">
      <section className="card list">
        {rows.map(([code, n]) => (
          <div key={code} className="line">
            <span className="swatch" style={{ background: css(CATALOGUE[code] ?? GREY) }} />
            <b>{code}</b>
            {legend[code] !== undefined && legend[code] !== n && <span className="sub">图例 {legend[code]}</span>}
            <span className="num">{n}</span>
          </div>
        ))}
        <div className="line total">
          <b>共 {rows.length} 色</b>
          <span className="num">{total}</span>
        </div>
      </section>
      <button
        className="primary"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        }}
      >
        {copied ? '已复制' : '复制清单'}
      </button>
    </div>
  )
}
