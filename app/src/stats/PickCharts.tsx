import { useState } from 'react'
import { useBlobUrl } from '../shared'
import { type Chart, type Status, STATUS_LABEL } from '../store'

const beadsOf = (c: Chart) => Object.values(c.counts).reduce((a, b) => a + b, 0)

function PickRow({ chart, on, onToggle }: { chart: Chart; on: boolean; onToggle: () => void }) {
  const thumb = useBlobUrl(chart.thumb)
  return (
    <button className={on ? 'pickrow on' : 'pickrow'} aria-pressed={on} onClick={onToggle}>
      <span className="pick">{on ? '✓' : ''}</span>
      <span className="minithumb">{thumb && <img src={thumb} alt="" />}</span>
      <span className="meta">
        <b>{chart.title}</b>
        <span className="sub">
          {STATUS_LABEL[chart.status]} · {Object.keys(chart.counts).length} 色 · {beadsOf(chart)} 颗
        </span>
      </span>
    </button>
  )
}

/** Choosing the charts to estimate: any mix, or all of one status at once. */
export function PickCharts({ charts, initial, onDone, onClose }: { charts: Chart[]; initial: string[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(initial.filter((id) => charts.some((c) => c.id === id))))
  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }
  const all = (s: Status) => setPicked(new Set([...picked, ...charts.filter((c) => c.status === s).map((c) => c.id)]))
  const beads = charts.filter((c) => picked.has(c.id)).reduce((a, c) => a + beadsOf(c), 0)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
        <h2>选要拼的图纸</h2>
        <div className="row">
          <button className="chip" onClick={() => all('todo')}>
            加上全部未拼
          </button>
          <button className="chip" onClick={() => all('doing')}>
            加上全部在拼
          </button>
          {picked.size > 0 && (
            <button className="link" onClick={() => setPicked(new Set())}>
              清空
            </button>
          )}
        </div>
        <div className="picklist">
          {charts.map((c) => (
            <PickRow key={c.id} chart={c} on={picked.has(c.id)} onToggle={() => toggle(c.id)} />
          ))}
        </div>
        <div className="row end">
          <span className="sub">
            已选 {picked.size} 张 · {beads} 颗
          </span>
          <button className="link" onClick={onClose}>
            取消
          </button>
          <button className="primary small" disabled={!picked.size} onClick={() => onDone(charts.filter((c) => picked.has(c.id)).map((c) => c.id))}>
            算一算
          </button>
        </div>
      </div>
    </div>
  )
}
