import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTestDb } from '@binder/db/testing'
import { type AppDeps, createApp } from '../src/app'
import { DiskBlobStore } from '../src/blob/DiskBlobStore'
import type { Config } from '../src/config'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    BLOB_ROOT: mkdtempSync(join(tmpdir(), 'binder-blobs-')),
    PORT: 3000,
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_SECRET: 'test-auth-secret-0123456789abcdef',
    POWERSYNC_JWT_SECRET: 'dGVzdC1wb3dlcnN5bmMtc2VjcmV0',
    POWERSYNC_URL: 'http://localhost:8080',
    ALLOW_SIGNUP: false,
    ...overrides,
  }
}

export async function testDeps(overrides: Partial<AppDeps> = {}): Promise<AppDeps> {
  const { db } = await getTestDb()
  const config = overrides.config ?? testConfig()
  return { config, db, blobs: new DiskBlobStore(config.BLOB_ROOT), ...overrides }
}

export async function createTestApp(overrides: Partial<AppDeps> = {}) {
  const deps = await testDeps(overrides)
  return { app: createApp(deps), deps }
}
