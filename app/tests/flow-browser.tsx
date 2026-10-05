// Browser integration fixture. Start Vite on a separate origin (e.g. port 5176), then open
// /tests/flow-browser.html. Every AI request is intercepted here; no paid request is sent.
// Check: grid stage sends 0 requests; palette stage sends 1; confirming/editing cells sends 0;
// explicit AI retry/check sends only the requested phase. Fail/no-key modes allow manual entry.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Flow } from '../src/flow/Flow'
import '../src/App.css'

if (!import.meta.env.DEV) throw new Error('This fixture is for the development server only')
if (location.port !== '5176') throw new Error('Use the isolated test origin on port 5176')
const fakeSettings = JSON.stringify({ key: 'test-not-a-real-key', model: 'test-fixture' })
const storedSettings = localStorage.getItem('pindou.ai')
const previousSettings = storedSettings === fakeSettings ? null : storedSettings
localStorage.setItem('pindou.ai', fakeSettings)
window.addEventListener('pagehide', () => {
  if (previousSettings === null) localStorage.removeItem('pindou.ai')
  else localStorage.setItem('pindou.ai', previousSettings)
})
const fixture = 'B11:214 B15:59 B17:362 B22:3 B23:637 B29:43 B32:66 F11:3 G17:13 H2:5 H7:210 H16:16 H17:1'
  .split(' ').map((s) => ({ code: s.split(':')[0], count: Number(s.split(':')[1]) }))
let mode: 'success' | 'failure' | 'no-key' = 'success'
let report: (phase: string) => void = () => {}
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://openrouter.ai/')) return originalFetch(input, init)
  const body = JSON.parse(String(init?.body))
  const phase = body.messages[0].content[0].text.includes('图例（色卡）') ? '图例' : '格子'
  report(phase)
  if (mode === 'failure') return new Response('Fixture failure', { status: 503 })
  const content = phase === '图例' ? JSON.stringify({ legend: fixture }) : '{}'
  return Response.json({ choices: [{ message: { content } }] })
}

export function TestFlow() {
  const [run, setRun] = useState(0)
  const [requests, setRequests] = useState<string[]>([])
  const [saved, setSaved] = useState('')
  useEffect(() => {
    report = (phase) => setRequests((r) => [...r, phase])
    return () => { report = () => {} }
  }, [])
  const reset = (next: typeof mode) => {
    mode = next
    localStorage.setItem('pindou.ai', next === 'no-key' ? '{}' : fakeSettings)
    setRequests([])
    setSaved('')
    setRun((n) => n + 1)
  }
  return <>
    <aside style={{ padding: 12, background: '#e7f4ed' }}>
      <b>流程集成测试 · AI 为模拟结果</b>
      <div className="row">
        <button onClick={() => reset('success')}>重置：模拟成功</button>
        <button onClick={() => reset('failure')}>重置：模拟失败</button>
        <button onClick={() => reset('no-key')}>重置：无 AI 设置</button>
      </div>
      <p role="status">模拟 API 请求：{requests.length} 次（{requests.join('、') || '无'}）{saved && `；已保存 ${saved}`}</p>
    </aside>
    <Flow key={run} onClose={() => reset(mode)} onSaved={setSaved} />
  </>
}
createRoot(document.getElementById('root')!).render(<TestFlow />)
