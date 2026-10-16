import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startOutboxFlusher } from './exports/flusher'
import { registerServiceWorker } from './pwa'
import { createAppRouter } from './router'
import '@fontsource/archivo/latin-800.css'
import '@fontsource/hanken-grotesk/latin-400.css'
import '@fontsource/hanken-grotesk/latin-500.css'
import '@fontsource/hanken-grotesk/latin-600.css'
import '@fontsource/hanken-grotesk/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import '@fontsource/kalam/latin-400.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/markup.css'
// The pre-restyle stylesheet; it loses rules screen by screen and is deleted with the last of them.
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
})
const router = createAppRouter(queryClient)
registerServiceWorker()
// Exports made offline upload their records once there is a network (on start, and on `online`).
startOutboxFlusher()

// biome-ignore lint/style/noNonNullAssertion: index.html always has #root
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
