import { useEffect, useState } from 'react'
import { isNotePage, type NoteImage, parseNote } from '../xhsNote'

/** the iOS Shortcut that fetches a note page and copies it (see SHORTCUT.md) */
export const SHORTCUT_URL = 'https://github.com/Emma-Zhuym/pindou/blob/main/SHORTCUT.md'
const SHORTCUT_NAME = '拼豆读笔记'
const SOURCE_KEY = 'pindou.import.source-url'
/** the signed Shortcut itself, published with the app */
export const SHORTCUT_FILE = `${import.meta.env.BASE_URL}拼豆读笔记.shortcut`

function extractExternalUrl(text: string): string | undefined {
  return /https?:\/\/[^\s，。]+/.exec(text)?.[0]
}

function rememberSource(url?: string) {
  try {
    if (url) sessionStorage.setItem(SOURCE_KEY, url)
    else sessionStorage.removeItem(SOURCE_KEY)
  } catch {
    // Private browsing may deny session storage; the in-memory state still works.
  }
}

function rememberedSource() {
  try { return sessionStorage.getItem(SOURCE_KEY) ?? '' } catch { return '' }
}

/**
 * Import from a Xiaohongshu note: the page an iOS Shortcut fetched and copied, read here; or, on
 * this Mac's dev server, a share link read by the relay (relay/xhs.ts). The person picks the chart
 * (normal or mirrored, not the cover), and the full-resolution image is downloaded straight from
 * the image server.
 */
export function LinkImport({ disabled, onPick }: { disabled: boolean; onPick: (image: Blob, title: string, sourceUrl?: string) => void }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ title: string; images: NoteImage[] } | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // gone to the Shortcuts app and come back: the result is waiting on the clipboard
  const [away, setAway] = useState<'gone' | 'back' | null>(null)
  useEffect(() => {
    const seen = () => document.visibilityState === 'visible' && setAway((a) => (a === 'gone' ? 'back' : a))
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [])

  // Runs the Shortcut on the link typed here, else on the clipboard (the link copied in
  // Xiaohongshu). It copies the note page and shows a notification; coming back, one tap pastes it.
  function runShortcut() {
    const link = extractExternalUrl(text)
    if (!link && navigator.clipboard) {
      // Keep the navigation synchronous so iOS still treats it as the button's user gesture.
      void navigator.clipboard.readText().then((clipboard) => {
        const copied = extractExternalUrl(clipboard)
        if (copied) { rememberSource(copied); setSourceUrl(copied) }
      }).catch(() => {})
    }
    if (link) { rememberSource(link); setSourceUrl(link) }
    const input = link ? `text&text=${encodeURIComponent(link)}` : 'clipboard'
    setError('')
    setAway('gone')
    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=${input}`
  }

  async function read(input = text) {
    setError('')
    setNote(null)
    // A Shortcut result is a note page, so keep the link recorded by runShortcut().
    if (!isNotePage(input)) {
      const link = extractExternalUrl(input)
      rememberSource(link)
      setSourceUrl(link ?? '')
    }
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
      // a link: hand it to the Shortcut
      runShortcut()
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
    setAway(null)
    try {
      const got = await navigator.clipboard.readText()
      if (!isNotePage(got)) {
        setError('剪贴板里不是快捷指令读到的笔记。先复制小红书链接，点①让快捷指令读一遍，再点②。')
        return
      }
      const remembered = rememberedSource()
      if (remembered) setSourceUrl(remembered)
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
      onPick(await res.blob(), note?.title ?? '', sourceUrl || rememberedSource() || undefined)
      rememberSource()
      setSourceUrl('')
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
        <button className="primary small" disabled={disabled || !!busy} onClick={runShortcut}>
          ① 打开快捷指令
        </button>
        <button className={away === 'back' ? 'primary small' : 'small glass'} disabled={disabled || !!busy} onClick={paste}>
          ② 粘贴结果
        </button>
      </div>
      <p className="hint">
        {away === 'back'
          ? '快捷指令跑完了吗？看到"已复制"的通知后，点②。'
          : '读小红书笔记：先在小红书里点"分享 → 复制链接"，回来点①；看到"已复制"的通知后，回来点②。'}
      </p>
      <div className="row">
        <input
          placeholder={import.meta.env.DEV ? '粘贴小红书分享文案或链接' : '也可以把链接或快捷指令的结果粘贴在这里'}
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
