import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { readNote, RelayError } from './relay/xhs.ts'

/** GET /api/xhs?text=<share text>: the link import relay, while the app is served from this Mac. */
function xhsRelay(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/xhs')) return next()
    const text = new URL(req.url, 'http://local').searchParams.get('text') ?? ''
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    try {
      res.end(JSON.stringify(await readNote(text)))
    } catch (e) {
      res.statusCode = e instanceof RelayError ? 422 : 502
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  }
  return {
    name: 'xhs-relay',
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), xhsRelay()],
})
