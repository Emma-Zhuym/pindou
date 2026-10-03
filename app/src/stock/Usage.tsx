import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, ICONS } from '../shared'
import { type Chart, getStock, type Stock } from '../store'
import { grams } from './beads'
import { Shopping } from './Shopping'
import { type SortBy, SortHead } from './SortHead'

type Col = 'code' | 'need' | 'have' | 'left'

/**
 * What a chosen set of charts takes, code by code, against the beads on hand and what would be
 * left, as a table sortable by any column; the shopping list for what runs low is a page of its
 * own. Nothing is taken from the stock here.
 */
export function Usage({ charts, onClose }: { charts: Chart[]; onClose: () => void }) {
  const [stock, setStock] = useState<Stock | null>(null)
  const [sort, setSort] = useState<SortBy<Col>>({ key: 'need', desc: true })
  const [shopping, setShopping] = useState(false)
  useEffect(() => {
    getStock().then(setStock)
  }, [])

  const need: Record<string, number> = {}
  for (const c of charts) for (const [code, n] of Object.entries(c.counts)) need[code] = (need[code] ?? 0) + n
  const have = (c: string) => stock?.beads[c] ?? 0
  const left = (c: string) => have(c) - (need[c] ?? 0)
  const value = { need: (c: string) => need[c], have, left }
  const codes = Object.keys(need).sort((a, b) => {
    const by = sort.key === 'code' ? codeOrder(a, b) : value[sort.key](a) - value[sort.key](b) || codeOrder(a, b)
    return sort.desc ? -by : by
  })
  const short = codes.filter((c) => left(c) < 0)
  const total = codes.reduce((a, c) => a + need[c], 0)

  if (shopping && stock) return <Shopping stock={stock} need={need} onClose={() => setShopping(false)} />

  return (
    <div className="page">
      <div className="toolbar">
        <button className="circle glass" aria-label="返回统计" onClick={onClose}>
          <Icon d={ICONS.back} size={20} />
        </button>
        <button className="primary small" onClick={() => setShopping(true)}>
          补豆清单
        </button>
      </div>
      <header className="title flat">
        <h1>预计消耗</h1>
        <span className="sub">{charts.length} 张图纸</span>
      </header>
      <div className="chips">
        {charts.map((c) => (
          <span key={c.id} className="chip">
            {c.title}
          </span>
        ))}
      </div>

      <section className="card stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div>
          <b>{codes.length}</b>
          <span>色</span>
        </div>
        <div>
          <b>{total}</b>
          <span>颗（约 {grams(total)}）</span>
        </div>
        <div>
          <b className={short.length ? 'bad' : undefined}>{short.length}</b>
          <span>色不够</span>
        </div>
      </section>

      <section className="card usetable" role="table" aria-label="预计消耗">
        <div className="userow head" role="row">
          <SortHead k="code" label="色号" sort={sort} onSort={setSort} first="asc" />
          <SortHead k="need" label="消耗" sort={sort} onSort={setSort} />
          <SortHead k="have" label="库存" sort={sort} onSort={setSort} />
          <SortHead k="left" label="预计剩余" sort={sort} onSort={setSort} first="asc" />
        </div>
        {codes.map((c) => (
          <div key={c} className="userow" role="row">
            <span className="code">
              <span className="swatch" style={{ background: codeColour(c) }} />
              <b>{c}</b>
            </span>
            <span className="num">{need[c]}</span>
            <span className="num">{have(c)}</span>
            <span className={left(c) < 0 ? 'num bad' : 'num'}>{left(c)}</span>
          </div>
        ))}
      </section>
      <p className="hint">单位都是颗。点表头排序，再点一次反过来。预计剩余 = 库存 − 消耗，按整张图纸算，只是算一算，不动库存。</p>
    </div>
  )
}
