import { findBoard, findGrid } from '../src/engine/grid'
import { loadSample, SAMPLES } from './load'

for (const key of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) {
  const img = loadSample(key)
  const t = Date.now()
  const g = findGrid(img)
  const b = findBoard(img, g)
  console.log(key, `pitch ${g.perX.toFixed(2)}/${g.perY.toFixed(2)} off ${g.offX.toFixed(2)}/${g.offY.toFixed(2)}`, JSON.stringify(b), `${Date.now() - t}ms`)
}
