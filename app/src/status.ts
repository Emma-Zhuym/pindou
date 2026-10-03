// Changing a chart's status, from its page or from beading: marking it done takes its beads out of
// the stock (once, if wanted) and ticks every code off; undoing that can put the beads back.
import { type Chart, changeStock, type Status } from './store'

/** What to change on the chart, after asking about the stock; the stock itself is changed here. */
export async function statusPatch(chart: Chart, status: Status): Promise<Partial<Chart>> {
  const patch: Partial<Chart> = { status, doneAt: status === 'done' ? Date.now() : undefined }
  const beads = Object.values(chart.counts).reduce((a, b) => a + b, 0)
  if (status === 'done') {
    if (chart.progress) patch.progress = { ...chart.progress, done: Object.keys(chart.counts) }
    if (!chart.stockTaken && window.confirm(`拼完啦！从库存里扣掉这张图用的 ${beads} 颗豆子吗？`)) {
      await changeStock({ kind: 'used', note: chart.title, chartId: chart.id, delta: Object.fromEntries(Object.entries(chart.counts).map(([c, n]) => [c, -n])) })
      patch.stockTaken = true
    }
  } else if (chart.stockTaken && window.confirm('这张图拼完时扣过库存，要把豆子加回库存吗？')) {
    await changeStock({ kind: 'returned', note: chart.title, chartId: chart.id, delta: chart.counts })
    patch.stockTaken = false
  }
  return patch
}
