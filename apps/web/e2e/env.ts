import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
export const AUTH_DIR = join(import.meta.dirname, '.auth')
export const RUN_FILE = join(AUTH_DIR, 'run.json')
export const API_URL = 'http://localhost:3000'
export const APP_URL = 'http://localhost:5173'
/** `vite preview` of the production build, which carries the service worker. */
export const PREVIEW_URL = 'http://localhost:4173'

/** The dev values from .env.example: the API the e2e suite starts runs against the dev compose stack. */
export function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(join(REPO_ROOT, '.env.example'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}

/**
 * The run's users by their part in the shared show: its owner, an editor scoped to SND, an editor
 * scoped to LX, a viewer, and an outsider who is not a member at all.
 */
export const USER_KEYS = ['owner', 'sndEditor', 'lxEditor', 'viewer', 'outsider'] as const
export type UserKey = (typeof USER_KEYS)[number]

/** Everything global-setup created for this run; read by auth.setup.ts and the specs. */
export interface RunData {
  password: string
  users: Record<UserKey, { id: string; email: string; name: string }>
  /** The show the owner owns; the editors and viewer are members; the outsider is not. */
  sharedShow: { id: string; title: string }
  /** The shared show's departments: code to id. */
  departments: Record<string, string>
  /** A show only the outsider belongs to, so their home screen proves they have synced. */
  cShow: { id: string; title: string }
  /** A three-page text libretto in the shared show, uploaded by the owner and processed. */
  libretto: { documentId: string; versionId: string }
}

export function readRun(): RunData {
  return JSON.parse(readFileSync(RUN_FILE, 'utf8'))
}

export const storageStateFor = (user: UserKey) => join(AUTH_DIR, `${user}.json`)
