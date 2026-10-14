import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The API is same-origin through this proxy, so Better Auth's session cookie is first-party.
// PowerSync is reached cross-origin with a bearer token from GET /api/sync/token.
const api = 'http://localhost:3000'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    pdfjsAssets(),
    offlineShell(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/blobs': api },
  },
  // `vite preview` serves the production build, as the offline e2e needs; same-origin like production.
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': api, '/blobs': api, '/mcp': api },
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

/**
 * The service worker that makes the app open with no network (spec 4.5): it precaches the app shell,
 * the PDF.js worker and everything under /pdfjs/ (fonts, CMaps and decoders a scan may need), and
 * answers navigations with index.html. Blobs go to the same Cache API cache fetchBlob uses
 * ('blobs-v1'), cache first, so thumbnails read by <img> work offline too. The API is never cached.
 * Registration is manual (src/pwa.ts) and updates wait until the user accepts them.
 */
function offlineShell(): Plugin[] {
  return VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: false,
    workbox: {
      globPatterns: ['**/*.{html,js,mjs,css,wasm}', 'pdfjs/**/*'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/blobs\//, /^\/mcp/],
      clientsClaim: true,
      runtimeCaching: [
        {
          urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/blobs/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'blobs-v1',
            cacheableResponse: { statuses: [200] },
            // Blob URLs name immutable bytes; a Vary header must not hide a cached copy.
            matchOptions: { ignoreVary: true },
          },
        },
        {
          urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
      ],
    },
  })
}
