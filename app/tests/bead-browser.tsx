import { createRoot } from 'react-dom/client'
import { BeadMode } from '../src/bead/BeadMode'
import '../src/App.css'

const cols = 20
const rows = 30
const cells = Array.from({ length: cols * rows }, (_, i) => (i % 7 === 0 ? 'A1' : i % 3 === 0 ? 'F10' : 'B11'))
const chart = {
  id: 'bead-fixture',
  title: '豆板固定辅助线测试',
  status: 'doing' as const,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  image: new Blob(),
  thumb: new Blob(),
  cols,
  rows,
  cells,
  counts: { A1: cells.filter((c) => c === 'A1').length, B11: cells.filter((c) => c === 'B11').length, F10: cells.filter((c) => c === 'F10').length },
  legend: {},
  legendRect: null,
  edit: { engine: 2, names: [], assign: [] },
  progress: { done: [], seconds: 0 },
}

createRoot(document.getElementById('root')!).render(<BeadMode chart={chart} onClose={() => {}} onChange={async () => {}} />)
