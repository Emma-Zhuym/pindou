// Optional: let a vision model read the legend when the local reading is unsure.
// The model only reads what is printed (codes and counts); it never sees the board or counts cells.
// Matching its list to the board's colours is done locally (engine/legendRead.ts fitList).
import { CATALOGUE } from './engine/glyphs'
import type { Rect } from './engine/legendArea'
import type { LegendEntry } from './engine/legendRead'

export interface AiSettings {
  key: string
  model: string
}

const STORE = 'pindou.ai'

export function loadAiSettings(): AiSettings {
  try {
    return { key: '', model: '', ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }
  } catch {
    return { key: '', model: '' }
  }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    // private mode: settings just don't persist
  }
}

function legendCrop(img: HTMLImageElement, rect: Rect): string {
  // enough pixels for small print, within what vision models accept
  const scale = Math.min(3, 2400 / rect.w, 2400 / rect.h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(rect.w * scale))
  c.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.92)
}

const PROMPT = [
  '这是一张拼豆图纸的图例（色卡）部分。图例里每一项是一个 MARD 色号（一个大写字母加数字，例如 A1、B30、H07、M15，少数是 ZG 加数字），通常还印着这个色号的颗数。',
  '请按图例上的顺序（从上到下、从左到右）列出全部色号和颗数；如果图上还印着图纸尺寸（如"规格 93×62""尺寸: 104 x 104"，宽在前、高在后）或总颗数（如"总计 3971 颗""总豆数: 10816"），也一并读出。只输出 JSON，不要任何其他文字：',
  '{"legend": [{"code": "A1", "count": 3150}, {"code": "H2", "count": 1599}], "size": {"cols": 93, "rows": 62}, "total": 3971}',
  '读不清的颗数填 null；图上没印尺寸或总数就填 null。不是色号的文字（标题、作者、水印、总数）不要列进 legend。',
].join('\n')

export interface AiLegend {
  /** codes and counts in printed order */
  entries: LegendEntry[]
  /** board size printed on the chart, if any */
  size?: { cols: number; rows: number }
  /** total bead count printed on the chart, if any */
  total?: number
}

const whole = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)

/** What the legend prints: codes and counts, and the board size and total when shown. Only the
 *  legend crop is sent. */
export async function readLegendWithAi(img: HTMLImageElement, rect: Rect, settings: AiSettings): Promise<AiLegend> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: legendCrop(img, rect) } }] }],
    }),
  })
  if (!res.ok) throw new Error(`AI 请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`)
  const text: string = (await res.json())?.choices?.[0]?.message?.content ?? ''
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error('AI 没有返回可解析的结果')
  const parsed = JSON.parse(json) as { legend?: { code?: unknown; count?: unknown }[]; size?: { cols?: unknown; rows?: unknown } | null; total?: unknown }
  const out: LegendEntry[] = []
  for (const e of parsed.legend ?? []) {
    if (typeof e?.code !== 'string') continue
    const m = /^([A-Za-z]+)0*(\d+)$/.exec(e.code.trim())
    const code = m ? m[1].toUpperCase() + m[2] : ''
    if (!(code in CATALOGUE) || out.some((o) => o.code === code)) continue
    out.push({ code, count: typeof e.count === 'number' && Number.isFinite(e.count) ? Math.round(e.count) : undefined })
  }
  if (!out.length) throw new Error('AI 没有在图例里读到色号')
  const cols = whole(parsed.size?.cols)
  const rows = whole(parsed.size?.rows)
  return { entries: out, size: cols && rows ? { cols, rows } : undefined, total: whole(parsed.total) }
}
