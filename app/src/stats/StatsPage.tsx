import { useEffect, useState } from 'react'
import { codeColour } from '../shared'
import { type Chart, getStock, type Stock } from '../store'
import { grams } from '../stock/beads'

type Range = 'all' | 'year' | 'month'
const RANGES: [Range, string][] = [
  ['all', '全部'],
  ['year', '今年'],
  ['month', '近 30 天'],
]
const TOP = 12
const MONTHS = 12
const DAY = 86400000

const beadsOf = (c: Chart) => Object.values(c.counts).reduce((a, b) => a + b, 0)
const seconds = (c: Chart) => c.progress?.seconds ?? 0
/** "3 小时 20 分", "45 分" */
function duration(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} 小时${m ? ` ${m} 分` : ''}` : `${m} 分`
}
const monthKey = (t: number) => {
  const d = new Date(t)
  return d.getFullYear() * 12 + d.getMonth()
}

/**
 * How the beading has gone: charts by status, what was finished in a span of time (beads, hours,
 * speed), month by month, the codes used most, the charts under way and a few records. Charts
 * finished before their finishing time was kept count from the stock deduction or their last change.
 */
export function StatsPage({ charts, onOpen }: { charts: Chart[] | null; onOpen: (id: string) => void }) {
  const [range, setRange] = useState<Range>('all')
  const [stock, setStock] = useState<Stock | null>(null)
  useEffect(() => {
    getStock().then(setStock)
  }, [])
  // the current time, read once on opening
  const [now] = useState(() => Date.now())

  const all = charts ?? []
  const count = (s: Chart['status']) => all.filter((c) => c.status === s).length
  const usedAt = new Map((stock?.log ?? []).filter((e) => e.kind === 'used' && e.chartId).map((e) => [e.chartId!, e.at]))
  const doneAt = (c: Chart) => c.doneAt ?? usedAt.get(c.id) ?? c.updatedAt
  const since = range === 'all' ? 0 : range === 'year' ? new Date(new Date(now).getFullYear(), 0, 1).getTime() : now - 30 * DAY
  const done = all.filter((c) => c.status === 'done' && doneAt(c) >= since)
  const beads = done.reduce((a, c) => a + beadsOf(c), 0)
  const timed = done.filter((c) => seconds(c) >= 60)
  const time = timed.reduce((a, c) => a + seconds(c), 0)
  const speed = time ? Math.round((timed.reduce((a, c) => a + beadsOf(c), 0) / time) * 3600) : 0

  // the last twelve months, oldest first
  const thisMonth = monthKey(now)
  const months = Array.from({ length: MONTHS }, (_, i) => ({ key: thisMonth - MONTHS + 1 + i, charts: 0, beads: 0 }))
  for (const c of all) {
    if (c.status !== 'done') continue
    const m = months.find((x) => x.key === monthKey(doneAt(c)))
    if (m) {
      m.charts++
      m.beads += beadsOf(c)
    }
  }
  const monthMax = Math.max(1, ...months.map((m) => m.beads))

  const used: Record<string, number> = {}
  for (const c of done) for (const [code, n] of Object.entries(c.counts)) used[code] = (used[code] ?? 0) + n
  const top = Object.entries(used)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)

  const doing = all.filter((c) => c.status === 'doing')
  const progress = (c: Chart) => {
    const ticked = new Set(c.progress?.done ?? [])
    const total = beadsOf(c)
    return total ? Object.entries(c.counts).reduce((a, [code, n]) => a + (ticked.has(code) ? n : 0), 0) / total : 0
  }

  const biggest = [...done].sort((a, b) => beadsOf(b) - beadsOf(a))[0]
  const longest = [...timed].sort((a, b) => seconds(b) - seconds(a))[0]
  const fastest = timed.filter((c) => seconds(c) >= 600).sort((a, b) => beadsOf(b) / seconds(b) - beadsOf(a) / seconds(a))[0]

  return (
    <div className="page">
      <header className="title flat">
        <h1>统计</h1>
      </header>

      <section className="card stats">
        <div>
          <b>{all.length}</b>
          <span>图纸</span>
        </div>
        <div>
          <b>{count('todo')}</b>
          <span>未拼</span>
        </div>
        <div>
          <b>{count('doing')}</b>
          <span>在拼</span>
        </div>
        <div>
          <b>{count('done')}</b>
          <span>已拼</span>
        </div>
      </section>

      <h2 className="sectiontitle">拼完的</h2>
      <div className="segmented full" role="radiogroup" aria-label="时间范围">
        {RANGES.map(([r, label]) => (
          <button key={r} role="radio" aria-checked={range === r} aria-selected={range === r} onClick={() => setRange(r)}>
            {label}
          </button>
        ))}
      </div>
      <section className="card stats">
        <div>
          <b>{done.length}</b>
          <span>张</span>
        </div>
        <div>
          <b>{beads}</b>
          <span>颗（{grams(beads)}）</span>
        </div>
        <div>
          <b>{time ? (time / 3600).toFixed(1) : '–'}</b>
          <span>小时</span>
        </div>
        <div>
          <b>{speed || '–'}</b>
          <span>颗 / 小时</span>
        </div>
      </section>
      {!done.length && <p className="hint">{count('done') ? '这段时间里还没有拼完的图纸。' : '把图纸标成"已拼"后，这里会算拼了多少颗、花了多久。'}</p>}
      {done.length > 0 && timed.length < done.length && <p className="hint">用时只算拼豆时开过计时的图纸（{timed.length} 张）。</p>}

      {top.length > 0 && (
        <section className="card topcodes">
          <span className="sub">用得最多的色号</span>
          {top.map(([code, n]) => (
            <div key={code} className="barrow">
              <span className="swatch" style={{ background: codeColour(code) }} />
              <b>{code}</b>
              <span className="bar">
                <span style={{ width: `${(n / top[0][1]) * 100}%`, background: codeColour(code) }} />
              </span>
              <span className="num sub">
                {n}（{Math.round((n / beads) * 100)}%）
              </span>
            </div>
          ))}
        </section>
      )}

      {count('done') > 0 && (
      <section className="card monthly">
        <span className="sub">近 12 个月每月拼完</span>
        <div className="months">
          {months.map((m) => (
            <div key={m.key} className="month" title={`${Math.floor(m.key / 12)} 年 ${(m.key % 12) + 1} 月：${m.charts} 张，${m.beads} 颗`}>
              <span className="count">{m.charts || ''}</span>
              <span className="col" style={{ height: `${(m.beads / monthMax) * 100}%` }} />
              <span className="label">{(m.key % 12) + 1}月</span>
            </div>
          ))}
        </div>
        <span className="sub">柱子高度是颗数，上面的数字是张数。</span>
      </section>
      )}

      {doing.length > 0 && (
        <>
          <h2 className="sectiontitle">在拼</h2>
          <section className="card doinglist">
            {doing.map((c) => {
              const p = progress(c)
              return (
                <button key={c.id} className="doingrow" onClick={() => onOpen(c.id)}>
                  <b>{c.title}</b>
                  <span className="bar">
                    <span style={{ width: `${p * 100}%` }} />
                  </span>
                  <span className="sub">
                    {Math.round(p * 100)}%{seconds(c) >= 60 ? ` · 已拼 ${duration(seconds(c))}` : ''}
                  </span>
                </button>
              )
            })}
            <span className="sub">进度按拼豆时勾掉的色号算。</span>
          </section>
        </>
      )}

      {biggest && (
        <>
          <h2 className="sectiontitle">记录</h2>
          <section className="card records">
            <button onClick={() => onOpen(biggest.id)}>
              <span className="sub">最大的一张</span>
              <b>{biggest.title}</b>
              <span className="sub">
                {beadsOf(biggest)} 颗 · {biggest.cols}×{biggest.rows}
              </span>
            </button>
            {longest && (
              <button onClick={() => onOpen(longest.id)}>
                <span className="sub">用时最长</span>
                <b>{longest.title}</b>
                <span className="sub">{duration(seconds(longest))}</span>
              </button>
            )}
            {fastest && (
              <button onClick={() => onOpen(fastest.id)}>
                <span className="sub">拼得最快</span>
                <b>{fastest.title}</b>
                <span className="sub">{Math.round((beadsOf(fastest) / seconds(fastest)) * 3600)} 颗 / 小时</span>
              </button>
            )}
          </section>
        </>
      )}
    </div>
  )
}
