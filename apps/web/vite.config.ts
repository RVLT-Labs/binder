import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The API is same-origin through this proxy, so Better Auth's session cookie is first-party.
// PowerSync is reached cross-origin with a bearer token from GET /api/sync/token.
const api = 'http://localhost:3000'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), pdfjsAssets()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/blobs': api },
  },
  // PowerSync ships its own workers and wasm; pre-bundling breaks their relative imports.
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: { format: 'es' },
})

/**
 * PDF.js fetches CMaps, standard fonts, ICC profiles and wasm decoders by URL at run time
 * (src/viewer/pdfjs.ts). Serve them from pdfjs-dist under /pdfjs/ in dev and copy them into the build.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const dirs = ['cmaps', 'standard_fonts', 'iccs', 'wasm']
  const types: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript' }
  return {
    name: 'binder-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [dir, file, ...rest] = (req.url ?? '').split('?')[0].split('/').filter(Boolean)
        const path = dirs.includes(dir) && file && rest.length === 0 && join(root, dir, file)
        if (!path || file.startsWith('.') || !existsSync(path)) return next()
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
        createReadStream(path).pipe(res)
      })
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const file of readdirSync(join(root, dir))) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${file}`,
            source: readFileSync(join(root, dir, file)),
          })
        }
      }
    },
  }
}
