// Probe: what can be fetched from a Xiaohongshu share link without logging in?
//
//   node research/xhs-probe.mjs "<分享文案或链接>" ["<另一条>" ...]
//
// For each link it records, step by step, what worked: short-link redirect, note page, the
// image list embedded in the page, and each image from the two CDN URL forms that open-source
// downloaders use (XHS-Downloader, GPL-3.0: imageList[].urlDefault -> token ->
// ci.xiaohongshu.com/<token>?imageView2/format/png or sns-img-bd.xhscdn.com/<token>).
// Images are saved under research/out/xhs/<noteId>/ for a visual check of watermark and
// quality. The report also notes whether a browser page could read them (CORS headers).
// Research only: no login, no cookies, one request at a time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out', 'xhs')
const UA = {
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
}
const LINK = /(https?:\/\/)?(xhslink\.(com|cn)\/[^\s"<>，。；！？、【】《》]+|www\.(xiaohongshu|rednote)\.com\/(explore|discovery\/item)\/[^\s"<>，。；！？、【】《》]+)/

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function follow(url, ua) {
  const chain = []
  let current = url
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': ua } })
    chain.push({ url: current.replace(/xsec_token(=|%3D)[^&%]+/g, 'xsec_token$1…'), status: res.status })
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) {
      current = new URL(next, current).toString()
      continue
    }
    return { final: current, chain, res }
  }
  return { final: current, chain, res: null }
}

function initialState(html) {
  const m = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)
  if (!m) return null
  try {
    return JSON.parse(m[1].replace(/\bundefined\b/g, 'null'))
  } catch {
    return 'unparsable'
  }
}

function findImageList(state) {
  // desktop page: note.noteDetailMap[id].note ; mobile page: noteData.data.noteData
  const desktop = state?.note?.noteDetailMap && Object.values(state.note.noteDetailMap).at(-1)?.note
  const mobile = state?.noteData?.data?.noteData
  const note = desktop?.imageList ? desktop : mobile?.imageList ? mobile : null
  return note ? { title: note.title, type: note.type, images: note.imageList } : null
}

function imageSize(buf) {
  const b = new Uint8Array(buf)
  if (b[0] === 0x89 && b[1] === 0x50) return { format: 'png', w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) break
      const marker = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker >= 0xc0 && marker <= 0xc3) return { format: 'jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + len
    }
    return { format: 'jpeg' }
  }
  if (b[8] === 0x57 && b[9] === 0x45) return { format: 'webp' }
  return { format: 'unknown' }
}

async function probe(text) {
  const m = LINK.exec(text)
  if (!m) return { input: text.slice(0, 60), error: '没有找到小红书链接' }
  const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`
  const report = { input: url.replace(/xsec_token=[^&]+/, 'xsec_token=…'), pages: [] }
  for (const [kind, ua] of Object.entries(UA)) {
    const page = { ua: kind }
    try {
      const { final, chain, res } = await follow(url, ua)
      page.redirects = chain
      page.noteId = /(?:explore|item)\/([0-9a-f]{24})/.exec(final)?.[1] ?? null
      if (res) {
        const html = await res.text()
        page.status = res.status
        page.htmlBytes = html.length
        page.loginWall = /登录后查看|请先登录|login/i.test(html.slice(0, 20000)) && !/__INITIAL_STATE__/.test(html)
        const state = initialState(html)
        page.hasInitialState = !!state && state !== 'unparsable'
        const note = state && state !== 'unparsable' ? findImageList(state) : null
        page.imageCount = note?.images?.length ?? 0
        if (note) {
          page.title = note.title
          page.images = note.images.map((im) => ({ width: im.width, height: im.height, urlDefault: im.urlDefault || im.url }))
        }
      }
    } catch (e) {
      page.error = String(e)
    }
    report.pages.push(page)
    await pause(1500)
  }

  const withImages = report.pages.find((p) => p.imageCount)
  if (!withImages) return report
  const dir = join(OUT, withImages.noteId ?? 'unknown')
  mkdirSync(dir, { recursive: true })
  report.images = []
  for (const [n, im] of withImages.images.entries()) {
    const token = im.urlDefault.split('/').slice(5).join('/').split('!')[0]
    const entry = { index: n + 1, listed: `${im.width}x${im.height}`, variants: [] }
    for (const [name, src] of [
      ['default', im.urlDefault],
      ['ci-png', `https://ci.xiaohongshu.com/${token}?imageView2/format/png`],
      ['sns-img-bd', `https://sns-img-bd.xhscdn.com/${token}`],
    ]) {
      try {
        const res = await fetch(src, { headers: { 'User-Agent': UA.desktop, Referer: 'https://www.xiaohongshu.com/' } })
        const buf = await res.arrayBuffer()
        const info = imageSize(buf)
        const file = join(dir, `${n + 1}-${name}.${info.format === 'unknown' ? 'bin' : info.format}`)
        if (res.ok) writeFileSync(file, Buffer.from(buf))
        entry.variants.push({ name, status: res.status, bytes: buf.byteLength, ...info, cors: res.headers.get('access-control-allow-origin'), saved: res.ok ? file.replace(OUT, 'out/xhs') : null })
      } catch (e) {
        entry.variants.push({ name, error: String(e) })
      }
      await pause(800)
    }
    report.images.push(entry)
  }
  return report
}

const inputs = process.argv.slice(2)
if (!inputs.length) {
  console.error('用法：node research/xhs-probe.mjs "<分享文案或链接>" ...')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const all = []
for (const text of inputs) {
  const r = await probe(text)
  all.push(r)
  console.log(JSON.stringify(r, null, 2))
}
writeFileSync(join(OUT, `report-${Date.now()}.json`), JSON.stringify(all, null, 2))
