import { useEffect, useRef, useState } from 'react'
import './App.css'
import { type AiProvider, type AiSettings, checkAi, listVisionModels, loadAiSettings, type ModelInfo, PROVIDERS, saveAiSettings } from './ai'
import { BeadMode } from './bead/BeadMode'
import { Editor } from './edit/Editor'
import { StatsPage } from './stats/StatsPage'
import { FONTS, type Font, fontFor, loadFont, loadSkin, saveFont, saveSkin, type Skin, SKINS } from './skin'
import { statusPatch } from './status'
import { StockPage } from './stock/StockPage'
import { Usage } from './stock/Usage'
import { Flow } from './flow/Flow'
import { Icon } from './Icon'
import { codeColour, codeOrder, drawBoard, ICONS, useBlobUrl } from './shared'
import { type Chart, deleteChart, exportBackup, getStock, importBackup, listCharts, persist, putChart, type Status, STATUS_LABEL, type Stock } from './store'

type Tab = 'charts' | 'stock' | 'stats' | 'settings'
const TABS: [Tab, string][] = [
  ['charts', '图纸'],
  ['stock', '库存'],
  ['stats', '统计'],
  ['settings', '设置'],
]

export default function App() {
  const [tab, setTabState] = useState<Tab>('charts')
  const [charts, setCharts] = useState<Chart[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // the recognition flow: a new chart (null) or a saved one being corrected
  const [flow, setFlow] = useState<{ chart?: Chart } | null>(null)
  const [beading, setBeading] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // charts chosen for 用量统计
  const [usage, setUsage] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState('')

  const setTab = (t: Tab) => {
    setTabState(t)
    setOpenId(null)
    window.scrollTo(0, 0)
  }
  const reload = () =>
    listCharts()
      .then(setCharts)
      .catch((e) => setLoadError(`读取图纸库失败：${e instanceof Error ? e.message : String(e)}`))

  useEffect(() => {
    reload()
    persist()
  }, [])

  if (flow) {
    const existingTags = [...new Set((charts ?? []).flatMap((c) => c.tags))].sort()
    return (
      <Flow
        chart={flow.chart}
        existingTags={existingTags}
        onClose={() => {
          setFlow(null)
          window.scrollTo(0, 0)
        }}
        onSaved={async (id) => {
          await reload()
          setFlow(null)
          setTabState('charts')
          setOpenId(id)
          window.scrollTo(0, 0)
        }}
      />
    )
  }

  const opened = charts?.find((c) => c.id === openId)
  const editChart = charts?.find((c) => c.id === editing)
  if (editChart) {
    return (
      <Editor
        chart={editChart}
        onClose={() => {
          setEditing(null)
          window.scrollTo(0, 0)
        }}
        onSave={async (c) => {
          await putChart(c)
          await reload()
        }}
      />
    )
  }
  const beadChart = charts?.find((c) => c.id === beading)
  if (beadChart) {
    return (
      <BeadMode
        chart={beadChart}
        onClose={() => {
          setBeading(null)
          window.scrollTo(0, 0)
        }}
        onChange={async (c) => {
          await putChart(c)
          await reload()
        }}
      />
    )
  }
  const usageCharts = usage && charts?.filter((c) => usage.includes(c.id))
  if (usageCharts?.length) {
    return (
      <div className="app">
        <main>
          <Usage
            charts={usageCharts}
            onClose={() => {
              setUsage(null)
              window.scrollTo(0, 0)
            }}
          />
        </main>
      </div>
    )
  }
  return (
    <div className="app">
      <main>
        {tab === 'charts' &&
          (opened ? (
            <ChartDetail
              chart={opened}
              onBack={() => setOpenId(null)}
              onEdit={() => setFlow({ chart: opened })}
              onBead={() => setBeading(opened.id)}
              onDraw={() => setEditing(opened.id)}
              onChange={async (c) => {
                await putChart(c)
                await reload()
              }}
              onDelete={async () => {
                await deleteChart(opened.id)
                setOpenId(null)
                await reload()
              }}
            />
          ) : (
<Library charts={charts} error={loadError} onOpen={(id) => setOpenId(id)} onNew={() => setFlow({})} />
          ))}
        {tab === 'stock' && <StockPage />}
        {tab === 'stats' && (
          <StatsPage
            charts={charts}
            onUsage={(ids) => {
              setUsage(ids)
              window.scrollTo(0, 0)
            }}
            onOpen={(id) => {
              setTabState('charts')
              setOpenId(id)
              window.scrollTo(0, 0)
            }}
          />
        )}
        {tab === 'settings' && <SettingsPage onRestored={reload} count={charts?.length ?? 0} />}
      </main>
      <div className="dock">
        <nav className="tabbar glass" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              <Icon d={ICONS[t]} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="fab glass" aria-label="识别新图纸" onClick={() => setFlow({})}>
          <Icon d={ICONS.plus} size={28} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ library

type Filter = 'all' | Status

function Library({ charts, error, onOpen, onNew }: { charts: Chart[] | null; error: string; onOpen: (id: string) => void; onNew: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const all = charts ?? []
  const tags = [...new Set(all.flatMap((c) => c.tags))].sort()
  const q = query.trim()
  const codeQuery = codeSearch(q)
  // the codes of a chart a code search found in it, with their beads
  const hitsOf = (c: Chart) => (codeQuery ? Object.entries(c.counts).filter(([code]) => codeQuery(code)) : [])
  const shown = all.filter(
    (c) => (filter === 'all' || c.status === filter) && (!tag || c.tags.includes(tag)) && (!q || c.title.toLowerCase().includes(q.toLowerCase()) || hitsOf(c).length > 0),
  )
  const count = (s: Status) => all.filter((c) => c.status === s).length

  return (
    <div className="page">
      <header className="title flat">
        <h1>图纸</h1>
        <span className="sub">{all.length} 张</span>
      </header>
      {error && <p className="error">{error}</p>}
      {all.length > 0 && (
        <>
          <input className="search" type="search" placeholder="搜索名称或色号，如 P、H2" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜索图纸" />
          <div className="segmented" role="tablist" aria-label="按状态筛选">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
              全部
            </button>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)}>
                {STATUS_LABEL[s]} {count(s)}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="chips" aria-label="按标签筛选">
              {tags.map((t) => (
                <button key={t} className={tag === t ? 'chip on' : 'chip'} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {charts && all.length === 0 && (
        <section className="card empty">
          <b>还没有图纸</b>
          <p className="hint">点右下角的＋识别第一张，保存后会出现在这里。</p>
          <button className="primary small" onClick={onNew}>
            识别新图纸
          </button>
        </section>
      )}
      {all.length > 0 && shown.length === 0 && <p className="hint">没有符合条件的图纸。</p>}
      <div className="grid">
        {shown.map((c) => (
          <ChartCard key={c.id} chart={c} hits={hitsOf(c)} onOpen={() => onOpen(c.id)} />
        ))}
      </div>
    </div>
  )
}

/**
 * A search for codes: a whole code ("H2", "p01") finds that code, a series alone ("P") every code of
 * it. Null when the text is not shaped like either (then it is only a name).
 */
function codeSearch(text: string): ((code: string) => boolean) | null {
  const m = /^([A-Za-z]{1,2})0*(\d*)$/.exec(text)
  if (!m) return null
  const series = m[1].toUpperCase()
  const code = series + m[2]
  return m[2] ? (c) => c === code : (c) => /^[A-Z]+/.exec(c)?.[0] === series
}

function ChartCard({ chart, hits = [], onOpen }: { chart: Chart; hits?: [string, number][]; onOpen: () => void }) {
  const thumb = useBlobUrl(chart.thumb)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [brokenThumb, setBrokenThumb] = useState('')
  useEffect(() => {
    if (!canvas.current) return
    drawBoard(canvas.current, chart.cols, chart.rows, chart.cells, 320)
  }, [chart.cols, chart.rows, chart.cells, thumb, brokenThumb])
  return (
    <button className="chartcard" onClick={onOpen}>
      <span className="thumb">
        {thumb && brokenThumb !== thumb ? <img src={thumb} alt="" onError={() => setBrokenThumb(thumb)} /> : <canvas ref={canvas} aria-label="图纸像素预览" />}
      </span>
      <span className="meta">
        <b>{chart.title}</b>
        <span className="sub">
          {chart.cols}×{chart.rows} · {Object.keys(chart.counts).length} 色
        </span>
        {hits.length > 0 && (
          <span className="sub hits">
            含 {hits
              .sort((a, b) => codeOrder(a[0], b[0]))
              .map(([code, n]) => `${code} ${n} 颗`)
              .join('、')}
          </span>
        )}
      </span>
      <span className={`status ${chart.status}`}>{STATUS_LABEL[chart.status]}</span>
    </button>
  )
}

/** when a change is saved */
const stamp = () => Date.now()

function ChartDetail(props: { chart: Chart; onBack: () => void; onEdit: () => void; onBead: () => void; onDraw: () => void; onChange: (c: Chart) => Promise<void>; onDelete: () => Promise<void> }) {
  const { chart, onBack, onEdit, onBead, onDraw, onChange, onDelete } = props
  const board = useRef<HTMLCanvasElement>(null)
  const original = useBlobUrl(chart.image)
  const [view, setView] = useState<'board' | 'original'>('board')
  const [title, setTitle] = useState(chart.title)
  const [tagText, setTagText] = useState('')
  const [stock, setStock] = useState<Stock | null>(null)
  useEffect(() => {
    getStock().then(setStock)
  }, [chart])

  useEffect(() => {
    if (board.current) drawBoard(board.current, chart.cols, chart.rows, chart.cells, 1200)
  }, [chart, view])

  function update(patch: Partial<Chart>) {
    return onChange({ ...chart, ...patch, updatedAt: stamp() })
  }
  const setStatus = async (status: Status) => {
    if (status !== chart.status) await update(await statusPatch(chart, status))
  }
  const rows = Object.entries(chart.counts).sort((a, b) => codeOrder(a[0], b[0]))
  const total = rows.reduce((a, [, n]) => a + n, 0)

  return (
    <div className="page">
      <div className="toolbar">
        <button className="circle glass" aria-label="返回图纸列表" onClick={onBack}>
          <Icon d={ICONS.back} size={20} />
        </button>
        <div className="row">
          {chart.source !== 'pixel' && (
            <button className="small glass" onClick={onEdit} aria-label="修改识别结果">
              改识别
            </button>
          )}
          <button className="small glass" onClick={onDraw} aria-label="编辑图纸">
            编辑
          </button>
          <button className="primary small" onClick={onBead}>
            {chart.progress ? '继续拼豆' : '开始拼豆'}
          </button>
        </div>
      </div>
      <input
        className="titleinput"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title.trim() !== chart.title && update({ title: title.trim() })}
        aria-label="图纸名称"
      />
      {chart.sourceUrl && (
        <a className="chartsource sub" href={chart.sourceUrl} target="_blank" rel="noreferrer">
          来源链接：{chart.sourceUrl}
        </a>
      )}
      <div className="segmented" role="radiogroup" aria-label="状态">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <button key={s} role="radio" aria-checked={chart.status === s} aria-selected={chart.status === s} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="chips">
        {chart.tags.map((t) => (
          <span key={t} className="chip on">
            {t}
            <button className="chipx" aria-label={`去掉标签 ${t}`} onClick={() => update({ tags: chart.tags.filter((x) => x !== t) })}>
              ×
            </button>
          </span>
        ))}
        <form
          className="chipadd"
          onSubmit={(e) => {
            e.preventDefault()
            const t = tagText.trim()
            if (t && !chart.tags.includes(t)) update({ tags: [...chart.tags, t] })
            setTagText('')
          }}
        >
          <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="＋ 标签" aria-label="添加标签" />
        </form>
      </div>

      <section className="card preview">
        <div className="segmented small" role="tablist">
          <button role="tab" aria-selected={view === 'board'} onClick={() => setView('board')}>
            识别结果
          </button>
          <button role="tab" aria-selected={view === 'original'} onClick={() => setView('original')}>
            原图
          </button>
        </div>
        {view === 'board' ? <canvas ref={board} className="boardview" /> : <img src={original} alt="原图" className="boardview" />}
      </section>

      <section className="card list">
        <div className="line head">
          <span className="sub">
            {chart.cols}×{chart.rows} · {rows.length} 色 · {total} 颗
          </span>
        </div>
        {rows.map(([code, n]) => (
          <div key={code} className="line">
            <span className="swatch" style={{ background: codeColour(code) }} />
            <b>{code}</b>
            {stock && chart.status !== 'done' && (
              <span className={(stock.beads[code] ?? 0) < n ? 'sub bad' : 'sub'}>
                {(stock.beads[code] ?? 0) < n ? `库存 ${stock.beads[code] ?? 0}，缺 ${n - (stock.beads[code] ?? 0)}` : `库存 ${stock.beads[code]}`}
              </span>
            )}
            <span className="num">{n}</span>
          </div>
        ))}
      </section>
      <button
        className="link danger"
        onClick={() => {
          if (window.confirm(`删除「${chart.title}」？删除后不能恢复。`)) onDelete()
        }}
      >
        删除这张图纸
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ stock

function SettingsPage({ onRestored, count }: { onRestored: () => Promise<void>; count: number }) {
  const [skin, setSkin] = useState<Skin>(loadSkin)
  const [font, setFont] = useState<Font>(loadFont)
  const [note, setNote] = useState('')
  const [kept, setKept] = useState<boolean | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    persist().then(setKept)
  }, [])

  return (
    <div className="page">
      <header className="title flat">
        <h1>设置</h1>
      </header>

      <h2 className="sectiontitle">外观</h2>
      <section className="card form">
        <div className="segmented full" role="radiogroup" aria-label="外观">
          {SKINS.map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={skin === k}
              aria-selected={skin === k}
              onClick={() => {
                setSkin(k)
                saveSkin(k)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field">
          <span>字体</span>
          <div className="segmented full" role="radiogroup" aria-label="字体">
            {FONTS.map(([k, label]) => (
              <button
                key={k}
                role="radio"
                aria-checked={font === k}
                aria-selected={font === k}
                onClick={() => {
                  setFont(k)
                  saveFont(k)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {fontFor(skin, font) === 'typewriter' && <p className="hint">英文和数字使用打字机字体，中文使用系统字体；打字机字体从 jsDelivr 下载，没网时先用系统字体。</p>}
      </section>

      <h2 className="sectiontitle">AI 读图例</h2>
      <AiSection />

      <h2 className="sectiontitle">数据</h2>
      <section className="card form">
        <p className="hint">
          图纸库存在这台设备的浏览器里，共 {count} 张。
          {kept === false && '浏览器没有答应长期保留这些数据：没装到主屏幕的网站，Safari 可能在 7 天没打开后清掉它们，记得定期导出备份。'}
          {kept === true && '浏览器已答应长期保留这些数据。'}
        </p>
        <div className="row">
          <button
            className="primary small"
            onClick={async () => {
              setNote('正在导出…')
              try {
                const blob = await exportBackup()
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                const d = new Date()
                a.download = `拼豆图纸备份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
                a.click()
                setTimeout(() => URL.revokeObjectURL(a.href), 10000)
                setNote(`已导出 ${count} 张图纸`)
              } catch (e) {
                setNote(`导出失败：${e instanceof Error ? e.message : String(e)}`)
              }
            }}
          >
            导出备份
          </button>
          <button className="link" onClick={() => file.current?.click()}>
            从备份恢复
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setNote('正在恢复…')
              try {
                const r = await importBackup(f)
                await onRestored()
                setNote(`恢复完成：新增 ${r.added} 张，更新 ${r.updated} 张，跳过 ${r.skipped} 张（这里的版本更新）`)
              } catch (err) {
                setNote(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
              }
            }}
          />
        </div>
        {note && <p className="hint">{note}</p>}
      </section>

      <h2 className="sectiontitle">关于</h2>
      <section className="card form">
        <p className="hint">
          源代码：
          <a className="link" href="https://github.com/Emma-Zhuym/pindou" target="_blank" rel="noreferrer">
            github.com/Emma-Zhuym/pindou
          </a>
          （AGPL-3.0）。MARD 色卡数据来自{' '}
          <a className="link" href="https://github.com/Zippland/perler-beads" target="_blank" rel="noreferrer">
            Zippland/perler-beads
          </a>
          （AGPL-3.0）。屏幕上的颜色只是近似，以实物豆子为准。
        </p>
      </section>
    </div>
  )
}

/** the services in the order offered: the two that work in China without a VPN first */
const PROVIDER_ORDER: AiProvider[] = ['bailian', 'siliconflow', 'openrouter']
/** how to get a key, a step a line */
const KEY_STEPS: Record<AiProvider, string[]> = {
  bailian: ['用阿里云账号登录（没有就用支付宝或手机号注册），按提示开通百炼、做实名认证', '右上角地域选「华北2（北京）」，点「创建 API Key」，其余用默认', '复制 Key，粘到下面'],
  siliconflow: ['用手机号登录', '点「新建 API 密钥」，复制', '粘到下面；如果提示要实名或充值，跟着页面来，读一张图例大约一两分钱'],
  openrouter: ['要能上外网；注册登录后点「Create Key」，复制', '粘到下面，点「验证 Key 并获取模型」，选一个模型', '不充值只能用名字带 free 的模型；充值只收外币卡'],
}

/**
 * The vision model that reads legends: which service, its key, its model. Each service keeps its
 * own key, so trying another one loses nothing. Nothing is needed to use the app: without a key
 * the legend is typed in by hand.
 */
function AiSection() {
  const [ai, setAi] = useState<AiSettings>(() => loadAiSettings())
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const p = PROVIDERS[ai.provider]
  const change = (next: AiSettings) => {
    setAi(next)
    setNote(null)
  }
  const save = (next = ai) => {
    saveAiSettings(next)
    setNote({ text: '已保存' })
  }
  return (
    <section className="card form">
      <p className="hint">不设置也能用：识别时对着图例填色号和颗数。设置后 AI 替你读图例，只发图例那一小块截图，格子还是在手机上算。</p>
      <div className="segmented full" role="radiogroup" aria-label="AI 服务">
        {PROVIDER_ORDER.map((k) => (
          <button key={k} role="radio" aria-checked={ai.provider === k} aria-selected={ai.provider === k} onClick={() => change(loadAiSettings(k))}>
            {PROVIDERS[k].name}
          </button>
        ))}
      </div>
      <ol className="hint keysteps">
        <li>
          打开{' '}
          <a className="link" href={p.keyPage} target="_blank" rel="noreferrer">
            {p.name} 的 Key 页面
          </a>
        </li>
        {KEY_STEPS[ai.provider].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <label className="field">
        <span>{p.name} API Key</span>
        <input type="password" autoComplete="off" value={ai.key} onChange={(e) => change({ ...ai, key: e.target.value })} />
      </label>
      {ai.provider === 'openrouter' ? (
        <ModelPicker
          apiKey={ai.key}
          model={ai.model}
          onModel={(model) => {
            // picked from the checked list: save right away, key included
            const next = { ...ai, model }
            setAi(next)
            save(next)
          }}
        />
      ) : (
        <label className="field">
          <span>模型（一般不用改）</span>
          <input autoComplete="off" autoCapitalize="off" spellCheck={false} value={ai.model} placeholder={p.model} onChange={(e) => change({ ...ai, model: e.target.value.trim() })} />
        </label>
      )}
      <div className="row end">
        {note && <span className={note.bad ? 'sub bad grow' : 'sub grow'}>{note.text}</span>}
        {ai.provider !== 'openrouter' && (
          <button
            className="link"
            disabled={!ai.key.trim() || busy}
            onClick={async () => {
              setBusy(true)
              const a = { ...ai, model: ai.model || p.model }
              try {
                setNote({ text: `${await checkAi(a)}，已保存` })
                setAi(a)
                saveAiSettings(a)
              } catch (e) {
                setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '检查中…' : '检查'}
          </button>
        )}
        <button className="primary small" onClick={() => save()}>
          保存
        </button>
      </div>
      <p className="hint">
        Key 只存在这台设备的浏览器里，换手机要重新粘。别把 Key 发给别人或截图发帖。
        {ai.provider !== 'openrouter' && `${p.name}的服务器在国内，人在海外用会慢一些。`}
      </p>
    </section>
  )
}

/** After the key is entered: check it and pick one of the image-reading models from a list. */
function ModelPicker({ apiKey, model, onModel }: { apiKey: string; model: string; onModel: (m: string) => void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      setModels(await listVisionModels(apiKey))
    } catch (e) {
      setModels(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const shown = (models ?? []).filter((m) => !filter.trim() || `${m.name} ${m.id}`.toLowerCase().includes(filter.trim().toLowerCase()))
  // the model this app was tried with: cheap, reads small print well
  const recommended = models?.find((m) => /gemini-3[\w.-]*flash-preview$/.test(m.id))
  const unknown = !!models && !!model && !models.some((m) => m.id === model)
  const price = (p?: number) => (p === undefined ? '' : p === 0 ? '免费' : `$${p < 1 ? p.toFixed(2) : p.toFixed(1)}/百万`)
  return (
    <div className="field">
      <span>模型</span>
      <div className="row">
        <span className="sub grow">{model ? `当前：${model}` : '还没选'}</span>
        <button className="link" disabled={!apiKey.trim() || busy} onClick={refresh}>
          {busy ? '获取中…' : models ? '刷新模型' : '验证 Key 并获取模型'}
        </button>
      </div>
      {error && <span className="sub bad">{error}</span>}
      {models && (
        <>
          <span className="sub">Key 可用。下面是能看图的模型，按价格从低到高。</span>
          {unknown && <span className="sub bad">现在填的「{model}」不是模型 ID，请从下面选一个。</span>}
          {recommended && recommended.id !== model && (
            <button className="link" onClick={() => onModel(recommended.id)}>
              用推荐的 {recommended.name}
            </button>
          )}
          <input placeholder="搜索，如 gemini flash" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="搜索模型" />
          <select size={Math.min(8, Math.max(2, shown.length))} value={model} onChange={(e) => onModel(e.target.value)} aria-label="选择模型">
            {shown.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.inputPrice !== undefined ? `（${price(m.inputPrice)}）` : ''}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
