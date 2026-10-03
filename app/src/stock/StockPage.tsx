import { useEffect, useMemo, useState } from 'react'
import { ColourCard } from '../edit/ColourCard'
import { CODES } from '../engine/glyphs'
import { codeColour, codeOrder } from '../shared'
import { type Chart, changeStock, getStock, type Stock, undoStock } from '../store'

/** the standard 221-colour set (A to H, M) plus the clear L1 */
const STANDARD = CODES.filter((c) => /^[A-HM]\d+$/.test(c) || c === 'L1').sort(codeOrder)
const series = (code: string) => /^[A-Z]+/.exec(code)?.[0] ?? ''
const LOW = 200 // fewer beads than this, with none needed, is still worth a glance
const KIND: Record<string, string> = { restock: '补货', used: '拼完扣除', returned: '加回', set: '改数' }

type Filter = 'all' | 'short' | 'have'

/**
 * Beads on hand, by code and series; what the unfinished charts still need and where that runs
 * short; restocking several codes at once; a record of every change, the newest undoable.
 */
export function StockPage({ charts }: { charts: Chart[] | null }) {
  const [stock, setStock] = useState<Stock | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ code: string; text: string } | null>(null)
  const [restock, setRestock] = useState<{ code: string; n: string }[] | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    getStock().then(setStock)
  }, [])

  // beads still to place: unfinished charts, less the codes already ticked off while beading
  const need = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of charts ?? []) {
      if (c.status === 'done') continue
      const done = new Set(c.status === 'doing' ? (c.progress?.done ?? []) : [])
      for (const [code, n] of Object.entries(c.counts)) if (!done.has(code)) m[code] = (m[code] ?? 0) + n
    }
    return m
  }, [charts])

  if (!stock) return <div className="page" />
  const have = (c: string) => stock.beads[c] ?? 0
  const short = (c: string) => Math.max(0, (need[c] ?? 0) - have(c))
  const codes = [...new Set([...STANDARD, ...Object.keys(stock.beads), ...Object.keys(need)])].sort(codeOrder)
  const q = query.toUpperCase().trim()
  const shown = codes.filter((c) => (!q || c.startsWith(q)) && (filter === 'all' || (filter === 'short' ? short(c) > 0 : have(c) > 0)))
  const groups = new Map<string, string[]>()
  for (const c of shown) {
    const s = series(c)
    if (!groups.has(s)) groups.set(s, [])
    groups.get(s)!.push(c)
  }
  const shortCodes = codes.filter((c) => short(c) > 0)
  const total = Object.values(stock.beads).reduce((a, b) => a + b, 0)
  const last = stock.log[0]

  const setCount = async (code: string, text: string) => {
    setEditing(null)
    const n = Math.max(0, Math.round(Number(text)))
    if (!Number.isFinite(n) || n === have(code)) return
    setStock(await changeStock({ kind: 'set', note: `${code} 改为 ${n}`, delta: { [code]: n - have(code) } }))
  }
  const saveRestock = async () => {
    if (!restock) return
    const delta: Record<string, number> = {}
    for (const l of restock) {
      const n = Math.round(Number(l.n))
      if (l.code && Number.isFinite(n) && n > 0) delta[l.code] = (delta[l.code] ?? 0) + n
    }
    if (Object.keys(delta).length) setStock(await changeStock({ kind: 'restock', note: '补货', delta }))
    setRestock(null)
  }

  return (
    <div className="page">
      <header className="title flat">
        <h1>库存</h1>
      </header>

      <section className="card stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div>
          <b>{Object.values(stock.beads).filter((n) => n > 0).length}</b>
          <span>色有库存</span>
        </div>
        <div>
          <b>{total}</b>
          <span>颗</span>
        </div>
        <div>
          <b className={shortCodes.length ? 'bad' : undefined}>{shortCodes.length}</b>
          <span>色不够拼</span>
        </div>
      </section>

      <div className="row">
        <button className="primary small" onClick={() => setRestock([{ code: '', n: '' }])}>
          补货
        </button>
        {last && (
          <button
            className="link"
            onClick={async () => {
              if (window.confirm(`撤销「${KIND[last.kind]} · ${last.note}」？`)) setStock(await undoStock())
            }}
          >
            撤销上一条（{KIND[last.kind]}）
          </button>
        )}
      </div>

      <input className="search" placeholder="搜索色号" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜索色号" />
      <div className="segmented small" role="radiogroup" aria-label="筛选">
        {(
          [
            ['all', '全部'],
            ['short', `不够 ${shortCodes.length}`],
            ['have', '有货'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button key={f} role="radio" aria-checked={filter === f} aria-selected={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <p className="hint">"还要"是未拼和在拼的图纸还没拼的颗数（在拼的图纸里已经勾掉的颜色不算）。点库存数字可以直接改。</p>

      {[...groups].map(([s, list]) => (
        <section key={s} className="card stocklist">
          <span className="sub">{s === 'L' ? 'L1 透明' : `${s} 系列`}</span>
          {list.map((c) => {
            const n = have(c)
            const lack = short(c)
            return (
              <div key={c} className="stockrow">
                <span className="swatch" style={{ background: codeColour(c) }} />
                <b>{c}</b>
                <span className={`sub need${lack ? ' bad' : ''}`}>{need[c] ? (lack ? `还要 ${need[c]}，缺 ${lack}` : `还要 ${need[c]}`) : n > 0 && n < LOW ? '快用完了' : ''}</span>
                {editing?.code === c ? (
                  <input
                    className="countinput"
                    inputMode="numeric"
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ code: c, text: e.target.value.replace(/\D/g, '') })}
                    onBlur={() => setCount(c, editing.text)}
                    onKeyDown={(e) => e.key === 'Enter' && setCount(c, editing.text)}
                    aria-label={`${c} 库存`}
                  />
                ) : (
                  <button className="num link" onClick={() => setEditing({ code: c, text: String(n) })} aria-label={`改 ${c} 库存`}>
                    {n}
                  </button>
                )}
              </div>
            )
          })}
        </section>
      ))}
      {!shown.length && <p className="hint">没有符合的色号。</p>}

      <section className="card stocklog">
        <button className="link" onClick={() => setShowLog(!showLog)}>
          {showLog ? '收起记录' : `库存记录（${stock.log.length}）`}
        </button>
        {showLog &&
          stock.log.slice(0, 50).map((e) => {
            const sum = Object.values(e.delta).reduce((a, b) => a + b, 0)
            return (
              <div key={e.at} className="line">
                <span className="sub">{new Date(e.at).toLocaleString()}</span>
                <b>{KIND[e.kind]}</b>
                <span className="sub">{e.note}</span>
                <span className="num">
                  {sum > 0 ? '+' : ''}
                  {sum}
                </span>
              </div>
            )
          })}
      </section>

      {restock && (
        <div className="sheet" onClick={() => setRestock(null)}>
          <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
            <h2>补货</h2>
            {restock.map((l, k) => (
              <div key={k} className="restockline">
                <button className="chip" onClick={() => setPicking(k)}>
                  {l.code ? (
                    <>
                      <span className="swatch" style={{ background: codeColour(l.code) }} />
                      {l.code}
                    </>
                  ) : (
                    '选色号'
                  )}
                </button>
                <input
                  className="countinput"
                  inputMode="numeric"
                  placeholder="颗数"
                  value={l.n}
                  onChange={(e) => setRestock(restock.map((x, i) => (i === k ? { ...x, n: e.target.value.replace(/\D/g, '') } : x)))}
                  aria-label="补货颗数"
                />
                {[500, 1000].map((d) => (
                  <button key={d} className="link" onClick={() => setRestock(restock.map((x, i) => (i === k ? { ...x, n: String((Number(x.n) || 0) + d) } : x)))}>
                    +{d}
                  </button>
                ))}
              </div>
            ))}
            <button className="link" onClick={() => setRestock([...restock, { code: '', n: '' }])}>
              ＋ 再加一个色号
            </button>
            <div className="row end">
              <button className="link" onClick={() => setRestock(null)}>
                取消
              </button>
              <button className="primary small" disabled={!restock.some((l) => l.code && Number(l.n) > 0)} onClick={saveRestock}>
                记入库存
              </button>
            </div>
          </div>
        </div>
      )}
      {restock && picking !== null && (
        <ColourCard
          title="补哪个色号"
          value={restock[picking]?.code}
          onPick={(c) => {
            setRestock(restock.map((x, i) => (i === picking ? { ...x, code: c } : x)))
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
