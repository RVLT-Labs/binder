import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
export const AUTH_DIR = join(import.meta.dirname, '.auth')
export const RUN_FILE = join(AUTH_DIR, 'run.json')
export const API_URL = 'http://localhost:3000'
export const APP_URL = 'http://localhost:5173'

/** The dev values from .env.example: the API the e2e suite starts runs against the dev compose stack. */
export function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(join(REPO_ROOT, '.env.example'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}

export type UserKey = 'a' | 'b' | 'c'

/** Everything global-setup created for this run; read by auth.setup.ts and the specs. */
export interface RunData {
  password: string
  users: Record<UserKey, { email: string; name: string }>
  /** The show A owns and B edits; C is not a member. */
  sharedShow: { id: string; title: string }
  /** A show only C belongs to, so C's home screen proves C has synced. */
  cShow: { id: string; title: string }
}

export function readRun(): RunData {
  return JSON.parse(readFileSync(RUN_FILE, 'utf8'))
}

export const storageStateFor = (user: UserKey) => join(AUTH_DIR, `${user}.json`)
