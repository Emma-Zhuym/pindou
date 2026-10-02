// Optional: let a vision model read the colour codes.
// The model is never asked to count cells. It gets one small sheet with each colour group's
// stacked label (a few dozen clear, numbered tiles) plus the chart's legend, and reads them.
import { paintLabel } from './browser'
import { CATALOGUE } from './engine/glyphs'
import type { Rect } from './engine/legendArea'
import type { Recognition } from './engine/recognize'

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

const TILE = 120

function labelSheet(rec: Recognition): string {
  const perRow = 8
  const rows = Math.ceil(rec.groups.length / perRow)
  const sheet = document.createElement('canvas')
  sheet.width = perRow * (TILE + 24) + 24
  sheet.height = rows * (TILE + 56) + 24
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  const tile = document.createElement('canvas')
  rec.groups.forEach((g, i) => {
    const x = 24 + (i % perRow) * (TILE + 24)
    const y = 24 + Math.floor(i / perRow) * (TILE + 56)
    paintLabel(tile, g.label, TILE)
    ctx.drawImage(tile, x, y)
    ctx.strokeStyle = '#999'
    ctx.strokeRect(x - 0.5, y - 0.5, TILE + 1, TILE + 1)
    ctx.fillStyle = '#c00'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(`#${i + 1}`, x, y + TILE + 26)
  })
  return sheet.toDataURL('image/png')
}

function legendCrop(img: HTMLImageElement, rect: Rect | null): string | null {
  if (!rect || rect.h < 8 || rect.w < 8) return null
  const scale = Math.min(3, 2400 / rect.w)
  const c = document.createElement('canvas')
  c.width = Math.round(rect.w * scale)
  c.height = Math.round(rect.h * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

export interface AiReading {
  /** code per group, or null where the model gave nothing usable */
  codes: (string | null)[]
  /** code -> count as printed in the legend, where the model could read it */
  legend: Record<string, number>
}

export async function readCodesWithAi(img: HTMLImageElement, rec: Recognition, legendRect: Rect | null, settings: AiSettings): Promise<AiReading> {
  const legend = legendCrop(img, legendRect)
  const prompt = [
    `第一张图是 ${rec.groups.length} 个编号小图（#1 到 #${rec.groups.length}），每个小图里是一个拼豆色号，格式是一个大写字母加一到两位数字（例如 A1、B30、F13、H7、M3），少数是 ZG 加数字。字有些模糊。`,
    legend ? '第二张图是同一张图纸的图例，上面印着这张图纸用到的全部色号和每个色号的颗数。小图里的色号一定出现在图例里，请用图例来确定模糊的字。' : '',
    '请只输出 JSON，不要任何其他文字，格式：',
    '{"labels": {"1": "A1", "2": "B30"}, "legend": {"A1": 3150, "B30": 345}}',
    'labels 的键是小图编号；实在看不清的填 null。legend 是图例上读到的 色号: 颗数；没有图例或读不清就给空对象。',
  ]
    .filter(Boolean)
    .join('\n')
  const content: unknown[] = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: labelSheet(rec) } }]
  if (legend) content.push({ type: 'image_url', image_url: { url: legend } })

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model, temperature: 0, messages: [{ role: 'user', content }] }),
  })
  if (!res.ok) throw new Error(`请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`)
  const text: string = (await res.json())?.choices?.[0]?.message?.content ?? ''
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error('模型没有返回可解析的结果')
  const parsed = JSON.parse(json) as { labels?: Record<string, unknown>; legend?: Record<string, unknown> }

  const clean = (v: unknown) => {
    if (typeof v !== 'string') return null
    const m = /^([A-Za-z]+)0*(\d+)$/.exec(v.trim())
    const code = m ? m[1].toUpperCase() + m[2] : v.trim().toUpperCase()
    return code in CATALOGUE ? code : null
  }
  const out: AiReading = { codes: rec.groups.map((_, i) => clean(parsed.labels?.[String(i + 1)])), legend: {} }
  for (const [k, v] of Object.entries(parsed.legend ?? {})) {
    const code = clean(k)
    if (code && typeof v === 'number' && Number.isFinite(v)) out.legend[code] = v
  }
  return out
}
