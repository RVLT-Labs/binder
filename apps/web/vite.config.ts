import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API is same-origin through this proxy, so Better Auth's session cookie is first-party.
// PowerSync is reached cross-origin with a bearer token from GET /api/sync/token.
const api = 'http://localhost:3000'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/blobs': api },
  },
  // PowerSync ships its own workers and wasm; pre-bundling breaks their relative imports.
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: { format: 'es' },
})
