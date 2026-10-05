import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AiLegend, type AiSettings, loadAiSettings, readCellsWithAi, readLegendWithAi } from '../ai'
import { loadImage, paintLabel, renderText, toRaster } from '../browser'
import { CATALOGUE } from '../engine/glyphs'
import { type Extent, findBoard, findGrid, type Grid, type Raster } from '../engine/grid'
import { findLegend, outsideBoard, type Rect } from '../engine/legendArea'
import { applyReading, fitList, needsHelp, type Reading, readLocally } from '../engine/legendRead'
import { stack } from '../engine/cells'
import { recognise, type Recognition } from '../engine/recognize'
import { Icon } from '../Icon'
import { LinkImport } from './LinkImport'
import { boardThumb, codeOrder, copyText, css, GREY, ICONS, newId } from '../shared'
import { type Chart, countCells, ENGINE_VERSION, putChart, type Status, STATUS_LABEL } from '../store'

type Step = 'import' | 'codes' | 'wall' | 'list'
const STEPS: [Step, string][] = [
  ['import', '导入'],
  ['codes', '色号'],
  ['wall', '核对'],
  ['list', '清单'],
]
const SAMPLES = ['tree-52x64', 'landscape-84x84', 'portrait-50x70', 'dog-104x104']

// below these a step is marked for checking by hand
const MAX_CELLS_CHECKED = 300 // cells shown to the model per run (three requests)
const COUNT_AGREEMENT = 0.98 // cells counted per code vs the printed legend counts
const UNSURE_SHARE = 0.05 // cells the reading is unsure of

/**
 * Recognising a new chart, or reopening a saved one to correct it. Full screen, over the tabs.
 */
export function Flow({ chart, onClose, onSaved }: { chart?: Chart; onClose: () => void; onSaved: (id: string) => void }) {
  const [step, setStepState] = useState<Step>(chart ? 'codes' : 'import')
  // each step starts at its top; the steps share one scroll position otherwise
  const setStep = (t: Step) => {
    setStepState(t)
    window.scrollTo(0, 0)
  }
  const [file, setFile] = useState<Blob | null>(chart?.image ?? null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [rec, setRec] = useState<Recognition | null>(null)
  // before the legend reading replaced its groups, and the local reading: AI and board changes start from these
  const [base, setBase] = useState<Recognition | null>(null)
  const [local, setLocal] = useState<Reading | null>(null)
  const [readNote, setReadNote] = useState('')
  // a note title from link import, offered as the chart's name
  const [suggested, setSuggested] = useState('')
  // what the vision model read off the legend, kept so a board change does not ask again
  const [aiLegend, setAiLegend] = useState<AiLegend | null>(null)
  const [localUnsure, setLocalUnsure] = useState(false)
  const [names, setNamesState] = useState<string[]>([])
  const [assign, setAssignState] = useState<Int16Array>(new Int16Array(0))
  const [legend, setLegendState] = useState<Record<string, number>>({})
  const [legendRect, setLegendRectState] = useState<Rect | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const edited = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setDirty(true)
  }
  const setNames = edited(setNamesState)
  const setAssign = edited(setAssignState)
  const setLegend = edited(setLegendState)
  const setLegendRect = edited(setLegendRectState)

  async function open(src: Blob | string, saved?: Chart, board?: { grid: Grid; extent: Extent }, known?: AiLegend | null) {
    setError('')
    setBusy(saved ? '正在打开…' : '正在识别…')
    try {
      const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src
      const image = await loadImage(blob)
      // let the "working" state paint before the main thread is busy
      await new Promise((r) => setTimeout(r, 30))
      const raster = toRaster(image)
      // a saved chart's cells only line up with the board it was saved on
      const where = board ?? (saved ? (saved.board ?? findSavedBoard(raster, saved)) : undefined)
      const first = recognise(raster, renderText, undefined, where)
      // local first: swatches found and named on the chart itself
      const localReading = readLocally(raster, first, renderText)
      const rect = saved ? saved.legendRect : (findLegend(raster, first) ?? outsideBoard(first, raster.width, raster.height))
      let reading = localReading
      let got: AiLegend | null = known ?? null
      let note = !localReading ? '没有在图上找到图例色块' : needsHelp(localReading) ? '本地读图例没把握' : '已按图例读出色号'
      // With a key set, the model reads every new legend: its codes and printed counts check the
      // local reading (about $0.001 a chart). Without one, only the local reading.
      if (!saved && !got) {
        const ai = loadAiSettings()
        if (ai.key && ai.model && rect) {
          setBusy('AI 正在读图例…')
          try {
            got = await readLegendWithAi(image, rect, ai)
          } catch (e) {
            note += `；AI 读取失败：${e instanceof Error ? e.message : String(e)}`
          }
        } else if (needsHelp(localReading)) note += '。可以在「色号」页让 AI 读图例（需先在设置里填 Key），或手动核对'
      }
      if (got) {
        reading = fitList(first, got.entries, localReading, renderText)
        note = `AI 读出图例上 ${got.entries.length} 个色号，已按颜色和颗数对到格子上`
      }
      const printed: Record<string, number> = got ? Object.fromEntries(got.entries.filter((e) => e.count !== undefined).map((e) => [e.code, e.count!])) : {}
      let result = reading ? applyReading(first, reading) : first
      if (!result.groups.length && !saved) throw new Error('没有识别出带色号的格子，这张图可能不是带色号的图纸')
      let n = result.groups.map((g) => g.code)
      let a = Int16Array.from(result.assign)
      // with a key set, the model also reads the cells the recogniser is unsure of
      const ai = loadAiSettings()
      // with the legend read by the model, the model also names each group from a few of its cells:
      // colour and counts alone mix up codes of near the same colour
      if (!saved && got && ai.key && ai.model) {
        setBusy('AI 正在核对每种颜色的色号…')
        try {
          const named = await nameGroupsWithAi(image, result, n, a, ai)
          if (named) {
            n = named.names
            a = named.assign
            if (named.renamed) note += `；AI 看了每种颜色的几个格子，改正了 ${named.renamed} 个色号`
          }
        } catch (e) {
          note += `；AI 核对色号失败：${e instanceof Error ? e.message : String(e)}`
        }
      }
      if (!saved && ai.key && ai.model) {
        setBusy('AI 正在核对没把握的格子…')
        try {
          const checked = await checkCells(image, result, n, a, ai)
          if (checked) {
            n = checked.names
            a = checked.assign
            result = checked.rec
            note += `；AI 核对了 ${checked.asked} 个没把握的格子，改了 ${checked.changed} 格`
          }
        } catch (e) {
          note += `；AI 核对格子失败：${e instanceof Error ? e.message : String(e)}`
        }
      }
      if (saved) {
        const sameRun = saved.edit.engine === ENGINE_VERSION && saved.edit.assign.length === result.assign.length && saved.edit.names.length >= result.groups.length
        if (sameRun) {
          n = saved.edit.names
          a = Int16Array.from(saved.edit.assign)
        } else {
          // the recogniser changed since this was saved: lay the saved codes onto the new groups
          n = [...n]
          a = new Int16Array(saved.cells.length)
          saved.cells.forEach((code, i) => {
            if (!code) return void (a[i] = -1)
            let g = n.indexOf(code)
            if (g < 0) g = n.push(code) - 1
            a[i] = g
          })
        }
      }
      setFile(blob)
      setImg(image)
      setBase(first)
      setLocal(localReading)
      setRec(result)
      setReadNote(saved ? '' : note)
      setAiLegend(got)
      setLocalUnsure(!got && needsHelp(localReading))
      setNamesState(n)
      setAssignState(a)
      setLegendState(saved?.legend ?? printed)
      setLegendRectState(rect)
      setDirty(!saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  /** Ask the vision model to read the doubtful cells again (from the review page). */
  async function askCells(): Promise<string> {
    if (!img || !rec) return ''
    const checked = await checkCells(img, rec, names, assign, loadAiSettings())
    if (!checked) return '没有需要核对的格子'
    setRec(checked.rec)
    setNames(checked.names)
    setAssign(checked.assign)
    return `AI 核对了 ${checked.asked} 格，改了 ${checked.changed} 格`
  }

  /** Ask the vision model to read the legend and lay its list onto the board; returns the new names. */
  async function askAi(): Promise<string[]> {
    if (!img || !base) return names
    const ai = loadAiSettings()
    const rect = legendRect ?? outsideBoard(base, img.naturalWidth, img.naturalHeight)
    if (!rect) throw new Error('先框选图例')
    const got = await readLegendWithAi(img, rect, ai)
    const list = got.entries
    const r = applyReading(base, fitList(base, list, local, renderText))
    setAiLegend(got)
    setLocalUnsure(false)
    let next = r.groups.map((g) => g.code)
    let a = Int16Array.from(r.assign)
    let note = `AI 读出图例上 ${list.length} 个色号，已按颜色和颗数对到格子上`
    try {
      const named = await nameGroupsWithAi(img, r, next, a, ai)
      if (named) {
        next = named.names
        a = named.assign
        note += `；看了每种颜色的几个格子，改正了 ${named.renamed} 个色号`
      }
    } catch (e) {
      note += `；核对色号失败：${e instanceof Error ? e.message : String(e)}`
    }
    setRec(r)
    setNames(next)
    setAssign(a)
    setLegend({ ...legend, ...Object.fromEntries(list.filter((e) => e.count !== undefined).map((e) => [e.code, e.count!])) })
    setReadNote(note)
    return next
  }

  useEffect(() => {
    // reopening a saved chart: decode and recognise it once, after the first paint
    if (chart) void Promise.resolve().then(() => open(chart.image, chart))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of assign) if (g >= 0) m.set(names[g], (m.get(names[g]) ?? 0) + 1)
    return m
  }, [assign, names])

  // steps worth checking by hand, with the reason shown on that step
  const review = useMemo(() => {
    const out: Partial<Record<Step, string>> = {}
    if (!rec) return out
    const size = aiLegend?.size
    if (size && (size.cols !== rec.cells.cols || size.rows !== rec.cells.rows)) {
      out.import = `图上印着 ${size.cols}×${size.rows}，现在框的是 ${rec.cells.cols}×${rec.cells.rows}，请调整图纸范围`
    }
    const found = [...counts.values()].reduce((a, b) => a + b, 0)
    const printedTotal = aiLegend?.total
    if (printedTotal && found !== printedTotal && !out.import) {
      out.import = `图上印着共 ${printedTotal} 颗，现在数出 ${found} 颗，可能范围或空格判断有误`
    }
    const printed = Object.entries(legend)
    if (printed.length) {
      let off = 0
      for (const c of new Set([...printed.map(([c]) => c), ...counts.keys()])) off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0))
      const total = printed.reduce((a, [, n]) => a + n, 0)
      const agree = total ? 1 - off / 2 / total : 1
      if (agree < COUNT_AGREEMENT) out.codes = `识别颗数和图例只吻合 ${Math.round(agree * 100)}%，请核对色号`
    } else if (localUnsure) out.codes = '本地读图例没把握，请核对色号（或让 AI 读图例）'
    const unsure = rec.unsure.reduce((a, b) => a + b, 0)
    if (found && unsure / found > UNSURE_SHARE) out.wall = `有 ${unsure} 格程序没把握，请逐格核对`
    return out
  }, [rec, counts, legend, aiLegend, localUnsure])

  async function save(meta: { title: string; status: Status; tags: string[] }) {
    if (!rec || !file) return
    setSaving(true)
    try {
      const cells = Array.from(assign, (g) => (g >= 0 ? names[g] : ''))
      const now = Date.now()
      const record: Chart = {
        id: chart?.id ?? newId(),
        createdAt: chart?.createdAt ?? now,
        updatedAt: now,
        ...meta,
        image: file,
        thumb: await boardThumb(rec.cells.cols, rec.cells.rows, cells),
        cols: rec.cells.cols,
        rows: rec.cells.rows,
        cells,
        counts: countCells(cells),
        legend,
        legendRect,
        edit: { engine: ENGINE_VERSION, names, assign: Array.from(assign) },
        board: { grid: rec.grid, extent: { r0: rec.cells.r0, c0: rec.cells.c0, rows: rec.cells.rows, cols: rec.cells.cols } },
      }
      await putChart(record)
      setDirty(false)
      onSaved(record.id)
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const [asking, setAsking] = useState(false)
  const close = () => {
    if (!dirty || !rec || window.confirm('这次的识别和修改还没保存，确定离开吗？')) onClose()
  }
  const ready = !!(img && rec)
  const steps = chart ? STEPS.filter(([t]) => t !== 'import') : STEPS

  return (
    <div className="flow">
      <header className="flowbar">
        <button className="circle glass" aria-label="关闭" onClick={close}>
          <Icon d={ICONS.close} size={20} />
        </button>
        <nav className="segmented glass steps" role="tablist" aria-label="步骤">
          {steps.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={step === t} disabled={t !== 'import' && !ready} onClick={() => setStep(t)} className={review[t] ? 'needs' : undefined} title={review[t]}>
              {label}
            </button>
          ))}
        </nav>
        <button className="primary small" disabled={!ready || saving} onClick={() => setAsking(true)}>
          {saving ? '保存中…' : '保存'}
        </button>
      </header>
      <div className="title">
        <h1>{chart?.title ?? '识别新图纸'}</h1>
        {busy && <span className="sub">{busy}</span>}
      </div>
      {error && step !== 'import' && <p className="error page-error">{error}</p>}
      {step !== 'import' && review[step] && <p className="review page-error">{review[step]}</p>}
      <main>
        {step === 'import' && (
          <ImportPage
            img={img}
            rec={rec}
            names={names}
            assign={assign}
            busy={busy}
            error={error}
            note={readNote}
            onOpen={(f) => {
              setSuggested('')
              open(f)
            }}
            onLink={(f, title) => {
              setSuggested(title)
              open(f)
            }}
            onBoard={(extent) => rec && file && open(file, undefined, { grid: rec.grid, extent }, aiLegend)}
            review={review}
            printedSize={aiLegend?.size}
            onNext={() => setStep('codes')}
          />
        )}
        {step === 'codes' && img && rec && (
          <CodesPage img={img} rec={rec} names={names} assign={assign} counts={counts} legend={legend} legendRect={legendRect} onNames={setNames} onLegend={setLegend} onLegendRect={setLegendRect} onAskAi={askAi} onNext={() => setStep('wall')} />
        )}
        {step === 'wall' && img && rec && <WallPage img={img} rec={rec} names={names} assign={assign} counts={counts} legend={legend} onAssign={setAssign} onNames={setNames} onAskCells={askCells} />}
        {step === 'list' && img && rec && <ListPage counts={counts} legend={legend} onSave={() => setAsking(true)} />}
        {!ready && step !== 'import' && <p className="hint page-error">{busy || '没能打开这张图纸'}</p>}
      </main>
      {asking && (
        <SaveSheet
          initial={{ title: chart?.title ?? (suggested || defaultTitle()), status: chart?.status ?? 'todo', tags: chart?.tags ?? [] }}
          onCancel={() => setAsking(false)}
          onSave={(meta) => {
            setAsking(false)
            save(meta)
          }}
        />
      )}
    </div>
  )
}

/** Cells worth showing the model: unsure beads, and empty cells with print and beads around. */
function doubtfulCells(rec: Recognition, assign: Int16Array): number[] {
  const { cols, rows, share } = rec.cells
  const beadsAround = (i: number) => {
    const x = i % cols
    const y = (i - x) / cols
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && assign[b * cols + a] >= 0).length
  }
  const out: number[] = []
  for (let i = 0; i < assign.length; i++) {
    if (assign[i] >= 0 ? rec.unsure[i] : share[i] > 0.06 && beadsAround(i) >= 2) out.push(i)
  }
  // least sure first, in case there are more than one look can take
  return out.sort((a, b) => rec.confidence[a] - rec.confidence[b]).slice(0, MAX_CELLS_CHECKED)
}

const SAMPLES_PER_GROUP = 5
const NAME_VOTES = 3 // at least this many cells read alike...
const NAME_SHARE = 0.6 // ...and this share of those read, to rename a group

/**
 * Each group's name checked by the model: a few of its surest printed cells are read, and a group
 * whose cells clearly read as another code takes that name (two groups reading the same code
 * become one). The printed code settles what colour and counts could only guess.
 */
async function nameGroupsWithAi(img: HTMLImageElement, rec: Recognition, names: string[], assign: Int16Array, ai: AiSettings) {
  const codes = [...new Set(names.filter(Boolean))]
  const members: number[][] = names.map(() => [])
  assign.forEach((g, i) => {
    if (g >= 0 && rec.cells.share[i] > 0.06) members[g].push(i)
  })
  // spread over the surer half of each group, so one odd patch cannot outvote the rest
  const samples = members.flatMap((m) => {
    const sure = [...m].sort((x, y) => rec.confidence[y] - rec.confidence[x]).slice(0, Math.max(SAMPLES_PER_GROUP, Math.ceil(m.length / 2)))
    const step = Math.max(1, Math.floor(sure.length / SAMPLES_PER_GROUP))
    return sure.filter((_, k) => k % step === 0).slice(0, SAMPLES_PER_GROUP)
  })
  if (!samples.length || !codes.length) return null
  const read = await readCellsWithAi(img, rec, samples, codes, ai)
  const votes = names.map(() => new Map<string, number>())
  for (const [cell, code] of read) if (code) votes[assign[cell]].set(code, (votes[assign[cell]].get(code) ?? 0) + 1)
  const nextNames = [...names]
  const target = names.map((_, g) => g)
  let renamed = 0
  votes.forEach((v, g) => {
    const total = [...v.values()].reduce((x, y) => x + y, 0)
    const [top, n] = [...v].sort((x, y) => y[1] - x[1])[0] ?? ['', 0]
    if (!top || top === names[g] || n < NAME_VOTES || n < total * NAME_SHARE) return
    let to = nextNames.indexOf(top)
    if (to < 0) to = nextNames.push(top) - 1
    target[g] = to
    renamed++
  })
  if (!renamed) return null
  return { names: nextNames, assign: assign.map((g) => (g < 0 ? -1 : target[g])), renamed }
}

/** The model's reading of doubtful cells laid onto the board: read codes replace the guess, and the
 *  cell counts as checked. Cells it saw no code in are left as they were. */
async function checkCells(img: HTMLImageElement, rec: Recognition, names: string[], assign: Int16Array, ai: AiSettings) {
  const cells = doubtfulCells(rec, assign)
  const codes = [...new Set(names.filter(Boolean))]
  if (!cells.length || !codes.length) return null
  const read = await readCellsWithAi(img, rec, cells, codes, ai)
  const nextNames = [...names]
  const nextAssign = Int16Array.from(assign)
  const unsure = Uint8Array.from(rec.unsure)
  let changed = 0
  for (const [cell, code] of read) {
    if (!code) continue
    let g = nextNames.indexOf(code)
    if (g < 0) g = nextNames.push(code) - 1
    if (nextAssign[cell] !== g) changed++
    nextAssign[cell] = g
    unsure[cell] = 0
  }
  return { names: nextNames, assign: nextAssign, rec: { ...rec, unsure }, asked: cells.length, changed }
}

/**
 * For charts saved before the board was kept: the board the saved cells were read on. The grid is
 * found again; of the boards of the saved size near the found one, the one whose cell centres
 * best match the saved codes' bead colours is taken.
 */
function findSavedBoard(img: Raster, saved: Chart): { grid: Grid; extent: Extent } {
  const grid = findGrid(img)
  const auto = findBoard(img, grid)
  const { cols, rows, cells } = saved
  const { width: W, height: H, data } = img
  const known = cells.map((c, i) => [i, CATALOGUE[c]] as const).filter(([, c]) => c)
  const step = Math.max(1, Math.floor(known.length / 1500))
  let best = { r0: auto.r0, c0: auto.c0, rows, cols }
  let bestOff = Infinity
  // the saved board may have been trimmed anywhere inside the found one, or reach a little past it
  for (let r0 = auto.r0 - 4; r0 <= auto.r0 + Math.max(0, auto.rows - rows) + 4; r0++) {
    for (let c0 = auto.c0 - 4; c0 <= auto.c0 + Math.max(0, auto.cols - cols) + 4; c0++) {
      let off = 0
      for (let k = 0; k < known.length; k += step) {
        const [i, c] = known[k]
        // off-centre, clear of the printed code and the grid line
        const x = Math.round(grid.offX + (c0 + (i % cols) + 0.22) * grid.perX)
        const y = Math.round(grid.offY + (r0 + Math.floor(i / cols) + 0.22) * grid.perY)
        if (x < 0 || y < 0 || x >= W || y >= H) {
          off += 300
          continue
        }
        const p = (y * W + x) * 4
        off += Math.abs(data[p] - c!.r) + Math.abs(data[p + 1] - c!.g) + Math.abs(data[p + 2] - c!.b)
      }
      if (off < bestOff) {
        bestOff = off
        best = { r0, c0, rows, cols }
      }
    }
  }
  return { grid, extent: best }
}

function defaultTitle() {
  const d = new Date()
  return `图纸 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SaveSheet(props: { initial: { title: string; status: Status; tags: string[] }; onCancel: () => void; onSave: (m: { title: string; status: Status; tags: string[] }) => void }) {
  const [title, setTitle] = useState(props.initial.title)
  const [status, setStatus] = useState<Status>(props.initial.status)
  const [tags, setTags] = useState(props.initial.tags.join('，'))
  const parsed = tags
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  return (
    <div className="sheet" onClick={props.onCancel}>
      <form
        className="sheetbody form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          props.onSave({ title: title.trim() || defaultTitle(), status, tags: [...new Set(parsed)] })
        }}
      >
        <h2>保存图纸</h2>
        <label className="field">
          <span>名称</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <div className="field">
          <span>状态</span>
          <div className="segmented" role="radiogroup" aria-label="状态">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button type="button" key={s} role="radio" aria-checked={status === s} aria-selected={status === s} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>标签（用逗号或空格分开）</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如 动物，小号" />
        </label>
        <div className="row end">
          <button type="button" className="link" onClick={props.onCancel}>
            取消
          </button>
          <button type="submit" className="primary small">
            保存
          </button>
        </div>
      </form>
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
  note: string
  review: Partial<Record<Step, string>>
  printedSize?: { cols: number; rows: number }
  onOpen: (src: Blob | string) => void
  onLink: (image: Blob, title: string) => void
  onBoard: (extent: Extent) => void
  onNext: () => void
}) {
  const { img, rec, names, assign, busy, error, note, review, printedSize, onOpen, onLink, onBoard, onNext } = props
  const checks = STEPS.filter(([t]) => review[t])
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
      <LinkImport disabled={!!busy} onPick={onLink} />
      {/* other people's charts: on this Mac only, never in the published app */}
      {import.meta.env.DEV && (
        <div className="samples">
          <span>试用样本图：</span>
          {SAMPLES.map((s) => (
            <button key={s} className="link" disabled={!!busy} onClick={() => onOpen(`/samples/${s}.jpg`)}>
              {s}
            </button>
          ))}
        </div>
      )}
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
          {note && <p className="hint">{note}</p>}
          {checks.length > 0 && (
            <section className="card review">
              <b>建议人工核对</b>
              {checks.map(([t, label]) => (
                <p key={t}>
                  <span className="sub">{label}：</span>
                  {review[t]}
                </p>
              ))}
            </section>
          )}
          <BoardCheck key={`${rec.cells.r0},${rec.cells.c0},${rec.cells.rows},${rec.cells.cols}`} img={img} rec={rec} busy={!!busy} printedSize={printedSize} onApply={onBoard} />
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

/** The board the recogniser settled on, drawn over the image, with each edge movable by whole cells. */
function BoardCheck({ img, rec, busy, printedSize, onApply }: { img: HTMLImageElement; rec: Recognition; busy: boolean; printedSize?: { cols: number; rows: number }; onApply: (e: Extent) => void }) {
  const found = { r0: rec.cells.r0, c0: rec.cells.c0, rows: rec.cells.rows, cols: rec.cells.cols }
  const [ext, setExt] = useState(found)
  const ref = useRef<HTMLCanvasElement>(null)
  const { grid } = rec
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const scale = Math.min(1, 900 / img.naturalWidth)
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const x = (grid.offX + ext.c0 * grid.perX) * scale
    const y = (grid.offY + ext.r0 * grid.perY) * scale
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, c.width, y)
    ctx.fillRect(0, y + ext.rows * grid.perY * scale, c.width, c.height)
    ctx.fillRect(0, y, x, ext.rows * grid.perY * scale)
    ctx.fillRect(x + ext.cols * grid.perX * scale, y, c.width, ext.rows * grid.perY * scale)
    ctx.strokeStyle = '#007aff'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, ext.cols * grid.perX * scale, ext.rows * grid.perY * scale)
  }, [img, grid, ext])
  const changed = ext.r0 !== found.r0 || ext.c0 !== found.c0 || ext.rows !== found.rows || ext.cols !== found.cols
  // the smallest board that still holds every bead: authors often leave rows of empty cells around
  const trimmed = useMemo(() => {
    const { cols, rows } = rec.cells
    let top = rows
    let bottom = -1
    let left = cols
    let right = -1
    rec.assign.forEach((g, i) => {
      if (g < 0) return
      const x = i % cols
      const y = (i - x) / cols
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      left = Math.min(left, x)
      right = Math.max(right, x)
    })
    if (bottom < 0 || (top === 0 && left === 0 && bottom === rows - 1 && right === cols - 1)) return null
    return { r0: rec.cells.r0 + top, c0: rec.cells.c0 + left, rows: bottom - top + 1, cols: right - left + 1 }
  }, [rec])
  // moving an edge by one cell: top/left move the origin, bottom/right only the size
  const edge = (side: 'top' | 'bottom' | 'left' | 'right', d: number) => {
    const e = { ...ext }
    if (side === 'top') {
      e.r0 -= d
      e.rows += d
    } else if (side === 'bottom') e.rows += d
    else if (side === 'left') {
      e.c0 -= d
      e.cols += d
    } else e.cols += d
    if (e.rows >= 2 && e.cols >= 2) setExt(e)
  }
  const stepper = (side: 'top' | 'bottom' | 'left' | 'right', label: string) => (
    <div className="edgestep">
      <span className="sub">{label}</span>
      <button className="link" aria-label={`${label}收一格`} onClick={() => edge(side, -1)}>
        −
      </button>
      <button className="link" aria-label={`${label}扩一格`} onClick={() => edge(side, 1)}>
        +
      </button>
    </div>
  )
  return (
    <section className="card boardcheck">
      <div className="row">
        <b>图纸范围</b>
        <span className={printedSize && (printedSize.cols !== ext.cols || printedSize.rows !== ext.rows) ? 'sub bad' : 'sub'}>
          {ext.cols} 列 × {ext.rows} 行{printedSize && `（图上印着 ${printedSize.cols} × ${printedSize.rows}）`}
        </span>
      </div>
      <canvas ref={ref} className="boardcanvas" />
      <p className="hint">蓝框是程序找到的图纸范围。和图纸上印的行列号对一下，不对就逐格调整边缘。</p>
      {trimmed && (
        <button className="link" onClick={() => setExt(trimmed)}>
          裁掉四周空白（{trimmed.cols} 列 × {trimmed.rows} 行）
        </button>
      )}
      <div className="edgesteps">
        {stepper('top', '上边')}
        {stepper('bottom', '下边')}
        {stepper('left', '左边')}
        {stepper('right', '右边')}
      </div>
      {changed && (
        <div className="row end">
          <button className="link" onClick={() => setExt(found)}>
            还原
          </button>
          <button className="primary small" disabled={busy} onClick={() => onApply(ext)}>
            按这个范围重新识别
          </button>
        </div>
      )}
    </section>
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
  assign: Int16Array
  counts: Map<string, number>
  legend: Record<string, number>
  legendRect: Rect | null
  onNames: (n: string[]) => void
  onLegend: (l: Record<string, number>) => void
  onLegendRect: (r: Rect | null) => void
  onAskAi: () => Promise<string[]>
  onNext: () => void
}) {
  const { img, rec, names, assign, counts, legend, legendRect, onNames, onLegend, onLegendRect, onAskAi, onNext } = props
  const [cropping, setCropping] = useState(false)
  // each row's stacked print and colour, from the cells it has now: cells move between groups
  // (the model naming groups, cells corrected on the review page) after the recogniser drew them
  const current = useMemo(() => {
    const members: number[][] = names.map(() => [])
    assign.forEach((g, i) => {
      if (g >= 0 && members[g] && rec.cells.share[i] > 0.06) members[g].push(i)
    })
    const { fill } = rec.cells
    return members.map((m, g) => {
      if (!m.length) return null
      let r = 0
      let gr = 0
      let b = 0
      for (const i of m) {
        r += fill[i * 3]
        gr += fill[i * 3 + 1]
        b += fill[i * 3 + 2]
      }
      return { label: stack(rec.cells, m.slice(0, 400)), colour: { r: r / m.length, g: gr / m.length, b: b / m.length } }
    })
  }, [names, assign, rec])
  const [ai] = useState<AiSettings>(loadAiSettings)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [showAi, setShowAi] = useState(false)
  const [sort, setSort] = useState<'count' | 'code'>('count')
  const [newCode, setNewCode] = useState('')
  const [newCount, setNewCount] = useState('')
  // where the add row is open: under this group's row, or null for the end of the list
  const [insertAt, setInsertAt] = useState<number | null>(null)
  // a whole code changed into another, or two codes swapped
  const [bulk, setBulk] = useState<{ mode: 'recolour' | 'swap'; a: string; b: string } | null>(null)

  // Legends are printed either by count or by code, so the list can follow either. The order is
  // recomputed when the mode changes or an edit is finished, not on every keystroke, so a row
  // does not jump away while its code is being typed.
  // a colour the recogniser missed sorts by the count typed for it
  const size = (code: string) => counts.get(code) || legend[code] || 0
  // rows whose count disagrees with the legend first, whichever order is chosen
  const disagrees = (code: string) => (legend[code] !== undefined && (counts.get(code) ?? 0) !== legend[code] ? 1 : 0)
  const sortedBy = (mode: 'count' | 'code', list: string[]) =>
    list
      .map((_, i) => i)
      .filter((i) => list[i])
      .sort(
        (x, y) =>
          disagrees(list[y]) - disagrees(list[x]) ||
          (mode === 'code' ? codeOrder(list[x], list[y]) : size(list[y]) - size(list[x]) || codeOrder(list[x], list[y])),
      )
  const [order, setOrder] = useState(() => sortedBy(sort, names))
  const resort = () => setOrder(sortedBy(sort, names))
  const changeSort = (mode: 'count' | 'code') => {
    setSort(mode)
    setOrder(sortedBy(mode, names))
  }

  const live = names.filter(Boolean)
  const dupes = new Set(live.filter((n, i) => live.indexOf(n) !== i))
  const setCount = (code: string, text: string) => {
    const next = { ...legend }
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) delete next[code]
    else next[code] = Math.round(n)
    onLegend(next)
  }
  const rename = (i: number, text: string) => {
    const code = text.toUpperCase().trim()
    const old = names[i]
    // the count typed for a row follows the row when its code is corrected
    if (old in legend && !(code in legend) && !names.some((n, k) => k !== i && n === old)) {
      const next = { ...legend, [code]: legend[old] }
      delete next[old]
      onLegend(next)
    }
    onNames(names.map((v, k) => (k === i ? code : v)))
  }
  const addCode = newCode.toUpperCase().trim()
  const canAdd = addCode in CATALOGUE && !live.includes(addCode)
  const add = () => {
    const next = [...names, addCode]
    onNames(next)
    // the new row stays where it was inserted, so it lines up with the legend being read
    const at = insertAt === null ? -1 : order.indexOf(insertAt)
    setOrder(at < 0 ? [...order, names.length] : [...order.slice(0, at + 1), names.length, ...order.slice(at + 1)])
    setInsertAt(null)
    if (newCount.trim()) setCount(addCode, newCount)
    setNewCode('')
    setNewCount('')
  }

  const bulkTo = bulk ? bulk.b.toUpperCase().trim().replace(/^([A-Z]+)0+(\d)/, '$1$2') : ''
  const bulkOk = !!bulk && !!bulk.a && bulkTo in CATALOGUE && bulkTo !== bulk.a && (bulk.mode === 'recolour' || live.includes(bulkTo))
  const applyBulk = () => {
    if (!bulk || !bulkOk) return
    const { mode, a } = bulk
    const next = names.map((n) => (n === a ? bulkTo : mode === 'swap' && n === bulkTo ? a : n))
    onNames(next)
    setOrder(sortedBy(sort, next))
    setBulk(null)
  }

  const found = [...counts.values()].reduce((x, y) => x + y, 0)
  const printed = Object.entries(legend).filter(([c]) => live.includes(c))
  const printedTotal = printed.reduce((x, [, n]) => x + n, 0)
  const mismatched = printed.filter(([c, n]) => (counts.get(c) ?? 0) !== n).length

  const addRow = (
    <div className="coderow add">
      <span className="nolabel">新增</span>
      <div className="codecell">
        <input className="codeinput" placeholder="色号" value={newCode} onChange={(e) => setNewCode(e.target.value)} aria-label="新增色号" />
        {newCode && !(addCode in CATALOGUE) && <span className="sub bad">不是 MARD 色号</span>}
        {live.includes(addCode) && <span className="sub">已在列表里</span>}
      </div>
      <span className="num">0</span>
      <div className="wantcell">
        <input className="countinput" inputMode="numeric" placeholder="颗数" value={newCount} onChange={(e) => setNewCount(e.target.value.replace(/\D/g, ''))} aria-label="新增色号的图例颗数" />
      </div>
      <span className="rowactions">
        <button className="link" disabled={!canAdd} onClick={add}>
          添加
        </button>
        {insertAt !== null && (
          <button className="link" onClick={() => setInsertAt(null)}>
            取消
          </button>
        )}
      </span>
    </div>
  )

  async function askAi() {
    setBusy(true)
    setNote('')
    try {
      const next = await onAskAi()
      setOrder(sortedBy(sort, next))
      setNote('AI 已重新读了图例，下面的色号和图例颗数都按它更新了')
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
      <section className="card ai">
        <button className="link" onClick={() => setShowAi(!showAi)}>
          {showAi ? '收起' : '让 AI 读图例（可选）'}
        </button>
        {showAi &&
          (ai.key && ai.model ? (
            <div className="aiform">
              <button className="primary small" disabled={busy} onClick={askAi}>
                {busy ? '读取中…' : '读图例'}
              </button>
              <p className="hint">只发送上面这块图例截图，不发整张图纸。AI 只负责读出色号和颗数，对到格子上是本机算的。</p>
            </div>
          ) : (
            <p className="hint">先到「设置」里填好 OpenRouter Key 和模型，这里就能一键让 AI 读图例。</p>
          ))}
        {note && <p className="hint">{note}</p>}
      </section>

      <div className="listhead">
        <div className="segmented small" role="tablist" aria-label="排序">
          <button role="tab" aria-selected={sort === 'count'} onClick={() => changeSort('count')}>
            按数量
          </button>
          <button role="tab" aria-selected={sort === 'code'} onClick={() => changeSort('code')}>
            按色号
          </button>
        </div>
        <span className="sub">
          {live.length} 色，识别 {found} 颗{printed.length > 0 && `；图例已填 ${printed.length} 色共 ${printedTotal} 颗，${mismatched ? `${mismatched} 个对不上` : '全部对上'}`}
        </span>
        <div className="row">
          <button className="small glass" onClick={() => setBulk({ mode: 'recolour', a: live[0] ?? '', b: '' })}>
            整组改色
          </button>
          <button className="small glass" disabled={live.length < 2} onClick={() => setBulk({ mode: 'swap', a: live[0] ?? '', b: live[1] ?? '' })}>
            交换两组
          </button>
        </div>
      </div>

      {bulk && (
        <div className="sheet" onClick={() => setBulk(null)}>
          <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
            <h2>{bulk.mode === 'swap' ? '交换两组' : '整组改色'}</h2>
            <label className="field">
              <span>{bulk.mode === 'swap' ? '这一组' : '把这个色号的所有格子'}</span>
              <select value={bulk.a} onChange={(e) => setBulk({ ...bulk, a: e.target.value })}>
                {[...live].sort(codeOrder).map((c) => (
                  <option key={c} value={c}>
                    {c}（{counts.get(c) ?? 0} 颗）
                  </option>
                ))}
              </select>
            </label>
            {bulk.mode === 'swap' ? (
              <label className="field">
                <span>和这一组对调</span>
                <select value={bulk.b} onChange={(e) => setBulk({ ...bulk, b: e.target.value })}>
                  {[...live].sort(codeOrder).map((c) => (
                    <option key={c} value={c}>
                      {c}（{counts.get(c) ?? 0} 颗）
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>都改成</span>
                <input value={bulk.b} placeholder="色号，如 H2" onChange={(e) => setBulk({ ...bulk, b: e.target.value })} aria-label="改成的色号" />
              </label>
            )}
            {bulk.b && !(bulkTo in CATALOGUE) && <p className="sub bad">「{bulk.b}」不是 MARD 色号</p>}
            {bulkOk && (
              <p className="hint">
                {bulk.mode === 'swap'
                  ? `${bulk.a} 的 ${counts.get(bulk.a) ?? 0} 颗和 ${bulkTo} 的 ${counts.get(bulkTo) ?? 0} 颗互换色号。`
                  : `${bulk.a} 的 ${counts.get(bulk.a) ?? 0} 颗都改成 ${bulkTo}${live.includes(bulkTo) ? `，和原来的 ${bulkTo} 合成一组` : ''}。`}
              </p>
            )}
            <div className="row end">
              <button className="link" onClick={() => setBulk(null)}>
                取消
              </button>
              <button className="primary small" disabled={!bulkOk} onClick={applyBulk}>
                {bulk.mode === 'swap' ? '交换' : '改'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card codelist">
        <div className="coderow head">
          <span />
          <span>色号</span>
          <span className="num">识别</span>
          <span className="num">图例</span>
          <span />
        </div>
        {order
          .filter((i) => names[i])
          .map((i) => {
            const g = current[i]
            const code = names[i]
            const valid = code in CATALOGUE
            const n = counts.get(code) ?? 0
            const want = legend[code]
            const diff = want === undefined ? null : n - want
            return (
              <Fragment key={i}>
              <div className="coderow">
                {g ? <Label label={g.label} px={52} /> : <span className="nolabel">{rec.groups[i] ? '没有格子' : '手动添加'}</span>}
                <div className="codecell">
                  <span className="swatch" style={{ background: css(g?.colour ?? CATALOGUE[code] ?? GREY) }} />
                  <input
                    className={!valid ? 'codeinput bad' : dupes.has(code) ? 'codeinput warn' : 'codeinput'}
                    value={code}
                    onChange={(e) => rename(i, e.target.value)}
                    onBlur={resort}
                    aria-label="色号"
                  />
                  {!valid && <span className="sub bad">不是 MARD 色号</span>}
                  {valid && dupes.has(code) && <span className="sub">同名，已合并</span>}
                </div>
                <span className="num">{n}</span>
                <div className="wantcell">
                  <input
                    className="countinput"
                    inputMode="numeric"
                    placeholder="—"
                    value={want ?? ''}
                    onChange={(e) => setCount(code, e.target.value.replace(/\D/g, ''))}
                    aria-label={`${code} 图例颗数`}
                  />
                  {diff !== null && <span className={diff === 0 ? 'diff ok' : 'diff off'}>{diff === 0 ? '一致' : diff > 0 ? `多 ${diff}` : `少 ${-diff}`}</span>}
                </div>
                <span className="rowactions">
                  <button className="link" title="在这一行下面插入一个色号" aria-label={`在 ${code} 下面插入色号`} onClick={() => setInsertAt(i)}>
                    插入
                  </button>
                  <button
                    className="link del"
                    disabled={n > 0}
                    title={n > 0 ? '这个色号下还有格子：把它改成正确的色号即可并入，或到核对页把格子移走' : '删除这个色号'}
                    onClick={() => {
                      const next = { ...legend }
                      delete next[code]
                      onLegend(next)
                      onNames(names.map((v, k) => (k === i ? '' : v)))
                    }}
                  >
                    删除
                  </button>
                </span>
              </div>
              {insertAt === i && addRow}
              </Fragment>
            )
          })}
        {insertAt === null && addRow}
      </section>
      <p className="hint">
        "识别"是程序数出来的颗数，"图例"填图纸上印的颗数，两边对不上的会标出来，到核对页也会显示。程序漏掉的色号：点任意一行的"插入"加在它下面，或在最后一行新增，再到核对页把对应的格子改过去。还有格子的色号不能直接删：改成正确的色号就会并过去。
      </p>
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
  onAskCells: () => Promise<string>
}) {
  const { img, rec, names, assign, counts, legend, onAssign, onNames, onAskCells } = props
  const [ai] = useState<AiSettings>(loadAiSettings)
  const [checking, setChecking] = useState(false)
  const [checkNote, setCheckNote] = useState('')
  const doubtful = useMemo(() => doubtfulCells(rec, assign).length, [rec, assign])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [onlyUnsure, setOnlyUnsure] = useState(false)
  const LIMIT = 160
  // most empty cells are plain background: show the likeliest misses, the rest on request
  const BLANK_LIMIT = 48

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
  // codes whose count disagrees with the printed legend come first: that is where mistakes are
  const off = (code: string) => (legend[code] === undefined ? 0 : (counts.get(code) ?? 0) - legend[code])
  const mismatched = byCode.filter(([c]) => off(c) !== 0)
  const matched = byCode.filter(([c]) => off(c) === 0)

  // Cells judged empty, so a code hidden by a watermark can be spotted: cells with print in them
  // first, then those with beads on most sides, plain background last.
  const blanks = useMemo(() => {
    const { cols, rows, share } = rec.cells
    const around = (i: number) => {
      const x = i % cols
      const y = (i - x) / cols
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && assign[b * cols + a] >= 0).length
    }
    const list: number[] = []
    for (let i = 0; i < assign.length; i++) if (assign[i] < 0) list.push(i)
    const key = (i: number) => (share[i] > 0.06 ? 10 : 0) + around(i)
    return list.sort((a, b) => key(b) - key(a))
  }, [assign, rec])

  const codes = [...new Set(names.filter(Boolean))].sort(codeOrder)
  const toggle = (cell: number) => {
    const next = new Set(selected)
    if (!next.delete(cell)) next.add(cell)
    setSelected(next)
  }
  // a whole wall at once (as filtered): all of it chosen, or all of it let go if it already was
  const allChosen = (cells: number[]) => cells.length > 0 && cells.every((c) => selected.has(c))
  const toggleAll = (cells: number[]) => {
    const next = new Set(selected)
    if (allChosen(cells)) for (const c of cells) next.delete(c)
    else for (const c of cells) next.add(c)
    setSelected(next)
  }
  const unsureCells = useMemo(() => {
    const out: number[] = []
    assign.forEach((g, i) => {
      if (g >= 0 && rec.unsure[i]) out.push(i)
    })
    return out
  }, [assign, rec])
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
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const blankWall = () => {
        const shownBlanks = onlyUnsure ? blanks.filter((c) => rec.cells.share[c] > 0.06) : blanks
        if (!shownBlanks.length) return null
        const open = expanded.has('')
        return (
          <section id="wall-blank" className="card wall">
            <header>
              <span className="swatch blank" />
              <b>空格</b>
              <span className="sub">{blanks.length} 格，格子里有印字的排在最前；有色号的点一下改掉</span>
              <button className="link selectall" onClick={() => toggleAll(shownBlanks)}>
                {allChosen(shownBlanks) ? '取消全选' : `全选 ${shownBlanks.length}`}
              </button>
            </header>
            <Tiles img={img} rec={rec} cells={open ? shownBlanks : shownBlanks.slice(0, BLANK_LIMIT)} selected={selected} onPick={toggle} />
            {shownBlanks.length > BLANK_LIMIT && (
              <button className="link" onClick={() => setExpanded(new Set(open ? [...expanded].filter((c) => c !== '') : [...expanded, '']))}>
                {open ? '收起' : `显示全部 ${shownBlanks.length} 格`}
              </button>
            )}
          </section>
        )
        }
  const wall = ([code, all]: [string, number[]]) => {
        const cells = onlyUnsure ? all.filter((c) => rec.unsure[c]) : all
        if (!cells.length) return null
        const open = expanded.has(code)
        const shown = open ? cells : cells.slice(0, LIMIT)
        const want = legend[code]
        return (
          <section key={code} id={`wall-${code}`} className="card wall">
            <header>
              <span className="swatch" style={{ background: css(CATALOGUE[code] ?? GREY) }} />
              <b>{code}</b>
              <span className="sub">
                {counts.get(code)} 颗{want !== undefined && (want === counts.get(code) ? '，与图例一致' : `，图例 ${want}`)}
              </span>
              <button className="link selectall" onClick={() => toggleAll(cells)}>
                {allChosen(cells) ? '取消全选' : `全选 ${cells.length}`}
              </button>
            </header>
            <Tiles img={img} rec={rec} cells={shown} selected={selected} onPick={toggle} />
            {cells.length > LIMIT && (
              <button className="link" onClick={() => setExpanded(new Set(open ? [...expanded].filter((c) => c !== code) : [...expanded, code]))}>
                {open ? '收起' : `显示全部 ${cells.length} 格`}
              </button>
            )}
          </section>
        )
  }
  const first = selected.size ? [...selected][0] : null
  const customCode = custom.toUpperCase().trim()

  return (
    <div className="page">
      <p className="hint">每一面墙是被认成同一个色号的全部格子，直接从原图裁出来。混进去的错格子点一下改掉。橙色框是程序没把握的，排在最前面。</p>
      <div className="row">
        <label className="toggle">
          <input type="checkbox" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} /> 只看没把握的
        </label>
        {unsureCells.length > 0 && (
          <button className="link" onClick={() => toggleAll(unsureCells)}>
            {allChosen(unsureCells) ? '取消全选' : `全选没把握的 ${unsureCells.length} 格`}
          </button>
        )}
      </div>
      {ai.key && ai.model && doubtful > 0 && (
        <div className="row">
          <button
            className="link"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              setCheckNote('')
              try {
                setCheckNote(await onAskCells())
              } catch (e) {
                setCheckNote(e instanceof Error ? e.message : String(e))
              } finally {
                setChecking(false)
              }
            }}
          >
            {checking ? 'AI 核对中…' : `让 AI 核对没把握的 ${doubtful} 格`}
          </button>
          {checkNote && <span className="sub">{checkNote}</span>}
        </div>
      )}
      <nav className="codeindex" aria-label="色号目录">
        {mismatched.map(([c]) => (
          <button key={c} className="chip off" onClick={() => jump(`wall-${c}`)}>
            <span className="swatch" style={{ background: css(CATALOGUE[c] ?? GREY) }} />
            {c}
            <span className="diff off">{off(c) > 0 ? `多${off(c)}` : `少${-off(c)}`}</span>
          </button>
        ))}
        {blanks.length > 0 && (
          <button className="chip" onClick={() => jump('wall-blank')}>
            <span className="swatch blank" />
            空格
          </button>
        )}
        {matched.map(([c]) => (
          <button key={c} className="chip" onClick={() => jump(`wall-${c}`)}>
            <span className="swatch" style={{ background: css(CATALOGUE[c] ?? GREY) }} />
            {c}
          </button>
        ))}
      </nav>
      {mismatched.map(wall)}
      {blankWall()}
      {matched.map(wall)}
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

function ListPage(props: { counts: Map<string, number>; legend: Record<string, number>; onSave: () => void }) {
  const { counts, legend, onSave } = props
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
      <div className="row end">
        <button
          className="link"
          onClick={async () => {
            setCopied(await copyText(text))
          }}
        >
          {copied ? '已复制' : '复制清单'}
        </button>
        <button className="primary" onClick={onSave}>
          保存到图纸库
        </button>
      </div>
    </div>
  )
}
