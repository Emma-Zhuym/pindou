// Link import relay: from a Xiaohongshu share text to the note's image list.
// A web page cannot do this itself: the note page refuses cross-site reads and a page cannot set
// the phone User-Agent the note page needs. This step runs where it can (the dev server now, a
// small worker later); the images themselves allow cross-site reads, so the app downloads them.
// Same steps as research/xhs-probe.mjs. No login, no cookies.

import { type Note, parseNote } from '../src/xhsNote.ts'

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const LINK = /(https?:\/\/)?(xhslink\.(com|cn)\/[^\s"<>，。；！？、【】《》]+|www\.(xiaohongshu|rednote)\.com\/(explore|discovery\/item)\/[^\s"<>，。；！？、【】《》]+)/

export type { Note, NoteImage } from '../src/xhsNote.ts'

export class RelayError extends Error {}

export async function readNote(text: string): Promise<Note> {
  const m = LINK.exec(text)
  if (!m) throw new RelayError('没有在文字里找到小红书链接')
  const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`
  const res = await fetch(url, { headers: { 'User-Agent': PHONE }, redirect: 'follow' })
  if (!res.ok) throw new RelayError(`小红书返回 ${res.status}`)
  const html = await res.text()
  try {
    return parseNote(html)
  } catch (e) {
    throw new RelayError(e instanceof Error ? e.message : String(e))
  }
}
