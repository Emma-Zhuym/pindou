import { useRef, useState } from 'react'
import { ColourCard } from '../edit/ColourCard'
import { codeColour } from '../shared'
import { BAGS, grams, looksLikeGrams, PER_GRAM, readTable, SET_221 } from './beads'

type Mode = 'codes' | 'set' | 'table'
const MODES: [Mode, string][] = [
  ['codes', '按色号'],
  ['set', '整套'],
  ['table', '表格导入'],
]

/** Restocking: some codes by the gram, a whole set at one bag size, or a table of codes and amounts. */
export function Restock({ onClose, onSave }: { onClose: () => void; onSave: (delta: Record<string, number>, note: string) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('codes')
  const [saving, setSaving] = useState(false)
  // by code: grams on each line
  const [lines, setLines] = useState<{ code: string; g: string }[]>([{ code: '', g: '' }])
  const [picking, setPicking] = useState<number | null>(null)
  // a whole set
  const [bag, setBag] = useState(BAGS[0])
  const [bags, setBags] = useState(1)
  const [withL1, setWithL1] = useState(false)
  // a table
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [unit, setUnit] = useState<'beads' | 'grams'>('beads')
  // the unit follows the table ("克" in its header, "12g") until chosen by hand
  const [unitChosen, setUnitChosen] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  let delta: Record<string, number> = {}
  let note = '补货'
  let skipped: string[] = []
  if (mode === 'codes') {
    for (const l of lines) {
      const n = Math.round(Number(l.g) * PER_GRAM)
      if (l.code && n > 0) delta[l.code] = (delta[l.code] ?? 0) + n
    }
  } else if (mode === 'set') {
    for (const c of [...SET_221, ...(withL1 ? ['L1'] : [])]) delta[c] = bag * bags * PER_GRAM
    note = `整套 ${SET_221.length} 色${withL1 ? ' + L1' : ''} · 每色 ${bags > 1 ? `${bags}×` : ''}${bag} 克`
  } else {
    const read = readTable(text, unit)
    delta = read.beads
    skipped = read.skipped
    note = fileName ? `表格导入 ${fileName}` : '表格导入'
  }
  const codes = Object.keys(delta)
  const total = Object.values(delta).reduce((a, b) => a + b, 0)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(delta, note)
    } finally {
      setSaving(false)
    }
  }
  const load = async (f: File) => {
    const t = await f.text()
    setText(t)
    setFileName(f.name)
    if (!unitChosen) setUnit(looksLikeGrams(t) ? 'grams' : 'beads')
  }

  return (
    <>
    <div className="sheet" onClick={onClose}>
      <div className="sheetbody form" onClick={(e) => e.stopPropagation()}>
        <h2>补货</h2>
        <div className="segmented full" role="radiogroup" aria-label="补货方式">
          {MODES.map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} aria-selected={mode === m} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'codes' && (
          <>
            {lines.map((l, k) => (
              <div key={k} className="restockline">
                <button className="chip" onClick={() => setPicking(k)}>
                  {l.code ? (
                    <>
                      <span className="swatch" style={{ background: codeColour(l.code) }} />
                      {l.code}
                    </>
                  ) : (
                    '选色号'
                  )}
                </button>
                <input
                  className="countinput"
                  inputMode="decimal"
                  placeholder="克"
                  value={l.g}
                  onChange={(e) => setLines(lines.map((x, i) => (i === k ? { ...x, g: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                  aria-label="补货克数"
                />
                <span className="sub">克</span>
                {BAGS.map((b) => (
                  <button key={b} className="link" onClick={() => setLines(lines.map((x, i) => (i === k ? { ...x, g: String((Number(x.g) || 0) + b) } : x)))}>
                    +{b}克
                  </button>
                ))}
              </div>
            ))}
            <button className="link" onClick={() => setLines([...lines, { code: '', g: '' }])}>
              ＋ 再加一个色号
            </button>
            <p className="hint">1 克约 {PER_GRAM} 颗，库存里按颗记。</p>
          </>
        )}

        {mode === 'set' && (
          <>
            <p className="hint">
              标准 {SET_221.length} 色（A–H、M）每色补同样的量。
            </p>
            <div className="segmented full" role="radiogroup" aria-label="每色克数">
              {BAGS.map((b) => (
                <button key={b} role="radio" aria-checked={bag === b} aria-selected={bag === b} onClick={() => setBag(b)}>
                  每色 {b} 克
                </button>
              ))}
            </div>
            <div className="row">
              <span className="sub">每色几袋</span>
              <button className="small glass" disabled={bags <= 1} onClick={() => setBags(bags - 1)} aria-label="少一袋">
                −
              </button>
              <b>{bags}</b>
              <button className="small glass" onClick={() => setBags(bags + 1)} aria-label="多一袋">
                ＋
              </button>
            </div>
            <label className="row">
              <input type="checkbox" checked={withL1} onChange={(e) => setWithL1(e.target.checked)} />
              <span>L1 透明也补同样的量</span>
            </label>
          </>
        )}

        {mode === 'table' && (
          <>
            <p className="hint">每行一个色号和数量，比如「A1,1200」。Excel 或 Numbers 里另存为 CSV 再选，也可以直接粘贴两列。</p>
            <div className="row">
              <button className="small glass" onClick={() => file.current?.click()}>
                选 CSV 文件
              </button>
              {fileName && <span className="sub">{fileName}</span>}
            </div>
            <input ref={file} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            <textarea
              className="tablepaste"
              rows={6}
              placeholder={'色号,数量\nA1,1200\nB3,4000'}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setFileName('')
                if (!unitChosen) setUnit(looksLikeGrams(e.target.value) ? 'grams' : 'beads')
              }}
              aria-label="粘贴表格"
            />
            <div className="segmented full" role="radiogroup" aria-label="数量单位">
              {(
                [
                  ['beads', '数量是颗数'],
                  ['grams', '数量是克数'],
                ] as const
              ).map(([u, label]) => (
                <button key={u} role="radio" aria-checked={unit === u} aria-selected={unit === u} onClick={() => {
                    setUnit(u)
                    setUnitChosen(true)
                  }}>
                  {label}
                </button>
              ))}
            </div>
            {skipped.length > 0 && (
              <details className="skipped">
                <summary className="sub">有 {skipped.length} 行没认出色号或数量（表头可以不管）</summary>
                {skipped.slice(0, 20).map((s, i) => (
                  <span key={i} className="sub">
                    {s}
                  </span>
                ))}
              </details>
            )}
            {codes.length > 0 && (
              <div className="chips">
                {codes.slice(0, 40).map((c) => (
                  <span key={c} className="chip">
                    <span className="swatch" style={{ background: codeColour(c) }} />
                    {c}
                    <span className="sub">{grams(delta[c])}</span>
                  </span>
                ))}
                {codes.length > 40 && <span className="sub">…还有 {codes.length - 40} 色</span>}
              </div>
            )}
          </>
        )}

        {total > 0 && (
          <p className="hint">
            要记入 {codes.length} 色，共 {total} 颗（约 {grams(total)}）
          </p>
        )}
        <div className="row end">
          <button className="link" onClick={onClose}>
            取消
          </button>
          <button className="primary small" disabled={!total || saving} onClick={save}>
            记入库存
          </button>
        </div>
      </div>
    </div>
      {picking !== null && (
        <ColourCard
          title="补哪个色号"
          value={lines[picking]?.code}
          onPick={(c) => {
            setLines(lines.map((x, i) => (i === picking ? { ...x, code: c } : x)))
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
