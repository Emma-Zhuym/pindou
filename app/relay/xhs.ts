// Link import relay: from a Xiaohongshu share text to the note's image list.
// A web page cannot do this itself: the note page refuses cross-site reads and a page cannot set
// the phone User-Agent the note page needs. This step runs where it can (the dev server now, a
// small worker later); the images themselves allow cross-site reads, so the app downloads them.
// Same steps as research/xhs-probe.mjs (sections 17-18 of ROADMAP). No login, no cookies.

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const LINK = /(https?:\/\/)?(xhslink\.(com|cn)\/[^\s"<>，。；！？、【】《》]+|www\.(xiaohongshu|rednote)\.com\/(explore|discovery\/item)\/[^\s"<>，。；！？、【】《》]+)/

export interface NoteImage {
  /** full resolution JPEG */
  url: string
  /** small JPEG for choosing */
  thumb: string
  width?: number
  height?: number
}

export interface Note {
  title: string
  images: NoteImage[]
}

export class RelayError extends Error {}

export async function readNote(text: string): Promise<Note> {
  const m = LINK.exec(text)
  if (!m) throw new RelayError('没有在文字里找到小红书链接')
  const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`
  const res = await fetch(url, { headers: { 'User-Agent': PHONE }, redirect: 'follow' })
  if (!res.ok) throw new RelayError(`小红书返回 ${res.status}`)
  const html = await res.text()
  const raw = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)?.[1]
  if (!raw) throw new RelayError('打不开这篇笔记（可能需要登录、已删除或链接过期）')
  let state: Record<string, unknown>
  try {
    state = JSON.parse(raw.replace(/\bundefined\b/g, 'null'))
  } catch {
    throw new RelayError('笔记页面的格式变了，读不出图片列表')
  }
  type Img = { urlDefault?: string; url?: string; width?: number; height?: number }
  type NoteData = { title?: string; imageList?: Img[] }
  // phone page: noteData.data.noteData; desktop page: note.noteDetailMap[id].note
  const phone = (state as { noteData?: { data?: { noteData?: NoteData } } }).noteData?.data?.noteData
  const map = (state as { note?: { noteDetailMap?: Record<string, { note?: NoteData }> } }).note?.noteDetailMap
  const desktop = map ? Object.values(map).at(-1)?.note : undefined
  const note = phone?.imageList ? phone : desktop?.imageList ? desktop : null
  if (!note?.imageList?.length) throw new RelayError('这篇笔记里没有图片')
  const images = note.imageList.flatMap((im) => {
    const src = im.urlDefault || im.url
    if (!src) return []
    // the image token is the URL path after the host and two date segments, before any "!" style
    const token = src.split('/').slice(5).join('/').split('!')[0]
    if (!token) return []
    const base = `https://ci.xiaohongshu.com/${token}`
    return [{ url: `${base}?imageView2/format/jpg`, thumb: `${base}?imageView2/2/w/360/format/jpg`, width: im.width, height: im.height }]
  })
  if (!images.length) throw new RelayError('读不出图片地址')
  return { title: note.title ?? '', images }
}
