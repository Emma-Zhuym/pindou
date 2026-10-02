import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import type { Raster } from '../src/engine/grid'

export const SAMPLES = {
  tree: 'tree-52x64.jpg',
  dog: 'dog-104x104.jpg',
  landscape: 'landscape-84x84.jpg',
  portrait: 'portrait-50x70.jpg',
} as const

export function loadSample(key: keyof typeof SAMPLES): Raster {
  const path = fileURLToPath(new URL(`../../samples/${SAMPLES[key]}`, import.meta.url))
  const img = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 })
  return { width: img.width, height: img.height, data: img.data }
}
