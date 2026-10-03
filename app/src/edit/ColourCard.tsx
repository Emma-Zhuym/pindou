import { useMemo, useState } from 'react'
import { inkOn } from '../bead/paint'
import { CATALOGUE, CODES } from '../engine/glyphs'
import { codeColour, codeOrder } from '../shared'

// the clear L1 sits with H, the blacks, whites and greys
const series = (code: string) => (code === 'L1' ? 'H' : (/^[A-Z]+/.exec(code)?.[0] ?? ''))
/** the standard 221-colour set (A to H, M) plus the clear L1: what a box of MARD beads holds */
const STANDARD = (code: string) => /^[A-HM]\d+$/.test(code) || code === 'L1'
const ORDERED = [...CODES].sort(codeOrder)

/** sRGB to CIE Lab (D65), where distance follows what the eye sees. */
function lab(code: string): [number, number, number] {
  const { r, g, b } = CATALOGUE[code]
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** How different two catalogue colours look (CIE76 distance in Lab). */
function difference(a: string, b: string): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/**
 * The MARD colour card: every code as a bead swatch, by series, the ones closest to `near` first,
 * searchable. Screen colours only approximate the real beads.
 */
export function ColourCard({ title, near, value, onPick, onClose }: { title: string; near?: string; value?: string; onPick: (code: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const shown = (c: string) => all || STANDARD(c)
  const q = query.toUpperCase().trim()
  const similar = useMemo(
    () =>
      near && near in CATALOGUE
        ? ORDERED.filter((c) => c !== near && shown(c))
            .map((c) => [c, difference(near, c)] as const)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 12)
            .map(([c]) => c)
        : [],
    [near, all], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of ORDERED) {
      if ((q && !c.startsWith(q)) || !shown(c)) continue
      const s = series(c)
      if (!m.has(s)) m.set(s, [])
      m.get(s)!.push(c)
    }
    return [...m]
  }, [q, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const swatch = (c: string) => (
    <button key={c} className={`bead-swatch${c === value ? ' on' : ''}`} style={{ background: codeColour(c), color: inkOn(c) }} onClick={() => onPick(c)} title={c}>
      {c}
    </button>
  )
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetbody wide colourcard" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>
            关闭
          </button>
        </div>
        <input className="search" placeholder="搜索色号，如 B1 或 H" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜索色号" />
        <div className="segmented small" role="radiogroup" aria-label="色号范围">
          <button role="radio" aria-checked={!all} aria-selected={!all} onClick={() => setAll(false)}>
            221 色 + L1
          </button>
          <button role="radio" aria-checked={all} aria-selected={all} onClick={() => setAll(true)}>
            全部 MARD
          </button>
        </div>
        {similar.length > 0 && !q && (
          <section>
            <span className="sub">和 {near} 相近</span>
            <div className="swatchgrid">{similar.map(swatch)}</div>
          </section>
        )}
        {groups.map(([s, codes]) => (
          <section key={s}>
            <span className="sub">{s === 'H' ? 'H 系列（含 L1 透明）' : `${s} 系列`}</span>
            <div className="swatchgrid">{codes.map(swatch)}</div>
          </section>
        ))}
        <p className="hint">色卡颜色是屏幕上的近似值，和实物豆子会有些差别。</p>
      </div>
    </div>
  )
}
