import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { codeColour, codeOrder, copyText, ICONS } from '../shared'
import { type Chart, getStock, type Stock } from '../store'
import { bagsFor, grams } from './beads'

const bagText = (beads: number) =>
  bagsFor(beads)
    .map((b) => `${b.n > 1 ? `${b.n}×` : ''}${b.size}克`)
    .join(' + ')

/**
 * What a chosen set of charts takes, code by code, against the beads on hand: what runs short and
 * the bags that would cover it. Nothing is taken from the stock here.
 */
export function Usage({ charts, onClose }: { charts: Chart[]; onClose: () => void }) {
  const [stock, setStock] = useState<Stock | null>(null)
  const [onlyShort, setOnlyShort] = useState(false)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    getStock().then(setStock)
  }, [])

  const need: Record<string, number> = {}
  for (const c of charts) for (const [code, n] of Object.entries(c.counts)) need[code] = (need[code] ?? 0) + n
  const have = (c: string) => stock?.beads[c] ?? 0
  const short = (c: string) => Math.max(0, need[c] - have(c))
  const codes = Object.keys(need).sort(codeOrder)
  const shortCodes = codes.filter((c) => short(c) > 0)
  const shown = onlyShort ? shortCodes : codes
  const total = codes.reduce((a, c) => a + need[c], 0)

  const copyList = async () => {
    const list = shortCodes.map((c) => `${c} ${bagText(short(c))}（缺 ${short(c)} 颗）`).join('\n')
    setCopied((await copyText(list)) ? '已复制' : '复制失败，可以长按选中')
  }

  return (
    <div className="page">
      <div className="toolbar">
        <button className="circle glass" aria-label="返回图纸列表" onClick={onClose}>
          <Icon d={ICONS.back} size={20} />
        </button>
      </div>
      <header className="title flat">
        <h1>用量统计</h1>
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
          <b className={shortCodes.length ? 'bad' : undefined}>{shortCodes.length}</b>
          <span>色不够</span>
        </div>
      </section>

      <div className="row">
        <div className="segmented small" role="radiogroup" aria-label="筛选">
          <button role="radio" aria-checked={!onlyShort} aria-selected={!onlyShort} onClick={() => setOnlyShort(false)}>
            全部
          </button>
          <button role="radio" aria-checked={onlyShort} aria-selected={onlyShort} onClick={() => setOnlyShort(true)}>
            不够 {shortCodes.length}
          </button>
        </div>
        {shortCodes.length > 0 && (
          <button className="small glass" onClick={copyList}>
            复制购物清单
          </button>
        )}
        {copied && <span className="sub">{copied}</span>}
      </div>
      <p className="hint">按整张图纸算，和库存对比；这里只是算一算，不会动库存。"建议买"按 12 克 / 40 克两种袋子凑最少克数。</p>

      <section className="card stocklist">
        {shown.map((c) => {
          const lack = short(c)
          return (
            <div key={c} className="stockrow usagerow">
              <span className="swatch" style={{ background: codeColour(c) }} />
              <b>{c}</b>
              <span className="sub need">
                要 {need[c]} · 有 {have(c)}
              </span>
              <span className={lack ? 'num bad' : 'num sub'}>{lack ? `缺 ${lack} · 买 ${bagText(lack)}` : '够'}</span>
            </div>
          )
        })}
        {!shown.length && <p className="hint">都够啦。</p>}
      </section>
    </div>
  )
}
