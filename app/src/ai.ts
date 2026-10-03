// Optional: let a vision model read the legend when the local reading is unsure.
// The model only reads what is printed (codes and counts); it never sees the board or counts cells.
// Matching its list to the board's colours is done locally (engine/legendRead.ts fitList).
import { CATALOGUE } from './engine/glyphs'
import type { Rect } from './engine/legendArea'
import type { LegendEntry } from './engine/legendRead'
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

export interface ModelInfo {
  id: string
  name: string
  /** US dollars per million input tokens, when OpenRouter lists a price */
  inputPrice?: number
}

/** Checks the key and lists the OpenRouter models that accept images, cheapest first. */
export async function listVisionModels(key: string): Promise<ModelInfo[]> {
  const check = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key.trim()}` } })
  if (check.status === 401 || check.status === 403) throw new Error('Key 无效，请检查是否复制完整')
  if (!check.ok) throw new Error(`验证 Key 失败（${check.status}）`)
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`获取模型列表失败（${res.status}）`)
  const data = ((await res.json())?.data ?? []) as { id: string; name?: string; architecture?: { input_modalities?: string[]; modality?: string }; pricing?: { prompt?: string } }[]
  return data
    .filter((m) => m.architecture?.input_modalities?.includes('image') ?? m.architecture?.modality?.includes('image'))
    .map((m) => {
      const p = Number(m.pricing?.prompt)
      return { id: m.id, name: m.name ?? m.id, inputPrice: Number.isFinite(p) && p >= 0 ? p * 1e6 : undefined }
    })
    .sort((a, b) => (a.inputPrice ?? Infinity) - (b.inputPrice ?? Infinity) || a.name.localeCompare(b.name))
}

const CELL_TILE = 72
const TILES_PER_ROW = 10
const CELLS_PER_REQUEST = 100

/** Numbered tiles of the given cells, cut from the image as they are (watermark and all). */
function cellSheet(img: HTMLImageElement, rec: Recognition, cells: number[]): string {
  const rows = Math.ceil(cells.length / TILES_PER_ROW)
  const pitch = CELL_TILE + 12
  const head = 22
  const c = document.createElement('canvas')
  c.width = TILES_PER_ROW * pitch + 12
  c.height = rows * (pitch + head) + 12
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  const { grid, cells: board } = rec
  cells.forEach((cell, k) => {
    const x = 12 + (k % TILES_PER_ROW) * pitch
    const y = 12 + Math.floor(k / TILES_PER_ROW) * (pitch + head)
    ctx.fillStyle = '#c00'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText(String(k + 1), x, y + 16)
    const sx = grid.offX + (board.c0 + (cell % board.cols)) * grid.perX
    const sy = grid.offY + (board.r0 + Math.floor(cell / board.cols)) * grid.perY
    ctx.drawImage(img, sx, sy, grid.perX, grid.perY, x, y + head, CELL_TILE, CELL_TILE)
    ctx.strokeStyle = '#999'
    ctx.strokeRect(x - 0.5, y + head - 0.5, CELL_TILE + 1, CELL_TILE + 1)
  })
  return c.toDataURL('image/png')
}

/**
 * The code printed in each of the given cells, read by the model from numbered tiles. Codes are
 * limited to the chart's own list; null where the model sees no code (an empty cell) or could not
 * read one.
 */
export async function readCellsWithAi(img: HTMLImageElement, rec: Recognition, cells: number[], codes: string[], settings: AiSettings): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  const allowed = new Set(codes)
  for (let start = 0; start < cells.length; start += CELLS_PER_REQUEST) {
    const batch = cells.slice(start, start + CELLS_PER_REQUEST)
    const prompt = [
      `这是一张拼豆图纸上裁下来的 ${batch.length} 个格子，每格上方有红色编号。每个格子中间印着这一格的拼豆色号，有的被半透明水印或线条挡住一部分。`,
      `这张图纸只用到这些色号：${codes.join('、')}。`,
      '请读出每个格子里印的色号，只能从上面的色号里选；格子里没有印色号（空白格）或实在认不出就填 null。只输出 JSON，不要其他文字：',
      '{"1": "H5", "2": "C24", "3": null}',
    ].join('\n')
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: cellSheet(img, rec, batch) } }] }],
      }),
    })
    if (!res.ok) throw new Error(`AI 请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`)
    const text: string = (await res.json())?.choices?.[0]?.message?.content ?? ''
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    if (!json) throw new Error('AI 没有返回可解析的结果')
    const parsed = JSON.parse(json) as Record<string, unknown>
    batch.forEach((cell, k) => {
      const v = parsed[String(k + 1)]
      const m = typeof v === 'string' ? /^([A-Za-z]+)0*(\d+)$/.exec(v.trim()) : null
      const code = m ? m[1].toUpperCase() + m[2] : null
      out.set(cell, code && allowed.has(code) ? code : null)
    })
  }
  return out
}
