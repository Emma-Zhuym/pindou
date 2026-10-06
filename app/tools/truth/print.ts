// Print features and clustering for the truth tools (the app's own is src/engine/printClasses.ts).
import { INK } from '../../src/engine/cells'

const S = 24 // feature side
const M = Number(process.env.MARGIN ?? 7) // ink this close to the cell edge is grid line or edge mark, not print
/** print features: the ink inside the margin, centred on its centre of mass, resampled to S x S, unit length */
export function features(ink: Uint8Array, cells: number[]): Float32Array {
  const D = S * S
  const out = new Float32Array(cells.length * D)
  const W = INK - 2 * M
  cells.forEach((i, k) => {
    const b = i * INK * INK
    // centre of the print: mass of the ink above the cell's own median, inside the margin
    const vals: number[] = []
    for (let y = M; y < INK - M; y++) for (let x = M; x < INK - M; x++) vals.push(ink[b + y * INK + x])
    vals.sort((p, q) => p - q)
    const floor = vals[vals.length >> 1]
    let m = 0, mx = 0, my = 0
    for (let y = M; y < INK - M; y++) for (let x = M; x < INK - M; x++) { const v = Math.max(0, ink[b + y * INK + x] - floor); m += v; mx += v * x; my += v * y }
    const cx = m ? mx / m : INK / 2, cy = m ? my / m : INK / 2
    const o = k * D
    const at = (x: number, y: number) => (x < M || y < M || x >= INK - M || y >= INK - M ? floor : ink[b + y * INK + x])
    for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
      const sx = cx - W / 2 + ((u + 0.5) * W) / S - 0.5, sy = cy - W / 2 + ((v + 0.5) * W) / S - 0.5
      const xi = Math.floor(sx), yi = Math.floor(sy), fx = sx - xi, fy = sy - yi
      out[o + v * S + u] = (at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx) * (1 - fy) + (at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx) * fy
    }
    let mm = 0; for (let j = 0; j < D; j++) mm += out[o + j]; mm /= D
    let n = 0; for (let j = 0; j < D; j++) { out[o + j] -= mm; n += out[o + j] ** 2 }
    n = Math.sqrt(n) + 1e-6; for (let j = 0; j < D; j++) out[o + j] /= n
  })
  return out
}
export function centre(X: Float32Array, n: number) {
  const D = X.length / n
  const mu = new Float32Array(D)
  for (let j = 0; j < n; j++) for (let d = 0; d < D; d++) mu[d] += X[j * D + d] / n
  for (let j = 0; j < n; j++) { let q = 0; for (let d = 0; d < D; d++) { X[j * D + d] -= mu[d]; q += X[j * D + d] ** 2 } q = Math.sqrt(q) + 1e-6; for (let d = 0; d < D; d++) X[j * D + d] /= q }
}
/** merge clusters whose mean prints are alike, most alike first; then each cell to its nearest */
export function mergeClusters(X: Float32Array, n: number, lab0: Int32Array, k: number, tau: number) {
  const D = X.length / n
  const lab = Int32Array.from(lab0)
  const sum = new Float64Array(k * D); const cnt = new Array(k).fill(0)
  for (let i = 0; i < n; i++) { cnt[lab[i]]++; for (let d = 0; d < D; d++) sum[lab[i] * D + d] += X[i * D + d] }
  const alive = cnt.map((c) => c > 0)
  const cos = (a: number, b: number) => { let t = 0, na = 0, nb = 0; for (let d = 0; d < D; d++) { t += sum[a * D + d] * sum[b * D + d]; na += sum[a * D + d] ** 2; nb += sum[b * D + d] ** 2 } return t / (Math.sqrt(na * nb) + 1e-9) }
  for (;;) {
    let ba = -1, bb = -1, bs = tau
    for (let a = 0; a < k; a++) if (alive[a]) for (let b = a + 1; b < k; b++) if (alive[b]) { const s = cos(a, b); if (s > bs) { bs = s; ba = a; bb = b } }
    if (ba < 0) break
    for (let d = 0; d < D; d++) sum[ba * D + d] += sum[bb * D + d]
    cnt[ba] += cnt[bb]; alive[bb] = false
    for (let i = 0; i < n; i++) if (lab[i] === bb) lab[i] = ba
  }
  const ids = alive.map((a, c) => (a ? c : -1)).filter((c) => c >= 0)
  const C = new Float32Array(ids.length * D)
  ids.forEach((c, q) => { let nn = 0; for (let d = 0; d < D; d++) nn += sum[c * D + d] ** 2; nn = Math.sqrt(nn) + 1e-9; for (let d = 0; d < D; d++) C[q * D + d] = sum[c * D + d] / nn })
  const out = new Int32Array(n); const sim = new Float32Array(n)
  for (let i = 0; i < n; i++) { let b = 0, bs = -2; for (let q = 0; q < ids.length; q++) { let t = 0; for (let d = 0; d < D; d++) t += X[i * D + d] * C[q * D + d]; if (t > bs) { bs = t; b = q } } out[i] = b; sim[i] = bs }
  return { lab: out, sim, k: ids.length, C }
}
export function kmeans(X: Float32Array, n: number, k: number, iters = 25, seed = 1) {
  const D = X.length / n
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const C = new Float32Array(k * D)
  const dot = (a: Float32Array, ao: number, b: Float32Array, bo: number) => { let t = 0; for (let j = 0; j < D; j++) t += a[ao + j] * b[bo + j]; return t }
  // k-means++ (cosine distance 1-dot)
  const first = Math.floor(rnd() * n)
  C.set(X.subarray(first * D, first * D + D), 0)
  const dmin = new Float32Array(n).fill(Infinity)
  for (let c = 1; c < k; c++) {
    let tot = 0
    for (let i = 0; i < n; i++) { const d = Math.max(0, 1 - dot(X, i * D, C, (c - 1) * D)); if (d < dmin[i]) dmin[i] = d; tot += dmin[i] ** 2 }
    let r = rnd() * tot, pick = 0
    for (let i = 0; i < n; i++) { r -= dmin[i] ** 2; if (r <= 0) { pick = i; break } }
    C.set(X.subarray(pick * D, pick * D + D), c * D)
  }
  const lab = new Int32Array(n)
  const sim = new Float32Array(n)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { let b = 0, bs = -2; for (let c = 0; c < k; c++) { const v = dot(X, i * D, C, c * D); if (v > bs) { bs = v; b = c } } lab[i] = b; sim[i] = bs }
    C.fill(0)
    const cnt = new Array(k).fill(0)
    for (let i = 0; i < n; i++) { cnt[lab[i]]++; for (let j = 0; j < D; j++) C[lab[i] * D + j] += X[i * D + j] }
    for (let c = 0; c < k; c++) { let nn = 0; for (let j = 0; j < D; j++) nn += C[c * D + j] ** 2; nn = Math.sqrt(nn) + 1e-6; for (let j = 0; j < D; j++) C[c * D + j] /= nn }
  }
  return { lab, sim, C }
}
