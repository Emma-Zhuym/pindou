// Optional: let a vision model read the legend when the local reading is unsure (Alibaba Bailian,
// SiliconFlow or OpenRouter: services whose chat API a web page may call with the person's own key).
// The model only reads what is printed (codes and counts); it never sees the board or counts cells.
// Matching its list to the board's colours is done locally (engine/legendRead.ts fitList).
import { CATALOGUE } from './engine/glyphs'
import type { Rect } from './engine/legendArea'
import type { LegendEntry } from './engine/legendRead'
import type { Recognition } from './engine/recognize'

/** where the vision model runs: any service with an OpenAI-style chat API that a web page may call */
export type AiProvider = 'bailian' | 'siliconflow' | 'openrouter'

export interface ProviderInfo {
  name: string
  base: string
  /** the model used unless another is chosen: cheap and good at small print */
  model: string
  /** where the key is made */
  keyPage: string
  /** its models may think before answering; off, since reading print needs none of it */
  noThinking?: boolean
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  bailian: {
    name: '阿里云百炼',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-vl-plus',
    keyPage: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    noThinking: true,
  },
  siliconflow: {
    name: '硅基流动',
    base: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-VL-32B-Instruct',
    keyPage: 'https://cloud.siliconflow.cn/account/ak',
    noThinking: true,
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    model: '',
    keyPage: 'https://openrouter.ai/settings/keys',
  },
}

/** the service in use, with its key and model */
export interface AiSettings {
  provider: AiProvider
  key: string
  model: string
}

/** One actual vision request made during a recognition run. */
export type AiRequestPhase = 'legend' | 'group-names' | 'cell-check'
export interface AiRequestEvent {
  phase: AiRequestPhase
  /** Number of chart items sent in this request (1 for the legend crop). */
  items: number
}
export type AiRequestTrace = (event: AiRequestEvent) => void

const STORE = 'pindou.ai'

/** what is stored: the service in use, and each service's own key and model (switching back and
 *  forth keeps them). Settings saved before there was a choice were OpenRouter's. */
interface Stored {
  provider: AiProvider
  keys: Partial<Record<AiProvider, { key: string; model: string }>>
}

function loadStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    if (raw.keys)
      return {
        provider: raw.provider in PROVIDERS ? raw.provider : 'bailian',
        keys: raw.keys,
      }
    if (raw.key)
      return {
        provider: 'openrouter',
        keys: { openrouter: { key: raw.key, model: raw.model ?? '' } },
      }
  } catch {
    // unreadable: start over
  }
  return { provider: 'bailian', keys: {} }
}

/** the settings for one service (the one in use when none is named); its default model when none
 *  was chosen */
export function loadAiSettings(provider?: AiProvider): AiSettings {
  const s = loadStored()
  const p = provider ?? s.provider
  const own = s.keys[p]
  return {
    provider: p,
    key: own?.key ?? '',
    model: own?.model || PROVIDERS[p].model,
  }
}

/** saves one service's key and model, and makes it the one in use */
export function saveAiSettings(a: AiSettings) {
  const s = loadStored()
  s.provider = a.provider
  s.keys[a.provider] = { key: a.key, model: a.model }
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    // private mode: settings just don't persist
  }
}

/** how long one request may take (ms) */
const ASK_TIMEOUT = 90_000

/** a chat request to the service in use, one image and its instructions; the reply's text */
async function ask(settings: AiSettings, text: string, image: string): Promise<string> {
  const p = PROVIDERS[settings.provider]
  // a slow model or a stuck connection would otherwise leave the page waiting for good
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ASK_TIMEOUT)
  let res: Response
  try {
    res = await fetch(`${p.base}/chat/completions`, {
      signal: stop.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.key.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        ...(p.noThinking ? { enable_thinking: false } : {}),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    if (stop.signal.aborted) throw new Error(`${p.name} 的「${settings.model}」${ASK_TIMEOUT / 1000} 秒没回话，可能这个模型太慢或在长时间思考，去设置里换一个模型试试`)
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${p.name} 的 Key 不对或没有权限（${res.status}），去设置里检查一下`)
  if (res.status === 402) throw new Error(`${p.name} 账户余额不足（402），充值或换一家后再试`)
  if (!res.ok) throw new Error(`AI 请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`)
  return (await res.json())?.choices?.[0]?.message?.content ?? ''
}

/**
 * Checks a key and the model chosen against the service's model list. OpenRouter's models are
 * picked from a list (listVisionModels); the others' default model is checked to exist.
 */
export async function checkAi(a: AiSettings): Promise<string> {
  const p = PROVIDERS[a.provider]
  if (a.provider === 'openrouter') {
    await listVisionModels(a.key)
    return 'Key 可用'
  }
  const res = await fetch(`${p.base}/models`, {
    headers: { Authorization: `Bearer ${a.key.trim()}` },
  })
  if (res.status === 401 || res.status === 403) throw new Error('Key 不对，检查一下是不是复制完整了')
  if (!res.ok) throw new Error(`验证 Key 失败（${res.status}）`)
  const ids = (((await res.json())?.data ?? []) as { id: string }[]).map((m) => m.id)
  if (ids.length && !ids.includes(a.model)) throw new Error(`Key 可用，但这家没有「${a.model}」这个模型，换一个模型名试试`)
  return 'Key 可用'
}

function legendCrop(img: HTMLImageElement, rect: Rect): string {
  // enough pixels for small print, and no more: a smaller picture uploads faster (a service in
  // China reached from abroad is slow) and costs the model fewer tokens to look at
  const scale = Math.min(3, 1800 / rect.w, 1800 / rect.h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(rect.w * scale))
  c.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
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
export async function readLegendWithAi(img: HTMLImageElement, rect: Rect, settings: AiSettings, trace?: AiRequestTrace): Promise<AiLegend> {
  trace?.({ phase: 'legend', items: 1 })
  const text = await ask(settings, PROMPT, legendCrop(img, rect))
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error('AI 没有返回可解析的结果')
  const parsed = JSON.parse(json) as {
    legend?: { code?: unknown; count?: unknown }[]
    size?: { cols?: unknown; rows?: unknown } | null
    total?: unknown
  }
  const out: LegendEntry[] = []
  for (const e of parsed.legend ?? []) {
    if (typeof e?.code !== 'string') continue
    const m = /^([A-Za-z]+)0*(\d+)$/.exec(e.code.trim())
    const code = m ? m[1].toUpperCase() + m[2] : ''
    if (!(code in CATALOGUE) || out.some((o) => o.code === code)) continue
    out.push({
      code,
      count: typeof e.count === 'number' && Number.isFinite(e.count) ? Math.round(e.count) : undefined,
    })
  }
  if (!out.length) throw new Error('AI 没有在图例里读到色号')
  const cols = whole(parsed.size?.cols)
  const rows = whole(parsed.size?.rows)
  return {
    entries: out,
    size: cols && rows ? { cols, rows } : undefined,
    total: whole(parsed.total),
  }
}

export interface ModelInfo {
  id: string
  name: string
  /** US dollars per million input tokens, when OpenRouter lists a price */
  inputPrice?: number
}

/** Checks the key and lists the OpenRouter models that accept images, cheapest first. */
export async function listVisionModels(key: string): Promise<ModelInfo[]> {
  const check = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key.trim()}` },
  })
  if (check.status === 401 || check.status === 403) throw new Error('Key 无效，请检查是否复制完整')
  if (!check.ok) throw new Error(`验证 Key 失败（${check.status}）`)
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`获取模型列表失败（${res.status}）`)
  const data = ((await res.json())?.data ?? []) as {
    id: string
    name?: string
    architecture?: { input_modalities?: string[]; modality?: string }
    pricing?: { prompt?: string }
  }[]
  return data
    .filter((m) => m.architecture?.input_modalities?.includes('image') ?? m.architecture?.modality?.includes('image'))
    .map((m) => {
      const p = Number(m.pricing?.prompt)
      return {
        id: m.id,
        name: m.name ?? m.id,
        inputPrice: Number.isFinite(p) && p >= 0 ? p * 1e6 : undefined,
      }
    })
    .sort((a, b) => (a.inputPrice ?? Infinity) - (b.inputPrice ?? Infinity) || a.name.localeCompare(b.name))
}

const CELL_TILE = 72
const TILES_PER_ROW = 10
export const CELLS_PER_REQUEST = 100

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
export async function readCellsWithAi(
  img: HTMLImageElement,
  rec: Recognition,
  cells: number[],
  codes: string[],
  settings: AiSettings,
  trace?: AiRequestTrace,
  phase: AiRequestPhase = 'cell-check',
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  const allowed = new Set(codes)
  for (let start = 0; start < cells.length; start += CELLS_PER_REQUEST) {
    const batch = cells.slice(start, start + CELLS_PER_REQUEST)
    trace?.({ phase, items: batch.length })
    const prompt = [
      `这是一张拼豆图纸上裁下来的 ${batch.length} 个格子，每格上方有红色编号。每个格子中间印着这一格的拼豆色号，有的被半透明水印或线条挡住一部分。`,
      `这张图纸只用到这些色号：${codes.join('、')}。`,
      '请读出每个格子里印的色号，只能从上面的色号里选；格子里没有印色号（空白格）或实在认不出就填 null。只输出 JSON，不要其他文字：',
      '{"1": "H5", "2": "C24", "3": null}',
    ].join('\n')
    const text = await ask(settings, prompt, cellSheet(img, rec, batch))
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
