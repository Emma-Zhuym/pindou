import { createRoot } from 'react-dom/client'
import { Editor } from '../src/edit/Editor'
import '../src/App.css'
import '../src/skin-paper.css'
import '../src/skin-sketch.css'
import '../src/fonts.css'

document.documentElement.dataset.skin = 'sketch'
document.documentElement.dataset.font = 'pixel'

const cols = 20
const rows = 30
// ?blanks: a red square and a green one on an empty chart, for the lasso
const blanks = new URLSearchParams(location.search).has('blanks')
const cells = Array.from({ length: cols * rows }, (_, i) => {
  const x = i % cols
  const y = Math.floor(i / cols)
  if (blanks) return x >= 2 && x < 7 && y >= 2 && y < 7 ? 'F10' : x >= 9 && x < 14 && y >= 4 && y < 9 ? 'B11' : ''
  return i % 7 === 0 ? 'A1' : i % 3 === 0 ? 'F10' : 'B11'
})
const chart = {
  id: 'editor-fixture',
  title: '芒果鸳鸯',
  status: 'doing' as const,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  image: new Blob(),
  thumb: new Blob(),
  cols,
  rows,
  cells,
  // recognised as all B11 in the first row: the edits since then can be compared and undone
  original: cells.map((c, i) => (i < cols ? 'B11' : c)),
  counts: { A1: cells.filter((c) => c === 'A1').length, B11: cells.filter((c) => c === 'B11').length, F10: cells.filter((c) => c === 'F10').length },
  legend: {},
  legendRect: null,
  edit: { engine: 2, names: [], assign: [] },
}

createRoot(document.getElementById('root')!).render(<Editor chart={chart} onClose={() => {}} onSave={async () => {}} />)
