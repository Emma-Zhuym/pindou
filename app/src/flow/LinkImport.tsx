import { useState } from 'react'

interface NoteImage {
  url: string
  thumb: string
  width?: number
  height?: number
}

/**
 * Import from a Xiaohongshu share link: the relay (relay/xhs.ts, served by the dev server for now)
 * lists the note's images; the person picks the chart (normal or mirrored, not the cover), and
 * the full-resolution image is downloaded straight from the image server.
 */
export function LinkImport({ disabled, onPick }: { disabled: boolean; onPick: (image: Blob, title: string) => void }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ title: string; images: NoteImage[] } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function read() {
    setBusy('正在读取笔记…')
    setError('')
    setNote(null)
    try {
      const res = await fetch(`/api/xhs?text=${encodeURIComponent(text)}`)
      const type = res.headers.get('content-type') ?? ''
      if (!type.includes('json')) throw new Error('NO_RELAY')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `读取失败（${res.status}）`)
      setNote(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        msg === 'NO_RELAY' || e instanceof TypeError
          ? '这里还不能直接读链接：需要一个中转，现在只有在电脑上用开发服务器打开 App 时才有。手机上请先用快捷指令把图片存进相册，再从上面选择图片。'
          : msg,
      )
    } finally {
      setBusy('')
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
          placeholder="粘贴小红书分享文案或链接"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && !busy && read()}
          aria-label="小红书链接"
        />
        <button className="primary small" disabled={disabled || !!busy || !text.trim()} onClick={read}>
          读取
        </button>
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
