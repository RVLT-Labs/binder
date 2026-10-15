import type { ManifestOptions } from 'vite-plugin-pwa'

/** Linked from index.html; iOS ignores manifest icons and uses this one for the home screen. */
export const APPLE_TOUCH_ICON = '/apple-touch-icon.png'

/**
 * The web app manifest (spec 3.1: an installable PWA; the iPad is a target). vite.config.ts hands it
 * to vite-plugin-pwa, which writes manifest.webmanifest and links it. Both colours are the espresso
 * `--paper` of styles/tokens.css, for the launch screen and the browser chrome. The icons in
 * public/ are the Binder mark drawn by scripts/make-icons.mjs: rounded tiles for "any", and a
 * full-bleed tile for "maskable" so the OS crop keeps the letter inside its safe zone.
 */
export const webManifest = {
  name: 'Binder',
  short_name: 'Binder',
  description: 'Show binders for theatre: scripts, scores and cues, online and offline.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#141210',
  theme_color: '#141210',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} satisfies Partial<ManifestOptions>
