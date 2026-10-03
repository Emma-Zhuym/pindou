import { useEffect, useState } from 'react'
import { codeColour, codeOrder } from '../shared'
import { changeStock, getStock, type Stock, undoStock } from '../store'
import { grams, STANDARD } from './beads'
import { Restock } from './Restock'

const series = (code: string) => /^[A-Z]+/.exec(code)?.[0] ?? ''
const LOW = 300 // under 3 grams left
const KIND: Record<string, string> = { restock: '补货', used: '拼完扣除', returned: '加回', set: '改数' }

type Filter = 'all' | 'have' | 'low' | 'none'
const FILTERS: [Filter, string][] = [
  ['all', '全部'],
  ['have', '有货'],
  ['low', '快用完'],
  ['none', '没有'],
]

/**
 * Beads on hand, by code and series: only what is in the jars. Beads leave it when a chart is
 * marked done; what charts would need is counted separately (用量统计 in the library).
 */
export function StockPage() {
  const [stock, setStock] = useState<Stock | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ code: string; text: string } | null>(null)
  const [restocking, setRestocking] = useState(false)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    getStock().then(setStock)
  }, [])

  if (!stock) return <div className="page" />
  const have = (c: string) => stock.beads[c] ?? 0
  const low = (c: string) => have(c) > 0 && have(c) < LOW
  const codes = [...new Set([...STANDARD, ...Object.keys(stock.beads)])].sort(codeOrder)
  const q = query.toUpperCase().trim()
  const pass = (c: string) => (filter === 'all' ? true : filter === 'have' ? have(c) > 0 : filter === 'low' ? low(c) : have(c) === 0)
  const shown = codes.filter((c) => (!q || c.startsWith(q)) && pass(c))
  const groups = new Map<string, string[]>()
  for (const c of shown) {
    const s = series(c)
    if (!groups.has(s)) groups.set(s, [])
    groups.get(s)!.push(c)
  }
  const total = Object.values(stock.beads).reduce((a, b) => a + b, 0)
  const last = stock.log[0]

  const setCount = async (code: string, text: string) => {
    setEditing(null)
    const n = Math.max(0, Math.round(Number(text)))
    if (!Number.isFinite(n) || n === have(code)) return
    setStock(await changeStock({ kind: 'set', note: `${code} 改为 ${n}`, delta: { [code]: n - have(code) } }))
  }

  return (
    <div className="page">
      <header className="title flat">
        <h1>库存</h1>
      </header>

      <section className="card stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div>
          <b>{codes.filter((c) => have(c) > 0).length}</b>
          <span>色有货</span>
        </div>
        <div>
          <b>{grams(total).replace(' 克', '')}</b>
          <span>克（约 {total} 颗）</span>
        </div>
        <div>
          <b className={codes.some(low) ? 'bad' : undefined}>{codes.filter(low).length}</b>
          <span>色不到 3 克</span>
        </div>
      </section>

      <div className="row">
        <button className="primary small" onClick={() => setRestocking(true)}>
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
      <div className="segmented full" role="radiogroup" aria-label="筛选">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="radio" aria-checked={filter === f} aria-selected={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <p className="hint">只记罐子里现有的豆子。图纸标成"已拼"时才会扣掉。点颗数可以直接改。</p>

      {[...groups].map(([s, list]) => (
        <section key={s} className="card stocklist">
          <span className="sub">{s === 'L' ? 'L1 透明' : `${s} 系列`}</span>
          {list.map((c) => {
            const n = have(c)
            return (
              <div key={c} className="stockrow">
                <span className="swatch" style={{ background: codeColour(c) }} />
                <b>{c}</b>
                <span className={`sub need${low(c) ? ' bad' : ''}`}>{n > 0 ? grams(n) : '没有'}</span>
                {editing?.code === c ? (
                  <input
                    className="countinput"
                    inputMode="numeric"
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ code: c, text: e.target.value.replace(/\D/g, '') })}
                    onBlur={() => setCount(c, editing.text)}
                    onKeyDown={(e) => e.key === 'Enter' && setCount(c, editing.text)}
                    aria-label={`${c} 库存颗数`}
                  />
                ) : (
                  <button className={n ? 'num link' : 'num link zero'} onClick={() => setEditing({ code: c, text: String(n) })} aria-label={`改 ${c} 库存`}>
                    {n} 颗
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

      {restocking && (
        <Restock
          onClose={() => setRestocking(false)}
          onSave={async (delta, note) => {
            setStock(await changeStock({ kind: 'restock', note, delta }))
            setRestocking(false)
          }}
        />
      )}
    </div>
  )
}
