import { useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, copyText, ICONS } from '../shared'
import type { Stock } from '../store'
import { BAGS, bagFor, PER_GRAM, STANDARD } from './beads'
import { type SortBy, SortHead } from './SortHead'

type Col = 'code' | 'left' | 'bag'
const QUICK = [0, 300, 500, 1000, 2000]

// the threshold and whether to look past the charts' codes, kept on this device
interface Prefs {
  threshold: number
  all: boolean
}
const PREFS_KEY = 'pindou.shopping'
function loadPrefs(): Prefs {
  try {
    return { threshold: 500, all: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { threshold: 500, all: false }
  }
}

/**
 * The shopping list: every code that would be left with fewer beads than the threshold once the
 * chosen charts are done, the bag that tops it back up (changeable, or none), copied as two
 * tab-separated columns that a spreadsheet splits into cells when pasted.
 */
export function Shopping({ stock, need, onClose }: { stock: Stock; need: Record<string, number>; onClose: () => void }) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [text, setText] = useState(String(prefs.threshold))
  // bags chosen by hand, by code; 0 for none
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [sort, setSort] = useState<SortBy<Col>>({ key: 'left', desc: false })
  const [copied, setCopied] = useState('')
  const setPrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      // private browsing: not remembered
    }
  }
  const setThreshold = (n: number) => {
    setText(String(n))
    setPrefs({ threshold: n })
  }

  const left = (c: string) => (stock.beads[c] ?? 0) - (need[c] ?? 0)
  const pool = prefs.all ? [...new Set([...STANDARD, ...Object.keys(stock.beads), ...Object.keys(need)])] : Object.keys(need)
  const bag = (c: string) => chosen[c] ?? bagFor(prefs.threshold - left(c))
  const value = { left, bag }
  const codes = pool
    .filter((c) => left(c) < prefs.threshold)
    .sort((a, b) => {
      const by = sort.key === 'code' ? codeOrder(a, b) : value[sort.key](a) - value[sort.key](b) || codeOrder(a, b)
      return sort.desc ? -by : by
    })
  const buying = codes.filter((c) => bag(c) > 0)
  const totalGrams = buying.reduce((a, c) => a + bag(c), 0)

  const copy = async () => {
    const tsv = ['色号\t克数', ...buying.map((c) => `${c}\t${bag(c)}`)].join('\n')
    setCopied((await copyText(tsv)) ? `已复制 ${buying.length} 行，可以直接粘贴进 Excel` : '复制失败了，换个浏览器试试')
  }

  return (
    <div className="page">
      <div className="toolbar">
        <button className="circle glass" aria-label="返回预计消耗" onClick={onClose}>
          <Icon d={ICONS.back} size={20} />
        </button>
        <button className="primary small" disabled={!buying.length} onClick={copy}>
          复制清单
        </button>
      </div>
      <header className="title flat">
        <h1>补豆清单</h1>
        <span className="sub">
          {buying.length} 色 · {totalGrams} 克
        </span>
      </header>
      {copied && <p className="hint">{copied}</p>}

      <section className="card form">
        <label className="field">
          <span>拼完这些图纸后，剩下不到多少颗就补</span>
          <input
            inputMode="numeric"
            value={text}
            onChange={(e) => {
              const t = e.target.value.replace(/\D/g, '')
              setText(t)
              setPrefs({ threshold: Number(t) || 0 })
            }}
            aria-label="补豆阈值（颗）"
          />
        </label>
        <div className="chips">
          {QUICK.map((n) => (
            <button key={n} className={prefs.threshold === n ? 'chip on' : 'chip'} onClick={() => setThreshold(n)}>
              {n === 0 ? '只补不够的' : `${n} 颗（${n / PER_GRAM} 克）`}
            </button>
          ))}
        </div>
        <label className="row">
          <input type="checkbox" checked={prefs.all} onChange={(e) => setPrefs({ all: e.target.checked })} />
          <span>这些图纸没用到的色号也一起看（库存低于阈值的也补）</span>
        </label>
      </section>

      {codes.length > 0 ? (
        <section className="card usetable shoptable" role="table" aria-label="补豆清单">
          <div className="userow head" role="row">
            <SortHead k="code" label="色号" sort={sort} onSort={setSort} first="asc" />
            <SortHead k="left" label="剩余" sort={sort} onSort={setSort} first="asc" />
            <SortHead k="bag" label="补豆" sort={sort} onSort={setSort} />
          </div>
          {codes.map((c) => (
            <div key={c} className={bag(c) ? 'userow' : 'userow off'} role="row">
              <span className="code">
                <span className="swatch" style={{ background: codeColour(c) }} />
                <b>{c}</b>
              </span>
              <span className={left(c) < 0 ? 'num bad' : 'num'}>{left(c)}</span>
              <select className="bagselect" value={bag(c)} onChange={(e) => setChosen({ ...chosen, [c]: Number(e.target.value) })} aria-label={`${c} 补多少`}>
                <option value={0}>不买</option>
                {BAGS.map((g) => (
                  <option key={g} value={g}>
                    {g} 克
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>
      ) : (
        <p className="hint">没有低于 {prefs.threshold} 颗的色号，暂时不用补～</p>
      )}
      <p className="hint">
        剩余 = 库存 − 这些图纸的消耗，单位是颗。补豆默认选能补回阈值的最小一档，可以自己改。复制出来是「色号 Tab 克数」两列，粘贴进 Excel、Numbers 或 Google 表格会自动分成两列。
      </p>
    </div>
  )
}
