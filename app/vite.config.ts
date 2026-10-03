import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
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

/** GET /samples/<name>.jpg: the test charts in ../samples (other people's work), on this Mac only. */
function devSamples(): Plugin {
  const dir = resolve(import.meta.dirname, '../samples')
  return {
    name: 'dev-samples',
    apply: 'serve',
    configureServer: (server) =>
      void server.middlewares.use((req, res, next) => {
        const name = /^\/samples\/([\w-]+\.jpg)$/.exec(req.url ?? '')?.[1]
        const file = name && resolve(dir, name)
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'image/jpeg')
        createReadStream(file).pipe(res)
      }),
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // published at https://emma-zhuym.github.io/pindou/
  base: command === 'build' ? '/pindou/' : '/',
  plugins: [react(), xhsRelay(), devSamples()],
  // reachable from a phone on the same network (http://<this Mac's address>:5173)
  server: { host: true },
}))
