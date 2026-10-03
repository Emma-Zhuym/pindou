import { useState } from 'react'
import { isNotePage, type NoteImage, parseNote } from '../xhsNote'

/** the iOS Shortcut that fetches a note page and copies it (see SHORTCUT.md) */
export const SHORTCUT_URL = 'https://github.com/Emma-Zhuym/pindou/blob/main/SHORTCUT.md'
/** the signed Shortcut itself, published with the app */
export const SHORTCUT_FILE = `${import.meta.env.BASE_URL}拼豆读笔记.shortcut`

/**
 * Import from a Xiaohongshu note: the page an iOS Shortcut fetched and copied, read here; or, on
 * this Mac's dev server, a share link read by the relay (relay/xhs.ts). The person picks the chart
 * (normal or mirrored, not the cover), and the full-resolution image is downloaded straight from
 * the image server.
 */
export function LinkImport({ disabled, onPick }: { disabled: boolean; onPick: (image: Blob, title: string) => void }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ title: string; images: NoteImage[] } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function read(input = text) {
    setError('')
    setNote(null)
    if (isNotePage(input)) {
      try {
        setNote(parseNote(input))
        setText('')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      return
    }
    if (!import.meta.env.DEV) {
      setError('网页版不能直接读链接：请在小红书里点"分享"→ 选"拼豆读笔记"快捷指令，跑完后回来点"粘贴快捷指令结果"。')
      return
    }
    setBusy('正在读取笔记…')
    try {
      const res = await fetch(`/api/xhs?text=${encodeURIComponent(input)}`)
      const type = res.headers.get('content-type') ?? ''
      if (!type.includes('json')) throw new Error('NO_RELAY')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `读取失败（${res.status}）`)
      setNote(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        msg === 'NO_RELAY' || e instanceof TypeError
          ? '这里不能直接读链接，请用"拼豆读笔记"快捷指令。'
          : msg,
      )
    } finally {
      setBusy('')
    }
  }

  // the Shortcut's result is on the clipboard: a whole page, too long to paste by hand comfortably
  async function paste() {
    try {
      const got = await navigator.clipboard.readText()
      if (!isNotePage(got)) {
        setError('剪贴板里不是快捷指令读到的笔记。先在小红书里分享给"拼豆读笔记"，跑完再回来点这里。')
        return
      }
      read(got)
    } catch {
      setError('读不了剪贴板：请在下面的框里长按 →"粘贴"，再点"读取"。')
    }
  }

  async function pick(im: NoteImage) {
    setBusy('正在下载原图…')
    setError('')
    try {
      const res = await fetch(im.url)
      if (!res.ok) throw new Error(`下载失败（${res.status}）`)
      onPick(await res.blob(), note?.title ?? '')
      setNote(null)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card linkimport">
      <div className="row">
        <input
          placeholder={import.meta.env.DEV ? '粘贴小红书分享文案或链接' : '或者把快捷指令的结果粘贴在这里'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && !busy && read()}
          aria-label="小红书链接"
        />
        <button className="primary small" disabled={disabled || !!busy || !text.trim()} onClick={() => read()}>
          读取
        </button>
      </div>
      <div className="row">
        <button className="small glass" disabled={disabled || !!busy} onClick={paste}>
          粘贴快捷指令结果
        </button>
        <a className="link sub" href={SHORTCUT_FILE}>
          安装快捷指令
        </a>
        <a className="link sub" href={SHORTCUT_URL} target="_blank" rel="noreferrer">
          说明
        </a>
      </div>
      {busy && <p className="hint">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {note && (
        <>
          <p className="hint">
            {note.title ? `「${note.title}」` : '这篇笔记'}有 {note.images.length} 张图。点图纸那张导入（效果图不用选；要镜像熨烫就选镜像版）。
          </p>
          <div className="notegrid">
            {note.images.map((im, k) => (
              <button key={im.url} className="noteimage" disabled={!!busy} onClick={() => pick(im)}>
                <img src={im.thumb} alt={`第 ${k + 1} 张`} loading="lazy" />
                <span className="sub">
                  第 {k + 1} 张{im.width && im.height ? ` · ${im.width}×${im.height}` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
