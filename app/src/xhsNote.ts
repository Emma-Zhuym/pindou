// Reading a Xiaohongshu note page: its title and image list, from the state the page carries.
// Used by the relay (relay/xhs.ts) and by the app itself, on the page an iOS Shortcut fetched and
// copied (the published app has no relay). No login, no cookies.

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

/** an image's address on the image server, at full size and as a thumbnail */
function image(src: string, width?: number, height?: number): NoteImage | null {
  // the image token is the URL path after the host and two date segments, before any "!" style
  const token = src.split('/').slice(5).join('/').split('!')[0].split('?')[0]
  if (!token) return null
  const base = `https://ci.xiaohongshu.com/${token}`
  return { url: `${base}?imageView2/format/jpg`, thumb: `${base}?imageView2/2/w/360/format/jpg`, width, height }
}

/** Does this text look like a note page (rather than a share text with a link)? */
export const isNotePage = (text: string) => /__INITIAL_STATE__|"imageList"/.test(text)

const unescape = (s: string) => s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/')

/** The images listed under the first "imageList" in the text, by bracket depth. */
function scanImages(text: string): NoteImage[] {
  const at = text.indexOf('"imageList"')
  const open = at < 0 ? -1 : text.indexOf('[', at)
  if (open < 0) return []
  let depth = 0
  let end = open
  for (; end < text.length; end++) {
    if (text[end] === '[') depth++
    else if (text[end] === ']' && --depth === 0) break
  }
  const list = text.slice(open, end + 1)
  // one entry per image: its default address, else its first address
  const out: NoteImage[] = []
  const seen = new Set<string>()
  for (const m of list.matchAll(/"(?:urlDefault|url)"\s*:\s*"(http[^"]+)"/g)) {
    const one = image(unescape(m[1]))
    if (one && !seen.has(one.url)) {
      seen.add(one.url)
      out.push(one)
    }
  }
  return out
}

/** The note in a page's HTML; throws with a message for the person when it is not there. */
export function parseNote(html: string): Note {
  const raw = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)?.[1]
  type Img = { urlDefault?: string; url?: string; width?: number; height?: number }
  type NoteData = { title?: string; imageList?: Img[] }
  let note: NoteData | null = null
  if (raw) {
    try {
      const state = JSON.parse(raw.replace(/\bundefined\b/g, 'null'))
      // phone page: noteData.data.noteData; desktop page: note.noteDetailMap[id].note
      const phone = (state as { noteData?: { data?: { noteData?: NoteData } } }).noteData?.data?.noteData
      const map = (state as { note?: { noteDetailMap?: Record<string, { note?: NoteData }> } }).note?.noteDetailMap
      const desktop = map ? Object.values(map).at(-1)?.note : undefined
      note = phone?.imageList ? phone : desktop?.imageList ? desktop : null
    } catch {
      // fall through to scanning the text
    }
  }
  let images = (note?.imageList ?? []).flatMap((im) => {
    const one = (im.urlDefault || im.url) && image((im.urlDefault || im.url)!, im.width, im.height)
    return one ? [one] : []
  })
  // the page cut short or its state unreadable: pick the image addresses out of the text
  if (!images.length) images = scanImages(html)
  if (!images.length) {
    if (!raw && !html.includes('"imageList"')) throw new Error('打不开这篇笔记（可能需要登录、已删除或链接过期）')
    throw new Error('这篇笔记里没有找到图片')
  }
  const title = note?.title ?? unescape(/"title"\s*:\s*"([^"]*)"/.exec(html)?.[1] ?? '')
  return { title, images }
}
