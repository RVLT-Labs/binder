import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  entryMode,
  exitCodeFor,
  redactor,
  runSteps,
  type State,
  type Step,
  stepsFor,
  upgradeStatus,
} from '../../../deploy/scripts/m1-smoke'

const SCRIPT = resolve(__dirname, '../../../deploy/scripts/m1-smoke.ts')
const SCRIPT_URL = pathToFileURL(SCRIPT).href
const TSX = resolve(__dirname, '../node_modules/.bin/tsx')

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'm1-smoke-'))
  symlinkSync(SCRIPT, join(dir, 'linked-smoke.ts'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const state = (): State => ({ base: 'http://x', token: 'secret-token', mcp: {} as State['mcp'] })
const step = (name: string, run: Step['run']): Step => ({ name, run })

describe('exitCodeFor', () => {
  test('zero only when every expected step ran and none failed', () => {
    expect(exitCodeFor({ failed: false, ran: 5, expected: 5 })).toBe(0)
    expect(exitCodeFor({ failed: true, ran: 5, expected: 5 })).toBe(1)
    expect(exitCodeFor({ failed: false, ran: 4, expected: 5 })).toBe(1)
  })
  test('a run that did nothing never passes', () => {
    expect(exitCodeFor({ failed: false, ran: 0, expected: 0 })).toBe(1)
    expect(exitCodeFor({ failed: false, ran: 0, expected: 5 })).toBe(1)
  })
})

describe('entryMode', () => {
  test('the script itself is a run, also through a symlink', () => {
    expect(entryMode(SCRIPT_URL, ['node', SCRIPT, '--stage', 'full'])).toBe('run')
    expect(entryMode(SCRIPT_URL, ['node', join(dir, 'linked-smoke.ts'), '--stage', 'full'])).toBe(
      'run',
    )
  })
  test('another entry file is an import, unless it passed --stage (then it is a mismatch)', () => {
    expect(entryMode(SCRIPT_URL, ['node', '/somewhere/vitest.mjs', 'run'])).toBe('import')
    expect(entryMode(SCRIPT_URL, ['node'])).toBe('import')
    expect(entryMode(SCRIPT_URL, ['node', '/elsewhere/other.ts', '--stage', 'full'])).toBe(
      'mismatch',
    )
    expect(entryMode(SCRIPT_URL, ['node', '/elsewhere/other.ts', '--stage=full'])).toBe('mismatch')
  })
})

describe('the script as a program', () => {
  const run = (path: string, args: string[]) =>
    spawnSync(TSX, [path, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 60_000,
    })

  test('run through a symlink it starts (a missing stage is a usage error, not a silent pass)', () => {
    const result = run(join(dir, 'linked-smoke.ts'), [])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage: m1-smoke.ts')
  })

  test('without BINDER_URL and BINDER_TOKEN it exits non-zero without running a step', () => {
    const result = run(SCRIPT, ['--stage', 'full'])
    expect(result.status).toBe(2)
    expect(result.stdout).not.toContain('PASS')
  })
})

describe('runSteps', () => {
  test('counts the steps it ran and skips the rest after a failure', async () => {
    const lines: string[] = []
    const s = state()
    const failed = await runSteps(
      [
        step('one', async () => 'ok'),
        step('two', async () => {
          throw new Error('boom')
        }),
        step('three', async () => undefined),
      ],
      s,
      (l) => lines.push(l),
    )
    expect(failed).toBe(true)
    expect(s.ran).toBe(2)
    expect(lines).toEqual(['PASS [2/4] one (ok)', 'FAIL [3/4] two: boom', 'SKIP [4/4] three'])
  })

  test('an empty list runs nothing, so it cannot earn a zero exit', async () => {
    const s = state()
    expect(await runSteps([], s, () => {})).toBe(false)
    expect(exitCodeFor({ failed: false, ran: s.ran ?? 0, expected: 1 })).toBe(1)
  })
})

describe('stepsFor', () => {
  test('full runs the checkpoint work, then the full steps, and archives last', () => {
    const checkpoint = stepsFor('checkpoint').map((x) => x.name)
    const full = stepsFor('full').map((x) => x.name)
    const archive = 'update_show archives the smoke show'
    expect(checkpoint.at(-1)).toBe(archive)
    expect(full.at(-1)).toBe(archive)
    expect(full.filter((n) => n === archive)).toHaveLength(1)
    expect(full.length).toBeGreaterThan(checkpoint.length)
    // Everything in the checkpoint before the archive step comes first, in order.
    expect(full.slice(0, checkpoint.length - 1)).toEqual(checkpoint.slice(0, -1))
  })
})

describe('redactor', () => {
  test('removes the secret from anything printed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    redactor('abc123')('FAIL x: Bearer abc123 refused abc123')
    expect(log).toHaveBeenCalledWith('FAIL x: Bearer [token] refused [token]')
    log.mockRestore()
  })
})

describe('upgradeStatus', () => {
  test('reports the status a websocket upgrade is answered with, and 101 when it opens', async () => {
    const seen: Array<string | undefined> = []
    const server = createServer((req, res) => {
      seen.push(req.headers.origin)
      res.statusCode = req.headers.origin === 'https://evil.example' ? 403 : 401
      res.end()
    })
    server.on('upgrade', (_req, socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      )
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p`
    try {
      // A real server answers an upgrade request with 101 through the `upgrade` event.
      expect(await upgradeStatus(url, 'http://127.0.0.1')).toBe(101)
    } finally {
      server.close()
    }
    const plain = createServer((req, res) => {
      seen.push(req.headers.origin)
      res.statusCode = req.headers.origin === 'https://evil.example' ? 403 : 401
      res.end()
    })
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r))
    const plainUrl = `http://127.0.0.1:${(plain.address() as AddressInfo).port}/p`
    try {
      expect(await upgradeStatus(plainUrl, 'http://127.0.0.1')).toBe(401)
      expect(await upgradeStatus(plainUrl, 'https://evil.example')).toBe(403)
      expect(seen).toContain('https://evil.example')
    } finally {
      plain.close()
    }
  })
})
